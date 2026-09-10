/**
 * Вывод предметов.
 *
 * Честность формулировок: выдача выполняется оператором вручную,
 * поэтому интерфейс показывает реальный статус «Заявка в очереди»
 * и позицию в очереди, а не обещает мгновенную выдачу.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, newIdempotencyKey, queryString } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ItemCard } from '../components/ItemCard';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { ItemGridSkeleton, RowsSkeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, WITHDRAWAL_STATUS_LABELS } from '../lib/format';
import { TelegramLink } from '../components/TelegramLink';
import type { InventoryItem, Paged, Withdrawal } from '../types/api';

export function WithdrawPage(): JSX.Element {
  const { me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [nickname, setNickname] = useState(me?.user.gameNickname ?? '');
  const [contact, setContact] = useState(me?.user.contact ?? '');

  const inventoryQuery = useQuery({
    queryKey: ['inventory', 'withdrawable'],
    queryFn: () => apiRequest<Paged<InventoryItem>>(`/inventory${queryString({ limit: 60, sort: 'price_desc' })}`),
  });

  const withdrawalsQuery = useQuery({
    queryKey: ['withdrawals'],
    queryFn: () => apiRequest<Paged<Withdrawal>>(`/withdrawals${queryString({ limit: 20 })}`),
    refetchInterval: 30_000,
  });

  // Переход из инвентаря: ?item=<id>
  useEffect(() => {
    const itemId = searchParams.get('item');
    if (!itemId || !inventoryQuery.data) return;
    const found = inventoryQuery.data.items.find((item) => item.id === itemId);
    if (found) setSelected(found);
    setSearchParams({}, { replace: true });
  }, [searchParams, inventoryQuery.data, setSearchParams]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ withdrawal: Withdrawal; notice: string }>('/withdraw', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: { inventoryId: selected?.id, gameNickname: nickname.trim(), contact: contact.trim() || undefined },
      }),
    onSuccess: (data) => {
      toast.success('Заявка создана', data.notice);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => toast.error('Не удалось создать заявку', error instanceof ApiError ? error.message : undefined),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/withdrawals/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.info('Заявка отменена', 'Предмет возвращён в инвентарь');
      void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => toast.error('Не удалось отменить', error instanceof ApiError ? error.message : undefined),
  });

  const availableItems = inventoryQuery.data?.items.filter((item) => item.status === 'available' && item.isWithdrawable) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Вывод предметов</h1>

      {/* Честное предупреждение */}
      <div className="panel border-accent/30 bg-accent/[0.06] p-4">
        <p className="font-display text-sm font-bold text-accent">Как работает вывод</p>
        <p className="mt-1.5 text-13 leading-relaxed text-muted">
          Заявка попадает в очередь и обрабатывается оператором <strong className="text-white">вручную</strong>.
          Мы не обещаем мгновенную автоматическую выдачу: после проверки модератор свяжется с вами и передаст
          предмет в игре. Пока заявка активна, предмет заблокирован в инвентаре — его нельзя апгрейдить или продать.
        </p>
        <TelegramLink className="btn-secondary btn-sm mt-3" label="Связаться с модератором" />
      </div>

      {/* Выбор предмета */}
      <section className="panel p-4">
        <h2 className="mb-3 font-display text-sm font-bold">Выберите предмет</h2>
        {inventoryQuery.isLoading ? (
          <ItemGridSkeleton count={6} />
        ) : availableItems.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {availableItems.map((item) => (
              <ItemCard key={item.id} item={item} compact onClick={() => setSelected(item)} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Нет предметов для вывода"
            icon="🎒"
            description="Выиграйте предмет в апгрейде, чтобы вывести его."
            action={
              <Link to="/upgrade" className="btn-primary btn-sm">
                К апгрейду
              </Link>
            }
          />
        )}
      </section>

      {/* Мои заявки */}
      <section>
        <h2 className="mb-3 font-display text-base font-bold">Мои заявки</h2>
        {withdrawalsQuery.isLoading ? (
          <RowsSkeleton count={3} height="h-20" />
        ) : withdrawalsQuery.data && withdrawalsQuery.data.items.length > 0 ? (
          <div className="space-y-2">
            {withdrawalsQuery.data.items.map((withdrawal) => (
              <div key={withdrawal.id} className="panel flex flex-wrap items-center gap-3 p-3">
                {withdrawal.imageUrl ? (
                  <img
                    src={withdrawal.imageUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded bg-dark object-contain p-1"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{withdrawal.itemName}</p>
                  <p className="text-xxs text-muted">
                    {formatDateTime(withdrawal.createdAt)} · ник: {withdrawal.gameNickname}
                  </p>
                  <p className="mt-1 text-13 text-muted">{withdrawal.statusLabel}</p>
                  {withdrawal.queuePosition ? (
                    <p className="text-xxs text-accent">Позиция в очереди: {withdrawal.queuePosition}</p>
                  ) : null}
                  {withdrawal.adminComment ? (
                    <p className="mt-1 text-xxs text-muted">Комментарий: {withdrawal.adminComment}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Money value={withdrawal.price} size="sm" />
                  <StatusBadge
                    status={withdrawal.status}
                    label={WITHDRAWAL_STATUS_LABELS[withdrawal.status] ?? withdrawal.status}
                  />
                  {withdrawal.status === 'pending' ? (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(withdrawal.id)}
                    >
                      Отменить
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Заявок пока нет" icon="📤" />
        )}
      </section>

      {/* Форма заявки */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Заявка на вывод"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setSelected(null)}>
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={nickname.trim().length < 3 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Отправляем…' : 'Отправить заявку'}
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img
                src={selected.imageUrl}
                alt={selected.name}
                className="h-20 w-20 shrink-0 rounded-lg bg-dark object-contain p-2"
              />
              <div>
                <p className="font-display text-sm font-bold">{selected.name}</p>
                <Money value={selected.currentPrice} className="mt-1" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="nickname">
                Игровой никнейм в Standoff 2 *
              </label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Точно как в игре"
                maxLength={64}
              />
            </div>

            <div>
              <label className="label" htmlFor="contact">
                Контакт для связи (Telegram, Discord)
              </label>
              <input
                id="contact"
                className="input"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder="@username"
                maxLength={128}
              />
            </div>

            <p className="rounded-lg bg-dark p-3 text-xxs leading-relaxed text-muted">
              После отправки заявка встаёт в очередь. Оператор проверит её и свяжется с вами для передачи предмета
              в игре. Пока заявка не обработана, вы можете отменить её — предмет вернётся в инвентарь.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
