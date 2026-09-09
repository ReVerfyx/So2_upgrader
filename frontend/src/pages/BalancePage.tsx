/** Баланс и журнал операций. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryString } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Money } from '../components/Money';
import { RowsSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, TRANSACTION_LABELS } from '../lib/format';
import type { Paged, Transaction } from '../types/api';

const TYPE_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'deposit', label: 'Пополнения' },
  { value: 'upgrade_stake', label: 'Ставки' },
  { value: 'item_sell', label: 'Продажи' },
  { value: 'admin_adjust', label: 'Корректировки' },
];

export function BalancePage(): JSX.Element {
  const { me } = useAuth();
  const [type, setType] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const transactionsQuery = useQuery({
    queryKey: ['transactions', type, offset],
    queryFn: () => apiRequest<Paged<Transaction>>(`/transactions${queryString({ type, limit, offset })}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Баланс</h1>

      {/* Карточка баланса */}
      <section className="panel relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #fbd506 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xxs uppercase tracking-widest text-muted">Доступно</p>
            <Money value={me?.balance ?? '0'} size="xl" className="mt-1 text-3xl" />
            {me && Number(me.locked.coins) > 0 ? (
              <p className="mt-1 text-13 text-muted">Зарезервировано: {me.locked.formatted} монет</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to="/deposit" className="btn-primary flex-1 sm:flex-none">
              Пополнить
            </Link>
            <Link to="/upgrade" className="btn-secondary flex-1 sm:flex-none">
              Играть
            </Link>
            <Link to="/withdraw" className="btn-secondary flex-1 sm:flex-none">
              Вывести предмет
            </Link>
          </div>
        </div>

        {me ? (
          <div className="relative mt-5 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
            <div>
              <p className="text-xxs uppercase text-muted">Предметов</p>
              <p className="mt-1 font-display font-bold">{me.inventory.count}</p>
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">Стоимость инвентаря</p>
              <Money value={me.inventory.value} className="mt-1" />
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">Сыграно</p>
              <Money value={me.stats.wagered} className="mt-1" />
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">Лучший выигрыш</p>
              <Money value={me.stats.bestWin} className="mt-1 text-success" />
            </div>
          </div>
        ) : null}
      </section>

      {/* Журнал операций */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">Журнал операций</h2>
        </div>

        <div className="no-scrollbar -mx-3 mb-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => {
                setType(filter.value);
                setOffset(0);
              }}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-13 font-semibold transition-colors ${
                type === filter.value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {transactionsQuery.isLoading ? (
          <RowsSkeleton count={6} />
        ) : transactionsQuery.data && transactionsQuery.data.items.length > 0 ? (
          <>
            <div className="panel divide-y divide-white/[0.04] overflow-hidden">
              {transactionsQuery.data.items.map((transaction) => (
                <div key={transaction.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">
                        {TRANSACTION_LABELS[transaction.type] ?? transaction.type}
                      </p>
                      <StatusBadge status={transaction.status} label={transaction.status === 'completed' ? 'Проведена' : transaction.status} />
                    </div>
                    <p className="mt-0.5 text-xxs text-muted">
                      {formatDateTime(transaction.createdAt)} · было {transaction.balanceBefore.formatted} → стало{' '}
                      {transaction.balanceAfter.formatted} монет
                    </p>
                    {transaction.txHash ? (
                      <p className="mt-0.5 truncate font-mono text-xxs text-muted">tx: {transaction.txHash}</p>
                    ) : null}
                  </div>
                  <Money value={transaction.amount} showSign />
                </div>
              ))}
            </div>
            <Pagination total={transactionsQuery.data.total} limit={limit} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <EmptyState title="Операций пока нет" icon="🧾" description="Здесь появятся пополнения, ставки и выигрыши." />
        )}
      </section>
    </div>
  );
}
