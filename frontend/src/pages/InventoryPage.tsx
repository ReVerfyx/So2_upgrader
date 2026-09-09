/** Инвентарь: просмотр, подробности, продажа и отправка на вывод. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, queryString } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { ItemCard } from '../components/ItemCard';
import { ItemGridSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Money } from '../components/Money';
import { Pagination } from '../components/Pagination';
import { CONDITION_LABELS, RARITY_LABELS, formatDateTime } from '../lib/format';
import type { InventoryItem, Paged } from '../types/api';

type StatusFilter = 'available' | 'locked' | 'withdrawn' | 'all';

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'available', label: 'Доступные' },
  { value: 'locked', label: 'В заявках' },
  { value: 'withdrawn', label: 'Выведенные' },
  { value: 'all', label: 'Все' },
];

const SORT_OPTIONS = [
  { value: 'price_desc', label: 'Сначала дорогие' },
  { value: 'price_asc', label: 'Сначала дешёвые' },
  { value: 'newest', label: 'Сначала новые' },
] as const;

export function InventoryPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('available');
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]['value']>('price_desc');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const limit = 24;

  const inventoryQuery = useQuery({
    queryKey: ['inventory', status, sort, offset],
    queryFn: () =>
      apiRequest<Paged<InventoryItem> & { totalValue: { formatted: string } }>(
        `/inventory${queryString({ status, sort, limit, offset })}`,
      ),
  });

  const sellMutation = useMutation({
    mutationFn: (inventoryId: string) => apiRequest(`/inventory/${inventoryId}/sell`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Предмет продан', 'Сумма зачислена на баланс');
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error) => {
      toast.error('Не удалось продать предмет', error instanceof ApiError ? error.message : undefined);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold">Инвентарь</h1>
          {inventoryQuery.data ? (
            <p className="mt-0.5 text-13 text-muted">
              {inventoryQuery.data.total} предметов на {inventoryQuery.data.totalValue.formatted} монет
            </p>
          ) : null}
        </div>

        <select
          className="input h-10 w-auto"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as typeof sort);
            setOffset(0);
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Вкладки статусов — горизонтальная прокрутка на мобильных */}
      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setOffset(0);
            }}
            className={`shrink-0 rounded-lg px-4 py-2 text-13 font-semibold transition-colors ${
              status === tab.value ? 'bg-gradient-accent text-black' : 'bg-dark text-muted hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {inventoryQuery.isLoading ? (
        <ItemGridSkeleton count={12} />
      ) : inventoryQuery.data && inventoryQuery.data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {inventoryQuery.data.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onClick={() => setSelected(item)}
                badge={item.status === 'locked' ? 'в заявке' : item.status === 'withdrawn' ? 'выведен' : undefined}
              />
            ))}
          </div>
          <Pagination total={inventoryQuery.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState
          title="Здесь пока пусто"
          icon="🎒"
          description="Сыграйте в апгрейд на баланс, чтобы получить первый предмет."
          action={
            <Link to="/upgrade" className="btn-primary">
              К апгрейду
            </Link>
          }
        />
      )}

      {/* Подробности предмета */}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Информация о предмете">
        {selected ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <img
                src={selected.imageUrl}
                alt={selected.name}
                className="h-28 w-28 shrink-0 rounded-lg bg-dark object-contain p-2"
              />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-bold">{selected.name}</h3>
                <p className="mt-0.5 text-13 text-muted">{RARITY_LABELS[selected.rarity]}</p>
                <Money value={selected.currentPrice} size="lg" className="mt-2" />
              </div>
            </div>

            <dl className="space-y-2 rounded-lg bg-dark p-3 text-13">
              {[
                ['Идентификатор', selected.id],
                ['Оружие', selected.weapon],
                ['Состояние', CONDITION_LABELS[selected.condition]],
                ['Цена получения', `${selected.price.formatted} монет`],
                ['Получен', formatDateTime(selected.createdAt)],
                [
                  'Статус',
                  selected.status === 'available'
                    ? 'Доступен'
                    : selected.status === 'locked'
                      ? 'В заявке на вывод'
                      : selected.status === 'withdrawn'
                        ? 'Выведен'
                        : 'Использован',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {selected.status === 'available' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setSelected(null);
                    navigate('/upgrade');
                  }}
                >
                  Улучшить
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!selected.isWithdrawable}
                  onClick={() => {
                    setSelected(null);
                    navigate(`/withdraw?item=${selected.id}`);
                  }}
                >
                  Вывести
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={sellMutation.isPending}
                  onClick={() => sellMutation.mutate(selected.id)}
                >
                  Продать
                </button>
              </div>
            ) : (
              <p className="rounded-lg bg-white/5 p-3 text-center text-13 text-muted">
                Действия недоступны: предмет {selected.status === 'locked' ? 'участвует в заявке на вывод' : 'больше не в инвентаре'}.
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
