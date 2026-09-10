/** Сводка по площадке. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/api';
import { Money } from '../../components/Money';
import { StatSkeleton } from '../../components/Skeleton';
import { formatPercent } from '../../lib/format';
import type { AdminStats } from '../../types/api';

function Tile({ title, value, hint, to }: { title: string; value: JSX.Element | string; hint?: string; to?: string }): JSX.Element {
  const content = (
    <div className="panel h-full p-4 transition-colors hover:border-white/15">
      <p className="text-xxs uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1.5 font-display text-xl font-bold">{value}</p>
      {hint ? <p className="mt-0.5 text-xxs text-muted">{hint}</p> : null}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export function AdminDashboard(): JSX.Element {
  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiRequest<{ stats: AdminStats }>('/admin/stats'),
    refetchInterval: 30_000,
  });

  if (statsQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>
    );
  }

  const stats = statsQuery.data?.stats;
  if (!stats) return <p className="panel p-4 text-13 text-muted">Не удалось загрузить статистику</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title="Пользователей" value={String(stats.users.total)} hint={`новых за сутки: ${stats.users.newToday}`} to="/admin/users" />
        <Tile title="Заблокировано" value={String(stats.users.blocked)} to="/admin/users" />
        <Tile title="Баланс игроков" value={<Money value={stats.balance.totalNano} size="lg" />} />
        <Tile title="Ошибок за сутки" value={String(stats.errors.last24h)} to="/admin/logs" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Пополнения</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xxs uppercase text-muted">Ожидают</p>
              <p className="mt-1 font-display text-lg font-bold text-accent">{stats.deposits.pending}</p>
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">Всего принято</p>
              <Money value={stats.deposits.confirmedTotal} className="mt-1" />
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">За сутки</p>
              <Money value={stats.deposits.today} className="mt-1 text-success" />
            </div>
          </div>
          <Link to="/admin/deposits" className="btn-secondary btn-sm mt-4 w-full">
            Все платежи
          </Link>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Выводы</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xxs uppercase text-muted">В очереди</p>
              <p className="mt-1 font-display text-lg font-bold text-accent">{stats.withdrawals.pending}</p>
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">В работе</p>
              <p className="mt-1 font-display text-lg font-bold">{stats.withdrawals.processing}</p>
            </div>
            <div>
              <p className="text-xxs uppercase text-muted">Выдано</p>
              <p className="mt-1 font-display text-lg font-bold text-success">{stats.withdrawals.completed}</p>
            </div>
          </div>
          <Link to="/admin/withdrawals" className="btn-primary btn-sm mt-4 w-full">
            Обработать очередь
          </Link>
        </section>
      </div>

      <section className="panel p-4">
        <h2 className="mb-3 font-display text-sm font-bold">Апгрейды</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xxs uppercase text-muted">Всего</p>
            <p className="mt-1 font-display text-lg font-bold">{stats.upgrades.total}</p>
          </div>
          <div>
            <p className="text-xxs uppercase text-muted">За сутки</p>
            <p className="mt-1 font-display text-lg font-bold">{stats.upgrades.today}</p>
          </div>
          <div>
            <p className="text-xxs uppercase text-muted">Доля успеха</p>
            <p className="mt-1 font-display text-lg font-bold text-accent">{formatPercent(stats.upgrades.winRate)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
