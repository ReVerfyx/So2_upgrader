/**
 * Управление каталогом предметов.
 * Изображения задаются ссылкой — их можно менять без изменения кода.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, queryString } from '../../lib/api';
import { useToast } from '../../hooks/useToast';
import { Money } from '../../components/Money';
import { Modal } from '../../components/Modal';
import { ItemGridSkeleton } from '../../components/Skeleton';
import { Pagination } from '../../components/Pagination';
import { EmptyState } from '../../components/EmptyState';
import { ItemCard } from '../../components/ItemCard';
import { RARITY_LABELS, CONDITION_LABELS } from '../../lib/format';
import type { Condition, Item, Paged, Rarity } from '../../types/api';

interface FormState {
  slug: string;
  name: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  price: string;
  isActive: boolean;
  isWithdrawable: boolean;
  description: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  name: '',
  weapon: 'AKR',
  rarity: 'common',
  condition: 'field_tested',
  imageUrl: '/items/placeholder-common.svg',
  price: '1',
  isActive: true,
  isWithdrawable: true,
  description: '',
};

export function AdminItems(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const limit = 24;

  const query = useQuery({
    queryKey: ['admin', 'items', search, offset],
    queryFn: () => apiRequest<Paged<Item>>(`/admin/items${queryString({ search, limit, offset })}`),
  });

  const openEdit = (item: Item): void => {
    setEditing(item);
    setForm({
      slug: item.slug,
      name: item.name,
      weapon: item.weapon,
      rarity: item.rarity,
      condition: item.condition,
      imageUrl: item.imageUrl,
      price: item.price.coins,
      isActive: item.isActive,
      isWithdrawable: item.isWithdrawable,
      description: item.description ?? '',
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        slug: form.slug,
        name: form.name,
        weapon: form.weapon,
        rarity: form.rarity,
        condition: form.condition,
        imageUrl: form.imageUrl,
        price: form.price.replace(',', '.'),
        isActive: form.isActive,
        isWithdrawable: form.isWithdrawable,
        description: form.description || undefined,
      };
      return editing
        ? apiRequest(`/admin/items/${editing.id}`, { method: 'PATCH', body })
        : apiRequest('/admin/items', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success(editing ? 'Предмет обновлён' : 'Предмет добавлен');
      setEditing(null);
      setCreating(false);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'items'] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (error) => toast.error('Ошибка сохранения', error instanceof ApiError ? error.message : undefined),
  });

  const isOpen = creating || Boolean(editing);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          className="input max-w-sm"
          placeholder="Поиск по названию"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => {
            setForm(EMPTY_FORM);
            setCreating(true);
          }}
        >
          + Добавить предмет
        </button>
      </div>

      {query.isLoading ? (
        <ItemGridSkeleton count={12} />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {query.data.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onClick={() => openEdit(item)}
                badge={!item.isActive ? 'скрыт' : undefined}
              />
            ))}
          </div>
          <Pagination total={query.data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      ) : (
        <EmptyState title="Предметы не найдены" icon="📦" />
      )}

      <Modal
        open={isOpen}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? 'Редактирование предмета' : 'Новый предмет'}
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            disabled={saveMutation.isPending || form.name.length < 2}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg bg-dark p-3">
            <img
              src={form.imageUrl}
              alt=""
              className="h-16 w-16 rounded object-contain"
              onError={(event) => {
                (event.target as HTMLImageElement).src = '/items/placeholder.svg';
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-13 font-medium">{form.name || 'Название предмета'}</p>
              <Money value={form.price || '0'} size="sm" />
            </div>
          </div>

          {!editing ? (
            <div>
              <label className="label" htmlFor="slug">
                Slug (латиница, цифры, дефис)
              </label>
              <input
                id="slug"
                className="input"
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              />
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="name">
              Название
            </label>
            <input id="name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="weapon">
                Оружие
              </label>
              <input
                id="weapon"
                className="input"
                value={form.weapon}
                onChange={(event) => setForm({ ...form, weapon: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="price">
                Цена, монет
              </label>
              <input
                id="price"
                className="input"
                inputMode="decimal"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value.replace(/[^\d.,]/g, '') })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="rarity">
                Редкость
              </label>
              <select
                id="rarity"
                className="input"
                value={form.rarity}
                onChange={(event) => setForm({ ...form, rarity: event.target.value as Rarity })}
              >
                {Object.entries(RARITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="condition">
                Состояние
              </label>
              <select
                id="condition"
                className="input"
                value={form.condition}
                onChange={(event) => setForm({ ...form, condition: event.target.value as Condition })}
              >
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="imageUrl">
              Ссылка на изображение
            </label>
            <input
              id="imageUrl"
              className="input"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="/items/placeholder-rare.svg или https://…"
            />
            <p className="mt-1 text-xxs text-muted">
              Можно указать локальный путь из папки /public/items или внешний адрес.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="description">
              Описание
            </label>
            <textarea
              id="description"
              className="input min-h-[70px] py-2"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              maxLength={500}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                className="h-4 w-4 accent-[#fbd506]"
              />
              Доступен в каталоге
            </label>
            <label className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={form.isWithdrawable}
                onChange={(event) => setForm({ ...form, isWithdrawable: event.target.checked })}
                className="h-4 w-4 accent-[#fbd506]"
              />
              Можно выводить
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
