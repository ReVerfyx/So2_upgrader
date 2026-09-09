/**
 * Главная страница.
 * Сразу показывает: баланс, быстрый переход в апгрейд, топ предметов,
 * последние операции пользователя и живую ленту выигрышей площадки.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryString } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Money } from '../components/Money';
import { ItemCard } from '../components/ItemCard';
import { ItemGridSkeleton, RowsSkeleton, Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { formatPercent, formatRelative, TRANSACTION_LABELS } from '../lib/format';
import { TelegramLink } from '../components/TelegramLink';
import type { Item, Paged, Transaction, UpgradeHistoryEntry, UpgradeSettings } from '../types/api';

function StatCard({ title, value, hint }: { title: string; value: JSX.Element | string; hint?: string }): JSX.Element {
  return (
    <div className="panel flex flex-col justify-between p-3 sm:p-4">
      <span className="text-xxs uppercase tracking-wide text-muted">{title}</span>
      <span className="mt-1.5 font-display text-lg font-bold sm:text-xl">{value}</span>
      {hint ? <span className="mt-0.5 text-xxs text-muted">{hint}</span> : null}
    </div>
  );
}

export function HomePage(): JSX.Element {
  const { me, isAuthenticated } = useAuth();

  const itemsQuery = useQuery({
    queryKey: ['items', 'featured'],
    queryFn: () => apiRequest<Paged<Item>>(`/items${queryString({ limit: 10, sort: 'price_desc' })}`),
    staleTime: 60_000,
  });

  const settingsQuery = useQuery({
    queryKey: ['upgrade-settings'],
    queryFn: () => apiRequest<UpgradeSettings>('/upgrades/settings'),
    staleTime: 5 * 60_000,
  });

  const recentQuery = useQuery({
    queryKey: ['upgrades', 'recent'],
    queryFn: () => apiRequest<{ items: UpgradeHistoryEntry[] }>('/upgrades/recent?limit=12'),
    refetchInterval: 20_000,
  });

  const transactionsQuery = useQuery({
    queryKey: ['transactions', 'home'],
    queryFn: () => apiRequest<Paged<Transaction>>(`/transactions${queryString({ limit: 5 })}`),
    enabled: isAuthenticated,
  });

  return (
    <div className="space-y-6">
      {/* Приветственный блок */}
      <section className="panel relative overflow-hidden p-4 sm:p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #fbd506 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h1 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              Апгрейд скинов <span className="text-gradient-accent">Standoff 2</span>
            </h1>
            <p className="mt-2 text-13 leading-relaxed text-muted sm:text-sm">
              Честные шансы: вероятность считает сервер, результат можно перепроверить самостоятельно.
              Пополнение в TON, прозрачная очередь вывода предметов.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/upgrade" className="btn-primary">
                Начать апгрейд
              </Link>
              {isAuthenticated ? (
                <Link to="/deposit" className="btn-secondary">
                  Пополнить баланс
                </Link>
              ) : (
                <Link to="/login" className="btn-secondary">
                  Войти
                </Link>
              )}
              <TelegramLink className="btn-ghost" label="Telegram" />
            </div>
          </div>

          {settingsQuery.data ? (
            <div className="grid grid-cols-3 gap-2 lg:w-80">
              <div className="panel-card p-3 text-center">
                <p className="font-display text-lg font-bold text-accent">
                  {settingsQuery.data.maxChancePercent}%
                </p>
                <p className="text-xxs text-muted">макс. шанс</p>
              </div>
              <div className="panel-card p-3 text-center">
                <p className="font-display text-lg font-bold text-accent">x{settingsQuery.data.maxMultiplier}</p>
                <p className="text-xxs text-muted">макс. коэф.</p>
              </div>
              <div className="panel-card p-3 text-center">
                <p className="font-display text-lg font-bold text-accent">
                  {settingsQuery.data.houseEdgePercent}%
                </p>
                <p className="text-xxs text-muted">комиссия</p>
              </div>
            </div>
          ) : (
            <Skeleton className="h-20 w-full rounded-lg lg:w-80" />
          )}
        </div>
      </section>

      {/* Личные показатели */}
      {isAuthenticated && me ? (
        <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard title="Баланс" value={<Money value={me.balance} size="lg" />} />
          <StatCard
            title="Предметов"
            value={String(me.inventory.count)}
            hint={`на ${me.inventory.value.formatted} монет`}
          />
          <StatCard title="Апгрейдов" value={String(me.stats.total)} hint={`успешных ${me.stats.wins}`} />
          <StatCard title="Доля успеха" value={formatPercent(me.stats.winRate)} />
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Топ предметов */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Топ предметов</h2>
            <Link to="/upgrade" className="text-13 font-semibold text-accent hover:underline">
              Все предметы →
            </Link>
          </div>

          {itemsQuery.isLoading ? (
            <ItemGridSkeleton count={8} />
          ) : itemsQuery.data && itemsQuery.data.items.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {itemsQuery.data.items.slice(0, 8).map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState title="Каталог пуст" description="Администратор ещё не добавил предметы." />
          )}
        </section>

        <div className="space-y-6">
          {/* Лента выигрышей */}
          <section>
            <h2 className="mb-3 font-display text-base font-bold">Последние выигрыши</h2>
            <div className="panel divide-y divide-white/[0.04] overflow-hidden">
              {recentQuery.isLoading ? (
                <div className="p-3">
                  <RowsSkeleton count={4} height="h-12" />
                </div>
              ) : recentQuery.data && recentQuery.data.items.length > 0 ? (
                recentQuery.data.items.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 p-2.5">
                    <img
                      src={entry.targetImage}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded object-contain"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 font-medium">{entry.targetName}</p>
                      <p className="truncate text-xxs text-muted">
                        {entry.user?.displayName ?? 'Игрок'} · {formatRelative(entry.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={entry.targetPrice} size="sm" />
                      <p className="text-xxs text-muted">{formatPercent(entry.chancePercent)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4">
                  <EmptyState title="Пока нет выигрышей" icon="🎯" description="Станьте первым — сделайте апгрейд." />
                </div>
              )}
            </div>
          </section>

          {/* Последние операции */}
          {isAuthenticated ? (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-base font-bold">Последние операции</h2>
                <Link to="/history" className="text-13 font-semibold text-accent hover:underline">
                  Вся история →
                </Link>
              </div>
              <div className="panel divide-y divide-white/[0.04] overflow-hidden">
                {transactionsQuery.isLoading ? (
                  <div className="p-3">
                    <RowsSkeleton count={3} height="h-12" />
                  </div>
                ) : transactionsQuery.data && transactionsQuery.data.items.length > 0 ? (
                  transactionsQuery.data.items.map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between gap-3 p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-13 font-medium">
                          {TRANSACTION_LABELS[transaction.type] ?? transaction.type}
                        </p>
                        <p className="text-xxs text-muted">{formatRelative(transaction.createdAt)}</p>
                      </div>
                      <Money value={transaction.amount} size="sm" showSign />
                    </div>
                  ))
                ) : (
                  <div className="p-4">
                    <EmptyState title="Операций пока нет" icon="🧾" />
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
