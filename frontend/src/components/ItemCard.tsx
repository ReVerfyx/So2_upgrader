/**
 * Карточка предмета с подсветкой редкости.
 * Используется в инвентаре, каталоге и таблицах апгрейда.
 */
import clsx from 'clsx';
import type { InventoryItem, Item, TargetItem } from '../types/api';
import { CONDITION_SHORT, RARITY_COLORS, RARITY_LABELS, formatMultiplier, formatPercent } from '../lib/format';
import { Money } from './Money';

type AnyItem = Item | InventoryItem | TargetItem;

interface ItemCardProps {
  item: AnyItem;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Дополнительная строка снизу (шанс, коэффициент). */
  footer?: React.ReactNode;
  compact?: boolean;
  badge?: string;
}

function isTarget(item: AnyItem): item is TargetItem {
  return 'chancePercent' in item;
}

export function ItemCard({
  item,
  selected = false,
  disabled = false,
  onClick,
  footer,
  compact = false,
  badge,
}: ItemCardProps): JSX.Element {
  const color = RARITY_COLORS[item.rarity];
  const interactive = Boolean(onClick) && !disabled;

  return (
    <button
      type={onClick ? 'button' : undefined}
      onClick={interactive ? onClick : undefined}
      disabled={disabled}
      aria-pressed={onClick ? selected : undefined}
      className={clsx(
        'group relative flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-all duration-200',
        interactive && 'hover:-translate-y-0.5 hover:border-white/20 active:scale-[0.98]',
        selected ? 'border-accent shadow-glow' : 'border-white/[0.06]',
        disabled && 'cursor-not-allowed opacity-45',
        compact ? 'p-1.5' : 'p-2',
      )}
      style={selected ? undefined : { borderColor: undefined }}
    >
      {/* Цветная полоса редкости сверху */}
      <span
        className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg"
        style={{ background: color }}
        aria-hidden="true"
      />

      {badge ? (
        <span className="absolute right-1.5 top-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-xxs font-bold uppercase text-accent">
          {badge}
        </span>
      ) : null}

      <div
        className="relative mb-2 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md"
        style={{ background: `radial-gradient(circle at 50% 60%, ${color}22 0%, transparent 70%)` }}
      >
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
          onError={(event) => {
            (event.target as HTMLImageElement).src = '/items/placeholder.svg';
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xxs uppercase tracking-wide" style={{ color }}>
          {RARITY_LABELS[item.rarity]}
        </span>
        <span className={clsx('truncate font-medium text-white', compact ? 'text-xxs' : 'text-13')}>{item.name}</span>

        <div className="mt-1 flex items-center justify-between gap-1">
          <Money value={item.price} size="sm" />
          <span className="shrink-0 text-xxs text-muted">{CONDITION_SHORT[item.condition]}</span>
        </div>

        {isTarget(item) ? (
          <div className="mt-1.5 flex items-center justify-between border-t border-white/[0.06] pt-1.5 text-xxs">
            <span className="font-semibold text-accent">{formatPercent(item.chancePercent)}</span>
            <span className="text-muted">{formatMultiplier(item.multiplier)}</span>
          </div>
        ) : null}

        {footer}
      </div>
    </button>
  );
}
