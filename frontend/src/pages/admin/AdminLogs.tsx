/** Журналы действий администраторов и ошибок сервера. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiRequest, queryString } from '../../lib/api';
import { RowsSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime } from '../../lib/format';
import type { AdminLog, ErrorLog, Paged } from '../../types/api';

type Tab = 'actions' | 'errors';

export function AdminLogs(): JSX.Element {
  const [tab, setTab] = useState<Tab>('actions');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const query = useQuery({
    queryKey: ['admin', 'logs', tab, offset],
    queryFn: () =>
      apiRequest<Paged<AdminLog | ErrorLog>>(
        `${tab === 'actions' ? '/admin/logs' : '/admin/errors'}${queryString({ limit, offset })}`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            { value: 'actions', label: 'Действия администраторов' },
            { value: 'errors', label: 'Ошибки' },
          ] as Array<{ value: Tab; label: string }>
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setTab(item.value);
              setOffset(0);
            }}
            className={clsx(
              'rounded-lg px-3.5 py-2 text-13 font-semibold transition-colors',
              tab === item.value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <RowsSkeleton count={8} height="h-14" />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="panel divide-y divide-white/[0.04] overflow-hidden">
            {query.data.items.map((entry) => {
              if (tab === 'actions') {
                const log = entry as AdminLog;
                return (
                  <div key={log.id} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-accent/15 text-accent">{log.action}</span>
                      <span className="text-13">@{log.admin_username ?? 'система'}</span>
                      <span className="text-xxs text-muted">{formatDateTime(log.created_at)}</span>
                    </div>
                    {log.target_type ? (
                      <p className="mt-1 text-xxs text-muted">
                        объект: {log.target_type} {log.target_id?.slice(0, 8)}
                      </p>
                    ) : null}
                    {Object.keys(log.payload ?? {}).length > 0 ? (
                      <pre className="scrollbar-thin mt-1 overflow-x-auto rounded bg-dark p-2 font-mono text-xxs text-muted">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                );
              }

              const log = entry as ErrorLog;
              return (
                <div key={log.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        'badge',
                        log.level === 'error' || log.level === 'fatal' ? 'bg-danger/20 text-red-400' : 'bg-accent/15 text-accent',
                      )}
                    >
                      {log.level}
                    </span>
                    {log.code ? <span className="text-xxs text-muted">{log.code}</span> : null}
                    <span className="text-xxs text-muted">{formatDateTime(log.created_at)}</span>
                  </div>
                  <p className="mt-1 break-words text-13">{log.message}</p>
                  {log.context && Object.keys(log.context).length > 0 ? (
                    <p className="mt-1 font-mono text-xxs text-muted">
                      {String(log.context.method ?? '')} {String(log.context.path ?? '')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Записей нет" icon="📋" />
      )}
    </div>
  );
}
