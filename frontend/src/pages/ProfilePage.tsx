/**
 * Профиль: данные аккаунта, статистика, проверка честности игр
 * и тестовые инструменты (только в тестовом режиме).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';
import { RowsSkeleton } from '../components/Skeleton';
import { formatDateTime, formatPercent, shorten } from '../lib/format';
import type { Fairness, Paged, UpgradeHistoryEntry } from '../types/api';

interface VerifyResponse {
  verifiable: boolean;
  message?: string;
  verification?: { hashValid: boolean; rollValid: boolean; outcomeValid: boolean; valid: boolean; expectedRollPpm: number };
  fairness: Fairness & { serverSeed: string | null };
  formula?: string;
}

export function ProfilePage(): JSX.Element {
  const { me, logout, refresh, config } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(me?.user.displayName ?? '');
  const [gameNickname, setGameNickname] = useState(me?.user.gameNickname ?? '');
  const [contact, setContact] = useState(me?.user.contact ?? '');
  const [clientSeed, setClientSeed] = useState('');
  const [verifyId, setVerifyId] = useState<string | null>(null);

  const upgradesQuery = useQuery({
    queryKey: ['upgrades', 'profile'],
    queryFn: () => apiRequest<Paged<UpgradeHistoryEntry>>('/upgrades?limit=10'),
  });

  const verifyQuery = useQuery({
    queryKey: ['verify', verifyId],
    queryFn: () => apiRequest<VerifyResponse>(`/upgrades/${verifyId}/verify`),
    enabled: Boolean(verifyId),
  });

  const profileMutation = useMutation({
    mutationFn: () =>
      apiRequest('/user', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim() || undefined,
          gameNickname: gameNickname.trim() || undefined,
          contact: contact.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success('Профиль сохранён');
      await refresh();
    },
    onError: (error) => toast.error('Не удалось сохранить', error instanceof ApiError ? error.message : undefined),
  });

  const rotateMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ revealedServerSeed: string; newServerSeedHash: string; message: string }>(
        '/user/fairness/rotate',
        { method: 'POST', body: { clientSeed: clientSeed.trim() || undefined } },
      ),
    onSuccess: async (data) => {
      toast.success('Семя обновлено', data.message);
      setClientSeed('');
      await refresh();
      void queryClient.invalidateQueries({ queryKey: ['upgrades'] });
      void queryClient.invalidateQueries({ queryKey: ['verify'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const devBalanceMutation = useMutation({
    mutationFn: () => apiRequest('/dev/balance', { method: 'POST', body: { amount: '10000' } }),
    onSuccess: async () => {
      toast.success('Начислено 10 000 монет (тест)');
      await refresh();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const devItemsMutation = useMutation({
    mutationFn: () => apiRequest('/dev/starter-pack', { method: 'POST' }),
    onSuccess: () => {
      toast.success('Стартовый набор выдан');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  if (!me) return <RowsSkeleton count={4} height="h-24" />;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Профиль</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Аккаунт */}
        <section className="panel p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-dark">
              {me.user.avatarUrl ? (
                <img src={me.user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-xl font-bold text-accent">
                  {me.user.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold">{me.user.displayName}</p>
              <p className="truncate text-13 text-muted">@{me.user.username}</p>
              {me.user.email ? <p className="truncate text-xxs text-muted">{me.user.email}</p> : null}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="displayName">
                Отображаемое имя
              </label>
              <input
                id="displayName"
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={48}
              />
            </div>
            <div>
              <label className="label" htmlFor="gameNickname">
                Никнейм в Standoff 2
              </label>
              <input
                id="gameNickname"
                className="input"
                value={gameNickname}
                onChange={(event) => setGameNickname(event.target.value)}
                maxLength={64}
              />
            </div>
            <div>
              <label className="label" htmlFor="contactField">
                Контакт для связи
              </label>
              <input
                id="contactField"
                className="input"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={128}
              />
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              disabled={profileMutation.isPending}
              onClick={() => profileMutation.mutate()}
            >
              Сохранить
            </button>

            <button type="button" className="btn-secondary w-full" onClick={() => void logout()}>
              Выйти из аккаунта
            </button>
          </div>

          <p className="mt-4 text-xxs text-muted">Аккаунт создан {formatDateTime(me.user.createdAt)}</p>
        </section>

        <div className="space-y-4">
          {/* Статистика */}
          <section className="panel p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Статистика</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Всего апгрейдов', value: String(me.stats.total) },
                { label: 'Успешных', value: String(me.stats.wins) },
                { label: 'Доля успеха', value: formatPercent(me.stats.winRate) },
                { label: 'Неудачных', value: String(me.stats.losses) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-dark p-3">
                  <p className="text-xxs uppercase text-muted">{stat.label}</p>
                  <p className="mt-1 font-display text-base font-bold">{stat.value}</p>
                </div>
              ))}
              <div className="rounded-lg bg-dark p-3">
                <p className="text-xxs uppercase text-muted">Лучший выигрыш</p>
                <Money value={me.stats.bestWin} className="mt-1 text-success" />
              </div>
              <div className="rounded-lg bg-dark p-3">
                <p className="text-xxs uppercase text-muted">Всего сыграно</p>
                <Money value={me.stats.wagered} className="mt-1" />
              </div>
            </div>
          </section>

          {/* Честная игра */}
          <section className="panel p-4">
            <h2 className="mb-1 font-display text-sm font-bold">Честная игра</h2>
            <p className="mb-3 text-xxs leading-relaxed text-muted">
              Результат каждого апгрейда вычисляется как HMAC-SHA256 от секретного серверного семени. Его хеш
              публикуется до игры, а само семя раскрывается после смены — тогда любую прошлую игру можно
              пересчитать вручную.
            </p>

            <dl className="space-y-2 rounded-lg bg-dark p-3 text-13">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Хеш серверного семени</dt>
                <dd className="truncate font-mono text-xxs">{shorten(me.fairness.serverSeedHash, 10, 8)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Клиентское семя</dt>
                <dd className="truncate font-mono text-xxs">{me.fairness.clientSeed}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Номер игры (nonce)</dt>
                <dd className="font-mono text-xxs">{me.fairness.nonce}</dd>
              </div>
            </dl>

            <div className="mt-3 flex gap-2">
              <input
                className="input"
                placeholder="Своё клиентское семя (необязательно)"
                value={clientSeed}
                onChange={(event) => setClientSeed(event.target.value)}
                maxLength={64}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={rotateMutation.isPending}
                onClick={() => rotateMutation.mutate()}
              >
                Сменить семя
              </button>
            </div>
          </section>

          {/* Тестовые инструменты */}
          {config?.testMode ? (
            <section className="panel border-danger/30 p-4">
              <h2 className="mb-2 font-display text-sm font-bold text-red-300">Тестовый режим</h2>
              <p className="mb-3 text-xxs text-muted">
                Эти кнопки доступны только при TEST_MODE=true и полностью отключены в production.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={devBalanceMutation.isPending}
                  onClick={() => devBalanceMutation.mutate()}
                >
                  +10 000 монет
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={devItemsMutation.isPending}
                  onClick={() => devItemsMutation.mutate()}
                >
                  Выдать предметы
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* Последние игры с проверкой */}
      <section>
        <h2 className="mb-3 font-display text-base font-bold">Последние игры</h2>
        {upgradesQuery.isLoading ? (
          <RowsSkeleton count={4} />
        ) : upgradesQuery.data && upgradesQuery.data.items.length > 0 ? (
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {upgradesQuery.data.items.map((upgrade) => (
              <div key={upgrade.id} className="flex items-center gap-3 p-3">
                <img src={upgrade.targetImage} alt="" className="h-10 w-10 shrink-0 rounded bg-dark object-contain p-1" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-13 font-medium">{upgrade.targetName}</p>
                  <p className="text-xxs text-muted">
                    шанс {formatPercent(upgrade.chancePercent)} · бросок {formatPercent(upgrade.rollPercent)}
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setVerifyId(upgrade.id)}>
                  Проверить
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel p-4 text-center text-13 text-muted">Игр пока не было</p>
        )}
      </section>

      {/* Модальное окно проверки */}
      <Modal open={Boolean(verifyId)} onClose={() => setVerifyId(null)} title="Проверка честности">
        {verifyQuery.isLoading ? (
          <RowsSkeleton count={3} />
        ) : verifyQuery.data ? (
          <div className="space-y-3 text-13">
            {verifyQuery.data.verifiable && verifyQuery.data.verification ? (
              <>
                <div
                  className={`rounded-lg border p-3 ${
                    verifyQuery.data.verification.valid
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-danger/40 bg-danger/10 text-red-300'
                  }`}
                >
                  <p className="font-display font-bold">
                    {verifyQuery.data.verification.valid ? 'Игра честная ✓' : 'Проверка не пройдена'}
                  </p>
                </div>

                <dl className="space-y-2 rounded-lg bg-dark p-3">
                  {[
                    ['Хеш семени совпал', verifyQuery.data.verification.hashValid],
                    ['Бросок воспроизведён', verifyQuery.data.verification.rollValid],
                    ['Исход соответствует шансу', verifyQuery.data.verification.outcomeValid],
                  ].map(([label, ok]) => (
                    <div key={String(label)} className="flex justify-between">
                      <dt className="text-muted">{label}</dt>
                      <dd className={ok ? 'text-success' : 'text-danger'}>{ok ? 'да' : 'нет'}</dd>
                    </div>
                  ))}
                </dl>

                <div className="space-y-1 rounded-lg bg-dark p-3 font-mono text-xxs">
                  <p className="break-all">
                    <span className="text-muted">server_seed: </span>
                    {verifyQuery.data.fairness.serverSeed}
                  </p>
                  <p className="break-all">
                    <span className="text-muted">client_seed: </span>
                    {verifyQuery.data.fairness.clientSeed}
                  </p>
                  <p>
                    <span className="text-muted">nonce: </span>
                    {verifyQuery.data.fairness.nonce}
                  </p>
                </div>

                {verifyQuery.data.formula ? (
                  <p className="text-xxs leading-relaxed text-muted">Формула: {verifyQuery.data.formula}</p>
                ) : null}
              </>
            ) : (
              <p className="rounded-lg bg-dark p-3 text-muted">{verifyQuery.data.message}</p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
