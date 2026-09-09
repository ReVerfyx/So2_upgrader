/**
 * Страница апгрейда.
 *
 * Порядок работы (полностью соответствует требованиям безопасности):
 *  1. Пользователь выбирает источник — предмет из инвентаря или ставку с баланса.
 *  2. Выбирает желаемый предмет; сервер отдаёт расчёт: стоимость, коэффициент,
 *     реальный шанс и потенциальный выигрыш.
 *  3. По нажатию кнопка блокируется, уходит запрос POST /api/upgrade.
 *  4. Сервер определяет результат и возвращает его целиком.
 *  5. Только после этого запускается анимация, которая доводит стрелку
 *     до полученной позиции. Анимация ничего не решает.
 *  6. После остановки обновляются баланс и инвентарь.
 *
 * Показанный шанс отправляется обратно (expectedChancePpm): если он разошёлся
 * с серверным, игра отклоняется и средства не списываются.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ApiError, apiRequest, newIdempotencyKey, queryString } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ItemCard } from '../components/ItemCard';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';
import { UpgradeWheel, type WheelPhase } from '../components/UpgradeWheel';
import { EmptyState } from '../components/EmptyState';
import { ItemGridSkeleton } from '../components/Skeleton';
import { formatMultiplier, formatPercent, RARITY_COLORS } from '../lib/format';
import type {
  InventoryItem,
  Paged,
  TargetItem,
  UpgradeQuote,
  UpgradeResult,
  UpgradeSettings,
} from '../types/api';

type SourceMode = 'item' | 'balance';

export function UpgradePage(): JSX.Element {
  const { me, isAuthenticated, config } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [sourceMode, setSourceMode] = useState<SourceMode>('item');
  const [sourceItem, setSourceItem] = useState<InventoryItem | null>(null);
  const [stake, setStake] = useState('100');
  const [targetItem, setTargetItem] = useState<TargetItem | null>(null);
  const [targetSearch, setTargetSearch] = useState('');

  const [result, setResult] = useState<UpgradeResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<WheelPhase>('idle');
  const [showResult, setShowResult] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['upgrade-settings'],
    queryFn: () => apiRequest<UpgradeSettings>('/upgrades/settings'),
    staleTime: 5 * 60_000,
  });

  const inventoryQuery = useQuery({
    queryKey: ['inventory', 'available'],
    queryFn: () => apiRequest<Paged<InventoryItem>>(`/inventory${queryString({ limit: 60, sort: 'price_desc' })}`),
    enabled: isAuthenticated,
  });

  /** Стоимость ставки в монетах — от неё зависит список доступных целей. */
  const sourceValue = useMemo(() => {
    if (sourceMode === 'item') return sourceItem?.currentPrice.coins ?? null;
    const parsed = Number(stake.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
  }, [sourceMode, sourceItem, stake]);

  const targetsQuery = useQuery({
    queryKey: ['upgrade-targets', sourceMode, sourceItem?.id, sourceValue, targetSearch],
    queryFn: () =>
      apiRequest<Paged<TargetItem> & { sourcePrice: { formatted: string } }>(
        `/upgrade/targets${queryString({
          sourceInventoryId: sourceMode === 'item' ? sourceItem?.id : undefined,
          stake: sourceMode === 'balance' ? sourceValue ?? undefined : undefined,
          search: targetSearch || undefined,
          limit: 30,
        })}`,
      ),
    enabled: isAuthenticated && Boolean(sourceValue),
  });

  /** Актуальный расчёт: тот же, что использует сервер при игре. */
  const quoteQuery = useQuery({
    queryKey: ['upgrade-quote', sourceMode, sourceItem?.id, sourceValue, targetItem?.id],
    queryFn: () =>
      apiRequest<{ quote: UpgradeQuote }>('/upgrade/preview', {
        method: 'POST',
        body: {
          sourceType: sourceMode,
          sourceInventoryId: sourceMode === 'item' ? sourceItem?.id : undefined,
          stake: sourceMode === 'balance' ? sourceValue : undefined,
          targetItemId: targetItem?.id,
        },
      }),
    enabled: isAuthenticated && Boolean(targetItem) && Boolean(sourceValue),
    retry: false,
  });

  const quote = quoteQuery.data?.quote ?? null;

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      if (!quote || !targetItem) throw new Error('Не выбраны параметры апгрейда');
      const response = await apiRequest<{ result: UpgradeResult }>('/upgrade', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          sourceType: sourceMode,
          sourceInventoryId: sourceMode === 'item' ? sourceItem?.id : undefined,
          stake: sourceMode === 'balance' ? sourceValue : undefined,
          targetItemId: targetItem.id,
          // Шанс, который видел пользователь: сервер обязан его подтвердить.
          expectedChancePpm: quote.chancePpm,
        },
      });
      return response.result;
    },
    onSuccess: (upgradeResult) => {
      // Результат уже определён сервером — запускаем анимацию под него.
      setResult(upgradeResult);
      setRunId((value) => value + 1);
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'Не удалось выполнить апгрейд';
      toast.error('Апгрейд не выполнен', message);
      if (error instanceof ApiError && error.code === 'CHANCE_MISMATCH') {
        void quoteQuery.refetch();
      }
    },
  });

  /** Завершение анимации: показываем итог и обновляем данные. */
  const handleFinish = useCallback(() => {
    setShowResult(true);
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['upgrades'] });
  }, [queryClient]);

  // Сбрасываем выбранный исходный предмет, если он больше недоступен.
  useEffect(() => {
    if (!sourceItem || !inventoryQuery.data) return;
    const stillAvailable = inventoryQuery.data.items.some((item) => item.id === sourceItem.id);
    if (!stillAvailable) {
      setSourceItem(null);
      setTargetItem(null);
    }
  }, [inventoryQuery.data, sourceItem]);

  const isRunning = upgradeMutation.isPending || phase === 'spinning' || phase === 'slowing';
  const canUpgrade = Boolean(quote) && !isRunning && isAuthenticated;

  const closeResult = (): void => {
    setShowResult(false);
    setResult(null);
    setPhase('idle');
    if (sourceMode === 'item') {
      setSourceItem(null);
      setTargetItem(null);
    }
  };

  const minStake = settingsQuery.data?.minStake.coins ?? '10';
  const balanceCoins = Number(me?.balance.coins ?? '0');

  return (
    <div className="space-y-4">
      {/* Верхний блок: круг и параметры */}
      <section className="panel relative overflow-hidden p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          {/* Исходный предмет / ставка */}
          <div className="order-2 lg:order-1">
            <p className="mb-2 text-xxs uppercase tracking-widest text-muted">Ваша ставка</p>

            <div className="mb-3 flex rounded-lg bg-dark p-1">
              {(['item', 'balance'] as SourceMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    setSourceMode(mode);
                    setTargetItem(null);
                  }}
                  className={clsx(
                    'flex-1 rounded-md py-2 text-13 font-semibold transition-colors',
                    sourceMode === mode ? 'bg-gradient-accent text-black' : 'text-muted hover:text-white',
                  )}
                >
                  {mode === 'item' ? 'Предметом' : 'Балансом'}
                </button>
              ))}
            </div>

            {sourceMode === 'item' ? (
              sourceItem ? (
                <div className="relative">
                  <ItemCard item={sourceItem} selected />
                  <button
                    type="button"
                    className="btn-secondary btn-sm mt-2 w-full"
                    disabled={isRunning}
                    onClick={() => {
                      setSourceItem(null);
                      setTargetItem(null);
                    }}
                  >
                    Выбрать другой предмет
                  </button>
                </div>
              ) : (
                <EmptyState
                  title="Предмет не выбран"
                  icon="🎒"
                  description="Выберите предмет из инвентаря ниже."
                />
              )
            ) : (
              <div className="panel-card p-3">
                <label className="label" htmlFor="stake">
                  Сумма ставки, монет
                </label>
                <input
                  id="stake"
                  className="input"
                  inputMode="decimal"
                  value={stake}
                  disabled={isRunning}
                  onChange={(event) => {
                    setStake(event.target.value.replace(/[^\d.,]/g, ''));
                    setTargetItem(null);
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['50', '100', '500', '1000'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={isRunning}
                      onClick={() => {
                        setStake(value);
                        setTargetItem(null);
                      }}
                      className="btn-secondary btn-sm flex-1"
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xxs text-muted">
                  Минимум {minStake} монет · Доступно {balanceCoins.toLocaleString('ru-RU')} монет
                </p>
              </div>
            )}
          </div>

          {/* Круг апгрейда */}
          <div className="order-1 flex flex-col items-center lg:order-2">
            <UpgradeWheel
              chancePercent={quote?.chancePercent ?? 0}
              resultPercent={result?.rollPercent ?? null}
              success={phase === 'result' && result ? result.success : null}
              runId={runId}
              onPhaseChange={setPhase}
              onFinish={handleFinish}
              size={260}
            />

            <button
              type="button"
              onClick={() => upgradeMutation.mutate()}
              disabled={!canUpgrade}
              className={clsx(
                'btn-primary mt-5 w-full max-w-[260px] text-base',
                canUpgrade && 'animate-pulse-glow',
              )}
            >
              {isRunning ? 'Крутим…' : 'Улучшить'}
            </button>

            {quote ? (
              <p className="mt-2 text-center text-xxs text-muted">
                Списывается {quote.sourcePrice.formatted} монет · шанс {formatPercent(quote.chancePercent)}
              </p>
            ) : (
              <p className="mt-2 text-center text-xxs text-muted">Выберите ставку и желаемый предмет</p>
            )}
          </div>

          {/* Желаемый предмет */}
          <div className="order-3">
            <p className="mb-2 text-xxs uppercase tracking-widest text-muted">Желаемый предмет</p>
            {targetItem ? (
              <div>
                <ItemCard item={targetItem} selected />
                <button
                  type="button"
                  className="btn-secondary btn-sm mt-2 w-full"
                  disabled={isRunning}
                  onClick={() => setTargetItem(null)}
                >
                  Выбрать другой
                </button>
              </div>
            ) : (
              <EmptyState title="Цель не выбрана" icon="🎯" description="Выберите предмет из списка справа/ниже." />
            )}
          </div>
        </div>

        {/* Сводка расчёта */}
        {quote ? (
          <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
            <div className="text-center">
              <p className="text-xxs uppercase text-muted">Стоимость</p>
              <Money value={quote.sourcePrice} className="mt-1" />
            </div>
            <div className="text-center">
              <p className="text-xxs uppercase text-muted">Коэффициент</p>
              <p className="mt-1 font-display font-bold text-white">{formatMultiplier(quote.multiplier)}</p>
            </div>
            <div className="text-center">
              <p className="text-xxs uppercase text-muted">Реальный шанс</p>
              <p className="mt-1 font-display font-bold text-accent">{formatPercent(quote.chancePercent)}</p>
            </div>
            <div className="text-center">
              <p className="text-xxs uppercase text-muted">Выигрыш</p>
              <Money value={quote.potentialWin} className="mt-1 text-success" />
            </div>
          </div>
        ) : null}

        {quoteQuery.isError ? (
          <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-13 text-red-300">
            {(quoteQuery.error as ApiError)?.message ?? 'Не удалось рассчитать апгрейд'}
          </p>
        ) : null}
      </section>

      {!isAuthenticated ? (
        <EmptyState
          title="Войдите, чтобы играть"
          icon="🔐"
          description="Инвентарь и апгрейд доступны после входа в аккаунт."
          action={
            <Link to="/login" className="btn-primary">
              Войти
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Мои предметы */}
          {sourceMode === 'item' ? (
            <section className="panel p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold">Мои предметы</h2>
                <Link to="/inventory" className="text-xxs font-semibold text-accent hover:underline">
                  Весь инвентарь →
                </Link>
              </div>

              {inventoryQuery.isLoading ? (
                <ItemGridSkeleton count={6} />
              ) : inventoryQuery.data && inventoryQuery.data.items.length > 0 ? (
                <div className="scrollbar-thin grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {inventoryQuery.data.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      compact
                      selected={sourceItem?.id === item.id}
                      disabled={isRunning}
                      onClick={() => {
                        setSourceItem(item);
                        setTargetItem(null);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Инвентарь пуст"
                  icon="🎒"
                  description={
                    config?.testMode
                      ? 'В тестовом режиме предметы можно выдать себе в профиле.'
                      : 'Пополните баланс и сыграйте на баланс, чтобы получить первый предмет.'
                  }
                  action={
                    <Link to="/deposit" className="btn-primary btn-sm">
                      Пополнить баланс
                    </Link>
                  }
                />
              )}
            </section>
          ) : null}

          {/* Желаемые предметы */}
          <section className={clsx('panel p-3 sm:p-4', sourceMode === 'balance' && 'lg:col-span-2')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-bold">Желаемые предметы</h2>
              <input
                className="input h-9 max-w-[180px] text-13"
                placeholder="Поиск…"
                value={targetSearch}
                onChange={(event) => setTargetSearch(event.target.value)}
              />
            </div>

            {!sourceValue ? (
              <EmptyState title="Сначала выберите ставку" icon="👈" />
            ) : targetsQuery.isLoading ? (
              <ItemGridSkeleton count={6} />
            ) : targetsQuery.data && targetsQuery.data.items.length > 0 ? (
              <div
                className={clsx(
                  'scrollbar-thin grid max-h-[420px] gap-2 overflow-y-auto pr-1',
                  sourceMode === 'balance'
                    ? 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-6'
                    : 'grid-cols-2 sm:grid-cols-3',
                )}
              >
                {targetsQuery.data.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    compact
                    selected={targetItem?.id === item.id}
                    disabled={isRunning}
                    onClick={() => setTargetItem(item)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="Нет доступных предметов"
                icon="🔍"
                description="Для этой ставки нет подходящих целей. Измените сумму или выберите другой предмет."
              />
            )}
          </section>
        </div>
      )}

      {/* Модальное окно результата */}
      <Modal open={showResult && Boolean(result)} onClose={closeResult} size="sm">
        {result ? (
          <div className="flex flex-col items-center text-center">
            <div
              className={clsx(
                'mb-4 flex h-40 w-40 items-center justify-center rounded-xl',
                result.success ? 'animate-win-card' : 'opacity-70',
              )}
              style={{
                background: result.success
                  ? `radial-gradient(circle, ${RARITY_COLORS[result.target.rarity]}33 0%, transparent 70%)`
                  : 'radial-gradient(circle, rgba(194,0,0,0.15) 0%, transparent 70%)',
              }}
            >
              <img
                src={result.target.imageUrl}
                alt={result.target.name}
                className={clsx('h-full w-full object-contain', result.success && 'animate-win-image')}
              />
            </div>

            <h3
              className={clsx(
                'font-display text-xl font-extrabold',
                result.success ? 'text-success' : 'text-danger',
              )}
            >
              {result.success ? 'Апгрейд успешен!' : 'Не повезло'}
            </h3>

            <p className="mt-1 text-13 text-muted">
              {result.success
                ? `${result.target.name} добавлен в инвентарь`
                : `Ставка ${result.sourcePrice.formatted} монет не сыграла`}
            </p>

            <div className="mt-4 w-full space-y-1.5 rounded-lg bg-dark p-3 text-13">
              <div className="flex justify-between">
                <span className="text-muted">Заявленный шанс</span>
                <span className="font-semibold text-accent">{formatPercent(result.chancePercent)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Бросок сервера</span>
                <span className="font-semibold tabular-nums">{formatPercent(result.rollPercent)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Баланс</span>
                <span className="font-semibold">{result.balanceAfter.formatted} монет</span>
              </div>
            </div>

            <p className="mt-3 text-xxs leading-relaxed text-muted">
              Бросок меньше шанса — победа. Проверить честность игры можно в{' '}
              <Link to="/profile" className="text-accent hover:underline" onClick={closeResult}>
                профиле
              </Link>
              .
            </p>

            <div className="mt-4 flex w-full gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={closeResult}>
                Закрыть
              </button>
              {result.success && result.wonInventoryId ? (
                <Link to="/inventory" className="btn-primary flex-1" onClick={closeResult}>
                  В инвентарь
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
