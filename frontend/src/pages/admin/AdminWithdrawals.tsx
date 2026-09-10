/** Очередь заявок на вывод предметов. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, queryString } from '../../lib/api';
import { useToast } from '../../hooks/useToast';
import { Money } from '../../components/Money';
import { Modal } from '../../components/Modal';
import { RowsSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime, WITHDRAWAL_STATUS_LABELS } from '../../lib/format';
import type { Paged, Withdrawal, WithdrawalStatus } from '../../types/api';

const STATUS_TABS: Array<{ value: WithdrawalStatus | ''; label: string }> = [
  { value: 'pending', label: 'В очереди' },
  { value: 'processing', label: 'В работе' },
  { value: 'completed', label: 'Выданы' },
  { value: 'rejected', label: 'Отклонены' },
  { value: '', label: 'Все' },
];

export function AdminWithdrawals(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<WithdrawalStatus | ''>('pending');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Withdrawal | null>(null);
  const [txHash, setTxHash] = useState('');
  const [comment, setComment] = useState('');
  const limit = 20;

  const query = useQuery({
    queryKey: ['admin', 'withdrawals', status, offset],
    queryFn: () => apiRequest<Paged<Withdrawal>>(`/admin/withdrawals${queryString({ status, limit, offset })}`),
    refetchInterval: 30_000,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };

  const action = useMutation({
    mutationFn: (input: { id: string; kind: 'take' | 'process' | 'reject' }) => {
      if (input.kind === 'take') return apiRequest(`/admin/withdrawals/${input.id}/take`, { method: 'POST' });
      if (input.kind === 'process') {
        return apiRequest(`/admin/withdrawals/${input.id}/process`, {
          method: 'POST',
          body: { txHash: txHash.trim() || undefined, comment: comment.trim() || undefined },
        });
      }
      return apiRequest(`/admin/withdrawals/${input.id}/reject`, {
        method: 'POST',
        body: { comment: comment.trim() },
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.kind === 'take' ? 'Взято в работу' : variables.kind === 'process' ? 'Заявка выполнена' : 'Заявка отклонена',
      );
      setSelected(null);
      setTxHash('');
      setComment('');
      invalidate();
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setOffset(0);
            }}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-13 font-semibold transition-colors ${
              status === tab.value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <RowsSkeleton count={5} height="h-20" />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="space-y-2">
            {query.data.items.map((withdrawal) => (
              <div key={withdrawal.id} className="panel flex flex-wrap items-center gap-3 p-3">
                {withdrawal.imageUrl ? (
                  <img src={withdrawal.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded bg-dark object-contain p-1" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{withdrawal.itemName}</p>
                  <p className="text-xxs text-muted">
                    #{withdrawal.id.slice(0, 8)} · @{withdrawal.user?.username} · ник: {withdrawal.gameNickname}
                    {withdrawal.contact ? ` · ${withdrawal.contact}` : ''}
                  </p>
                  <p className="text-xxs text-muted">{formatDateTime(withdrawal.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Money value={withdrawal.price} size="sm" />
                  <StatusBadge
                    status={withdrawal.status}
                    label={WITHDRAWAL_STATUS_LABELS[withdrawal.status] ?? withdrawal.status}
                  />
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected(withdrawal)}>
                    Открыть
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Заявок нет" icon="📭" />
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Обработка заявки">
        {selected ? (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-lg bg-dark p-3 text-13">
              {[
                ['ID заявки', selected.id],
                ['Пользователь', `@${selected.user?.username ?? '—'}`],
                ['Предмет', selected.itemName],
                ['Стоимость', `${selected.price.formatted} монет`],
                ['Игровой ник', selected.gameNickname],
                ['Контакт', selected.contact ?? '—'],
                ['Дата', formatDateTime(selected.createdAt)],
                ['Статус', WITHDRAWAL_STATUS_LABELS[selected.status] ?? selected.status],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {selected.status === 'pending' ? (
              <button
                type="button"
                className="btn-primary w-full"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: selected.id, kind: 'take' })}
              >
                Взять в работу
              </button>
            ) : null}

            {selected.status === 'pending' || selected.status === 'processing' ? (
              <>
                <div>
                  <label className="label" htmlFor="txHash">
                    TX / номер трейда (необязательно)
                  </label>
                  <input
                    id="txHash"
                    className="input"
                    value={txHash}
                    onChange={(event) => setTxHash(event.target.value)}
                    maxLength={128}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="comment">
                    Комментарий
                  </label>
                  <textarea
                    id="comment"
                    className="input min-h-[80px] py-2"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={500}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-danger flex-1"
                    disabled={action.isPending || comment.trim().length < 3}
                    onClick={() => action.mutate({ id: selected.id, kind: 'reject' })}
                  >
                    Отклонить
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: selected.id, kind: 'process' })}
                  >
                    Выдано
                  </button>
                </div>
                <p className="text-xxs text-muted">
                  Для отклонения обязательно укажите причину — пользователь увидит её в своей заявке.
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-white/5 p-3 text-13 text-muted">
                Заявка закрыта. {selected.adminComment ? `Комментарий: ${selected.adminComment}` : ''}
                {selected.txHash ? ` TX: ${selected.txHash}` : ''}
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
