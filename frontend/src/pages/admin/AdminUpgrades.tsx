/** История всех апгрейдов площадки. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiRequest, queryString } from '../../lib/api';
import { Money } from '../../components/Money';
import { RowsSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime, formatMultiplier, formatPercent } from '../../lib/format';
import type { AdminUpgrade, Paged } from '../../types/api';

export function AdminUpgrades(): JSX.Element {
  const [onlyWins, setOnlyWins] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const query = useQuery({
    queryKey: ['admin', 'upgrades', onlyWins, offset],
    queryFn: () =>
      apiRequest<Paged<AdminUpgrade>>(`/admin/upgrades${queryString({ onlyWins: onlyWins ? 'true' : '', limit, offset })}`),
  });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-13">
        <input
          type="checkbox"
          checked={onlyWins}
          onChange={(event) => {
            setOnlyWins(event.target.checked);
            setOffset(0);
          }}
          className="h-4 w-4 accent-[#fbd506]"
        />
        Только успешные
      </label>

      {query.isLoading ? (
        <RowsSkeleton count={8} height="h-14" />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          {/* На мобильных — карточки, на десктопе — таблица */}
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[720px] text-13">
              <thead className="border-b border-white/[0.06] text-left text-xxs uppercase text-muted">
                <tr>
                  <th className="p-3">Дата</th>
                  <th className="p-3">Игрок</th>
                  <th className="p-3">Цель</th>
                  <th className="p-3">Ставка</th>
                  <th className="p-3">Шанс</th>
                  <th className="p-3">Бросок</th>
                  <th className="p-3">Коэф.</th>
                  <th className="p-3">Итог</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {query.data.items.map((upgrade) => (
                  <tr key={upgrade.id} className="hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap p-3 text-xxs text-muted">{formatDateTime(upgrade.createdAt)}</td>
                    <td className="p-3">@{upgrade.username}</td>
                    <td className="max-w-[180px] truncate p-3">{upgrade.targetName}</td>
                    <td className="p-3">
                      <Money value={upgrade.sourcePrice} size="sm" />
                    </td>
                    <td className="p-3 text-accent">{formatPercent(upgrade.chancePercent)}</td>
                    <td className="p-3 tabular-nums">{formatPercent(upgrade.rollPercent)}</td>
                    <td className="p-3">{formatMultiplier(upgrade.multiplier)}</td>
                    <td className={clsx('p-3 font-semibold', upgrade.success ? 'text-success' : 'text-danger')}>
                      {upgrade.success ? 'успех' : 'провал'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Апгрейдов нет" icon="🎲" />
      )}
    </div>
  );
}
