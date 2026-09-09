/** История операций: апгрейды, пополнения, выводы и движения баланса. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiRequest, queryString } from '../lib/api';
import { Money, Ton } from '../components/Money';
import { RowsSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import {
  DEPOSIT_STATUS_LABELS,
  formatDateTime,
  formatMultiplier,
  formatPercent,
  TRANSACTION_LABELS,
  WITHDRAWAL_STATUS_LABELS,
} from '../lib/format';
import type { Deposit, Paged, Transaction, UpgradeHistoryEntry, Withdrawal } from '../types/api';

type Tab = 'upgrades' | 'transactions' | 'deposits' | 'withdrawals';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'upgrades', label: 'Апгрейды' },
  { value: 'transactions', label: 'Баланс' },
  { value: 'deposits', label: 'Пополнения' },
  { value: 'withdrawals', label: 'Выводы' },
];

export function HistoryPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('upgrades');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const query = useQuery({
    queryKey: ['history', tab, offset],
    queryFn: () => {
      const path =
        tab === 'upgrades'
          ? '/upgrades'
          : tab === 'transactions'
            ? '/transactions'
            : tab === 'deposits'
              ? '/deposits'
              : '/withdrawals';
      return apiRequest<Paged<UpgradeHistoryEntry | Transaction | Deposit | Withdrawal>>(
        `${path}${queryString({ limit, offset })}`,
      );
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">История операций</h1>

      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setTab(item.value);
              setOffset(0);
            }}
            className={clsx(
              'shrink-0 rounded-lg px-4 py-2 text-13 font-semibold transition-colors',
              tab === item.value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <RowsSkeleton count={6} height="h-16" />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {query.data.items.map((entry) => {
              if (tab === 'upgrades') {
                const upgrade = entry as UpgradeHistoryEntry;
                return (
                  <div key={upgrade.id} className="flex items-center gap-3 p-3">
                    <img
                      src={upgrade.targetImage}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded bg-dark object-contain p-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{upgrade.targetName}</p>
                      <p className="text-xxs text-muted">
                        {upgrade.sourceName} · {formatDateTime(upgrade.createdAt)}
                      </p>
                      <p className="mt-0.5 text-xxs text-muted">
                        шанс {formatPercent(upgrade.chancePercent)} · бросок {formatPercent(upgrade.rollPercent)} ·{' '}
                        {formatMultiplier(upgrade.multiplier)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={clsx(
                          'font-display text-13 font-bold',
                          upgrade.success ? 'text-success' : 'text-danger',
                        )}
                      >
                        {upgrade.success ? 'Успех' : 'Провал'}
                      </p>
                      <Money value={upgrade.targetPrice} size="sm" className="mt-0.5" />
                    </div>
                  </div>
                );
              }

              if (tab === 'transactions') {
                const transaction = entry as Transaction;
                return (
                  <div key={transaction.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {TRANSACTION_LABELS[transaction.type] ?? transaction.type}
                      </p>
                      <p className="text-xxs text-muted">{formatDateTime(transaction.createdAt)}</p>
                    </div>
                    <Money value={transaction.amount} showSign />
                  </div>
                );
              }

              if (tab === 'deposits') {
                const deposit = entry as Deposit;
                return (
                  <div key={deposit.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-mono text-13">{deposit.paymentId}</p>
                      <p className="text-xxs text-muted">{formatDateTime(deposit.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Ton value={deposit.amount} size="sm" />
                      <StatusBadge status={deposit.status} label={DEPOSIT_STATUS_LABELS[deposit.status] ?? deposit.status} />
                    </div>
                  </div>
                );
              }

              const withdrawal = entry as Withdrawal;
              return (
                <div key={withdrawal.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{withdrawal.itemName}</p>
                    <p className="text-xxs text-muted">
                      {formatDateTime(withdrawal.createdAt)} · {withdrawal.statusLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Money value={withdrawal.price} size="sm" />
                    <StatusBadge
                      status={withdrawal.status}
                      label={WITHDRAWAL_STATUS_LABELS[withdrawal.status] ?? withdrawal.status}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Записей нет" icon="🗂️" description="Здесь появится история ваших операций." />
      )}
    </div>
  );
}
