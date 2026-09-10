/**
 * Отображение сумм.
 *
 * Внутренняя валюта площадки — монеты: 1 монета = 1 ₽.
 * Компонент <Money> показывает монеты, <Ton> — сумму в TON (пополнение).
 */
import clsx from 'clsx';
import type { Money as MoneyType, TonMoney } from '../types/api';
import { formatCoins, formatTon } from '../lib/format';

const SIZES = {
  sm: 'text-13',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
} as const;

interface MoneyProps {
  value: MoneyType | string | number;
  className?: string;
  decimals?: number;
  showSign?: boolean;
  size?: keyof typeof SIZES;
}

/** Значок внутренней валюты (монета). */
export function CoinIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={clsx('inline-block', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.4 8h3.3c1.7 0 2.8 1 2.8 2.5S14.4 13 12.7 13h-1.6v1.4h3.1v1.3h-3.1V17H9.4v-1.3H8v-1.3h1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Значок TON. */
export function TonIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={clsx('inline-block', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15" />
      <path d="M7 8.5h10l-5 8.5-5-8.5Zm2.2 1.5 2.05 3.5V10H9.2Zm3.55 0v3.5l2.05-3.5h-2.05Z" fill="currentColor" />
    </svg>
  );
}

export function Money({ value, className, decimals = 2, showSign = false, size = 'md' }: MoneyProps): JSX.Element {
  const amount = typeof value === 'object' ? Number(value.coins) : Number(value);
  const positive = amount > 0;
  const negative = amount < 0;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-display font-semibold tabular-nums',
        SIZES[size],
        showSign && positive && 'text-success',
        showSign && negative && 'text-danger',
        className,
      )}
      title={`${formatCoins(value, 2)} монет (1 монета = 1 ₽)`}
    >
      <CoinIcon className="h-[1em] w-[1em] text-accent" />
      {showSign && positive ? '+' : ''}
      {formatCoins(value, decimals)}
    </span>
  );
}

interface TonProps {
  value: TonMoney | string | number;
  className?: string;
  decimals?: number;
  size?: keyof typeof SIZES;
}

export function Ton({ value, className, decimals = 2, size = 'md' }: TonProps): JSX.Element {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 font-display font-semibold tabular-nums', SIZES[size], className)}
    >
      <TonIcon className="h-[1em] w-[1em] text-[#0098ea]" />
      {formatTon(value, decimals)}
      <span className="text-muted">TON</span>
    </span>
  );
}
