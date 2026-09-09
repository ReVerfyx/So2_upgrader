/** Управление пользователями: поиск, блокировка, корректировка баланса. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, queryString } from '../../lib/api';
import { useToast } from '../../hooks/useToast';
import { Money } from '../../components/Money';
import { Modal } from '../../components/Modal';
import { RowsSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime } from '../../lib/format';
import type { AdminUser, Paged } from '../../types/api';

export function AdminUsers(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('1');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const limit = 20;

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', search, offset],
    queryFn: () => apiRequest<Paged<AdminUser>>(`/admin/users${queryString({ search, limit, offset })}`),
  });

  const refetchAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };

  const balanceMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ balance: { formatted: string } }>(`/admin/users/${selected?.id}/balance`, {
        method: 'POST',
        body: { amount: amount.replace(',', '.'), direction, reason },
      }),
    onSuccess: (data) => {
      toast.success('Баланс изменён', `Новый баланс: ${data.balance.formatted} монет`);
      setReason('');
      setSelected(null);
      refetchAll();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  const blockMutation = useMutation({
    mutationFn: (input: { userId: string; blocked: boolean; reason?: string }) =>
      apiRequest(`/admin/users/${input.userId}/block`, {
        method: 'POST',
        body: { blocked: input.blocked, reason: input.reason },
      }),
    onSuccess: (_data, variables) => {
      toast.success(variables.blocked ? 'Пользователь заблокирован' : 'Блокировка снята');
      setSelected(null);
      setBlockReason('');
      refetchAll();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  return (
    <div className="space-y-4">
      <input
        className="input max-w-sm"
        placeholder="Поиск по логину, имени или почте"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
      />

      {usersQuery.isLoading ? (
        <RowsSkeleton count={6} height="h-16" />
      ) : usersQuery.data && usersQuery.data.items.length > 0 ? (
        <>
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {usersQuery.data.items.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelected(user)}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{user.displayName}</p>
                    <span className="text-xxs text-muted">@{user.username}</span>
                    {user.role === 'admin' ? <span className="badge bg-accent/15 text-accent">админ</span> : null}
                    {user.isBlocked ? <span className="badge bg-danger/20 text-red-400">заблокирован</span> : null}
                  </div>
                  <p className="mt-0.5 text-xxs text-muted">
                    {user.authProvider === 'google' ? 'Google' : user.authProvider === 'test' ? 'тест' : 'пароль'} ·
                    предметов {user.inventoryCount} · апгрейдов {user.upgradesCount} ·{' '}
                    {formatDateTime(user.createdAt)}
                  </p>
                </div>
                <Money value={user.balance} size="sm" />
              </button>
            ))}
          </div>
          <Pagination total={usersQuery.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Пользователи не найдены" icon="👤" />
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Пользователь">
        {selected ? (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-lg bg-dark p-3 text-13">
              {[
                ['Логин', `@${selected.username}`],
                ['Имя', selected.displayName],
                ['Почта', selected.email ?? '—'],
                ['Способ входа', selected.authProvider],
                ['Баланс', `${selected.balance.formatted} монет`],
                ['Пополнено всего', `${selected.depositedTotal.formatted} монет`],
                ['Предметов', String(selected.inventoryCount)],
                ['Апгрейдов', String(selected.upgradesCount)],
                ['Регистрация', formatDateTime(selected.createdAt)],
                ['Последний вход', selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {/* Корректировка баланса */}
            <div className="rounded-lg border border-white/10 p-3">
              <p className="mb-2 font-display text-13 font-bold">Корректировка баланса</p>
              <div className="mb-2 flex gap-2">
                {(['credit', 'debit'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDirection(value)}
                    className={`flex-1 rounded-lg py-2 text-13 font-semibold transition-colors ${
                      direction === value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted'
                    }`}
                  >
                    {value === 'credit' ? 'Начислить' : 'Списать'}
                  </button>
                ))}
              </div>
              <input
                className="input mb-2"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Сумма, монет"
              />
              <input
                className="input mb-2"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Причина (обязательно)"
                maxLength={300}
              />
              <button
                type="button"
                className="btn-primary w-full"
                disabled={reason.trim().length < 3 || balanceMutation.isPending}
                onClick={() => balanceMutation.mutate()}
              >
                Применить
              </button>
            </div>

            {/* Блокировка */}
            <div className="rounded-lg border border-white/10 p-3">
              <p className="mb-2 font-display text-13 font-bold">Доступ</p>
              {selected.isBlocked ? (
                <>
                  <p className="mb-2 text-13 text-muted">Причина: {selected.blockReason ?? '—'}</p>
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    disabled={blockMutation.isPending}
                    onClick={() => blockMutation.mutate({ userId: selected.id, blocked: false })}
                  >
                    Разблокировать
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="input mb-2"
                    value={blockReason}
                    onChange={(event) => setBlockReason(event.target.value)}
                    placeholder="Причина блокировки"
                    maxLength={300}
                  />
                  <button
                    type="button"
                    className="btn-danger w-full"
                    disabled={blockMutation.isPending}
                    onClick={() => blockMutation.mutate({ userId: selected.id, blocked: true, reason: blockReason })}
                  >
                    Заблокировать
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
