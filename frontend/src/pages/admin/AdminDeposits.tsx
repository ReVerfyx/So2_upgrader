/** Просмотр платежей и ручное подтверждение. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, queryString } from '../../lib/api';
import { useToast } from '../../hooks/useToast';
import { Money, Ton } from '../../components/Money';
import { Modal } from '../../components/Modal';
import { RowsSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { DEPOSIT_STATUS_LABELS, formatDateTime, shorten } from '../../lib/format';
import type { AdminDeposit, Paged } from '../../types/api';

const STATUS_TABS = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Ожидают' },
  { value: 'confirmed', label: 'Зачислены' },
  { value: 'expired', label: 'Истёкшие' },
];

export function AdminDeposits(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminDeposit | null>(null);
  const [txHash, setTxHash] = useState('');
  const [comment, setComment] = useState('');
  const limit = 20;

  const query = useQuery({
    queryKey: ['admin', 'deposits', status, offset],
    queryFn: () => apiRequest<Paged<AdminDeposit>>(`/admin/deposits${queryString({ status, limit, offset })}`),
  });

  const checkMutation = useMutation({
    mutationFn: () => apiRequest<{ stats: Record<string, number> }>('/admin/deposits/check', { method: 'POST' }),
    onSuccess: (data) => {
      toast.success('Проверка выполнена', `Зачислено: ${data.stats.credited}, проверено: ${data.stats.checked}`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
    },
    onError: (error) => toast.error('Ошибка проверки', error instanceof ApiError ? error.message : undefined),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/deposits/${selected?.id}/confirm`, {
        method: 'POST',
        body: { txHash: txHash.trim(), comment: comment.trim() || undefined },
      }),
    onSuccess: () => {
      toast.success('Платёж подтверждён вручную');
      setSelected(null);
      setTxHash('');
      setComment('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (error) => toast.error('Ошибка', error instanceof ApiError ? error.message : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
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

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={checkMutation.isPending}
          onClick={() => checkMutation.mutate()}
        >
          Проверить блокчейн
        </button>
      </div>

      {query.isLoading ? (
        <RowsSkeleton count={6} height="h-16" />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {query.data.items.map((deposit) => (
              <button
                key={deposit.id}
                type="button"
                onClick={() => setSelected(deposit)}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-13">{deposit.paymentId}</p>
                  <p className="text-xxs text-muted">
                    @{deposit.username} · {formatDateTime(deposit.createdAt)}
                    {deposit.txHash ? ` · tx ${shorten(deposit.txHash, 8, 6)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Ton value={deposit.amountTon} size="sm" />
                  <Money value={deposit.credited} size="sm" />
                  <StatusBadge status={deposit.status} label={DEPOSIT_STATUS_LABELS[deposit.status] ?? deposit.status} />
                </div>
              </button>
            ))}
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Платежей нет" icon="💳" />
      )}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Платёж">
        {selected ? (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-lg bg-dark p-3 text-13">
              {[
                ['Идентификатор', selected.paymentId],
                ['Пользователь', `@${selected.username}`],
                ['Сумма счёта', `${selected.amountTon.formatted} TON`],
                ['Получено', `${selected.receivedTon.formatted} TON`],
                ['Зачислено', `${selected.credited.formatted} монет`],
                ['Статус', DEPOSIT_STATUS_LABELS[selected.status] ?? selected.status],
                ['Создан', formatDateTime(selected.createdAt)],
                ['Истекает', formatDateTime(selected.expiresAt)],
                ['Подтверждён', selected.confirmedAt ? formatDateTime(selected.confirmedAt) : '—'],
                ['TX', selected.txHash ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {selected.status !== 'confirmed' ? (
              <div className="rounded-lg border border-white/10 p-3">
                <p className="mb-2 font-display text-13 font-bold">Ручное подтверждение</p>
                <p className="mb-2 text-xxs text-muted">
                  Используйте, только если перевод действительно пришёл, но не был распознан автоматически
                  (например, без комментария). Действие фиксируется в журнале.
                </p>
                <input
                  className="input mb-2"
                  value={txHash}
                  onChange={(event) => setTxHash(event.target.value)}
                  placeholder="Хеш транзакции"
                  maxLength={128}
                />
                <input
                  className="input mb-2"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Комментарий"
                  maxLength={300}
                />
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={txHash.trim().length < 4 || confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                >
                  Подтвердить и зачислить
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
