/**
 * Пополнение баланса через TON.
 *
 * Честная механика: сайт выдаёт адрес, сумму и уникальный комментарий.
 * Зачисление происходит только после того, как сервер сам найдёт транзакцию
 * в блокчейне. Никакие данные из браузера на зачисление не влияют.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, newIdempotencyKey, queryString } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Money, Ton } from '../components/Money';
import { EmptyState } from '../components/EmptyState';
import { RowsSkeleton, Skeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { DEPOSIT_STATUS_LABELS, formatCountdown, formatDateTime, shorten } from '../lib/format';
import { TelegramLink } from '../components/TelegramLink';
import type { Deposit, Paged, RateInfo } from '../types/api';

function CopyField({ label, value }: { label: string; value: string }): JSX.Element {
  const toast = useToast();
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-dark px-3 py-2.5 font-mono text-13">
          {value}
        </code>
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => toast.success('Скопировано'))
              .catch(() => toast.error('Не удалось скопировать'));
          }}
        >
          Копировать
        </button>
      </div>
    </div>
  );
}

export function DepositPage(): JSX.Element {
  const { config } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState(String(config?.minDepositTon ?? 0.88));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const infoQuery = useQuery({
    queryKey: ['deposit-info'],
    queryFn: () =>
      apiRequest<{
        minDeposit: { ton: string; formatted: string };
        minDepositCoins: { coins: string; formatted: string };
        coinsPerTon: string;
        rate: RateInfo;
        ttlMinutes: number;
        minConfirmations: number;
        configured: boolean;
      }>('/deposit/info'),
  });

  const depositQuery = useQuery({
    queryKey: ['deposit', activeId],
    queryFn: () => apiRequest<{ deposit: Deposit; walletAddress: string }>(`/deposit/${activeId}`),
    enabled: Boolean(activeId),
    // Пока счёт не оплачен — периодически спрашиваем статус у сервера.
    refetchInterval: (query) => (query.state.data?.deposit.status === 'pending' ? 5000 : false),
  });

  const historyQuery = useQuery({
    queryKey: ['deposits'],
    queryFn: () => apiRequest<Paged<Deposit>>(`/deposits${queryString({ limit: 10 })}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ deposit: Deposit }>('/deposit', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: { amount: amount.replace(',', '.') },
      }),
    onSuccess: (data) => {
      setActiveId(data.deposit.id);
      setSecondsLeft(data.deposit.secondsLeft);
      void queryClient.invalidateQueries({ queryKey: ['deposits'] });
      toast.info('Счёт создан', 'Отправьте перевод с указанным комментарием');
    },
    onError: (error) => {
      toast.error('Не удалось создать счёт', error instanceof ApiError ? error.message : undefined);
    },
  });

  const simulateMutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiRequest('/dev/ton/simulate-payment', { method: 'POST', body: { paymentId } }),
    onSuccess: () => {
      toast.success('Тестовый платёж отправлен', 'Сервер обработал транзакцию');
      void queryClient.invalidateQueries({ queryKey: ['deposit', activeId] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['deposits'] });
    },
    onError: (error) => toast.error('Ошибка теста', error instanceof ApiError ? error.message : undefined),
  });

  const deposit = depositQuery.data?.deposit ?? null;

  // Таймер ожидания оплаты.
  useEffect(() => {
    if (!deposit || deposit.status !== 'pending') return undefined;
    setSecondsLeft(deposit.secondsLeft);
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [deposit]);

  // Уведомление о зачислении.
  useEffect(() => {
    if (deposit?.status === 'confirmed') {
      toast.success('Баланс пополнен', `Зачислено ${deposit.credited.formatted} монет`);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deposit?.status]);

  if (!infoQuery.data?.configured && !infoQuery.isLoading) {
    return (
      <EmptyState
        title="Пополнение временно недоступно"
        icon="🚧"
        description="Администратор ещё не настроил кошелёк TON (переменная TON_WALLET_ADDRESS)."
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Пополнение баланса</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Создание счёта */}
        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Новый счёт</h2>

          {infoQuery.isLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <>
              <label className="label" htmlFor="amount">
                Сумма пополнения, TON
              </label>
              <input
                id="amount"
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
              />

              <div className="mt-2 flex flex-wrap gap-1.5">
                {['0.88', '5', '10', '25', '50'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="btn-secondary btn-sm flex-1"
                    onClick={() => setAmount(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>

              <div className="mt-2 space-y-1 rounded-lg bg-dark p-3 text-xxs text-muted">
                <div className="flex items-center justify-between">
                  <span>Курс</span>
                  <span className="font-semibold text-white">
                    1 TON = {Number(infoQuery.data?.coinsPerTon ?? 0).toLocaleString('ru-RU')} монет
                  </span>
                </div>
                {infoQuery.data?.rate ? (
                  <div className="flex items-center justify-between">
                    <span>Источник курса</span>
                    <span className={infoQuery.data.rate.stale ? 'text-danger' : 'text-muted'}>
                      {infoQuery.data.rate.auto ? infoQuery.data.rate.source : 'ручной'}
                      {infoQuery.data.rate.ageMinutes !== null
                        ? ` · ${infoQuery.data.rate.ageMinutes} мин назад`
                        : ''}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <span>Будет зачислено</span>
                  <Money
                    value={String(
                      Math.floor(Number(amount.replace(',', '.') || 0) * Number(infoQuery.data?.coinsPerTon ?? 0) * 100) / 100,
                    )}
                    size="sm"
                  />
                </div>
                <p className="pt-1">
                  Минимальная сумма — {infoQuery.data?.minDeposit.ton} TON (
                  {infoQuery.data?.minDepositCoins.formatted} монет). Счёт действует {infoQuery.data?.ttlMinutes} минут.
                  1 монета = 1 ₽.
                </p>
              </div>

              <button
                type="button"
                className="btn-primary mt-4 w-full"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Создаём…' : 'Создать счёт'}
              </button>
            </>
          )}

          <div className="mt-4 rounded-lg border border-white/10 bg-dark p-3 text-xxs leading-relaxed text-muted">
            <p className="mb-1 font-semibold text-white">Как это работает</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>Создайте счёт и получите адрес, сумму и комментарий.</li>
              <li>Отправьте перевод в TON, обязательно указав комментарий.</li>
              <li>Сервер сам найдёт транзакцию в блокчейне и зачислит баланс.</li>
            </ol>
            <p className="mt-2">
              Без комментария платёж не привязывается к аккаунту автоматически — в этом случае напишите в поддержку.
            </p>
            <TelegramLink className="btn-secondary btn-sm mt-3" label="Поддержка в Telegram" />
          </div>
        </section>

        {/* Активный счёт */}
        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Оплата</h2>

          {!activeId ? (
            <EmptyState title="Счёт не создан" icon="🧾" description="Создайте счёт, чтобы получить реквизиты." />
          ) : depositQuery.isLoading || !deposit ? (
            <Skeleton className="h-72 w-full rounded-lg" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <StatusBadge status={deposit.status} label={DEPOSIT_STATUS_LABELS[deposit.status] ?? deposit.status} />
                {deposit.status === 'pending' ? (
                  <span className="font-display text-sm font-bold tabular-nums text-accent">
                    {formatCountdown(secondsLeft)}
                  </span>
                ) : null}
              </div>

              {deposit.status === 'pending' && deposit.qrCode ? (
                <div className="flex justify-center">
                  <img
                    src={deposit.qrCode}
                    alt="QR-код для оплаты"
                    className="h-44 w-44 rounded-lg bg-white p-2"
                    width={176}
                    height={176}
                  />
                </div>
              ) : null}

              <CopyField label="Адрес кошелька" value={deposit.walletAddress} />
              <CopyField label="Сумма, TON" value={deposit.amountTon} />
              <CopyField label="Комментарий (обязательно)" value={deposit.paymentId} />

              <div className="flex items-center justify-between rounded-lg bg-dark p-3 text-13">
                <span className="text-muted">Будет зачислено</span>
                <Money value={deposit.expectedCoins} />
              </div>

              {deposit.status === 'pending' ? (
                <a href={deposit.paymentUrl} className="btn-primary w-full">
                  Открыть в кошельке TON
                </a>
              ) : null}

              {deposit.status === 'confirmed' ? (
                <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-13">
                  <p className="font-semibold text-success">Платёж подтверждён</p>
                  <p className="mt-1 flex items-center gap-1 text-muted">
                    Получено {deposit.received.formatted} TON · зачислено <Money value={deposit.credited} size="sm" />
                  </p>
                  {deposit.txHash ? (
                    <p className="mt-1 truncate font-mono text-xxs text-muted">tx: {shorten(deposit.txHash, 12, 8)}</p>
                  ) : null}
                </div>
              ) : null}

              {deposit.status === 'expired' ? (
                <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-13 text-muted">
                  Срок действия счёта истёк. Создайте новый — уже отправленные средства будут зачислены после
                  обращения в поддержку.
                </p>
              ) : null}

              {config?.testMode && deposit.status === 'pending' ? (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={simulateMutation.isPending}
                  onClick={() => simulateMutation.mutate(deposit.paymentId)}
                >
                  Имитировать платёж (тестовый режим)
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* История пополнений */}
      <section>
        <h2 className="mb-3 font-display text-base font-bold">История пополнений</h2>
        {historyQuery.isLoading ? (
          <RowsSkeleton count={4} />
        ) : historyQuery.data && historyQuery.data.items.length > 0 ? (
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {historyQuery.data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <p className="font-mono text-13">{item.paymentId}</p>
                  <p className="text-xxs text-muted">{formatDateTime(item.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Ton value={item.amount} size="sm" />
                  <StatusBadge status={item.status} label={DEPOSIT_STATUS_LABELS[item.status] ?? item.status} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="Пополнений пока не было" icon="💎" />
        )}
      </section>
    </div>
  );
}
