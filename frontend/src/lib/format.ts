/** Форматирование значений для интерфейса. */
import type { Condition, Money, Rarity, TonMoney } from '../types/api';

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Обычное',
  rare: 'Редкое',
  epic: 'Эпическое',
  legendary: 'Легендарное',
  arcane: 'Арканное',
  contraband: 'Контрабанда',
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9aa4b8',
  rare: '#4d8cff',
  epic: '#a259ff',
  legendary: '#ff9d2e',
  arcane: '#ff4d6d',
  contraband: '#ffdd55',
};

export const CONDITION_LABELS: Record<Condition, string> = {
  factory_new: 'Прямо с завода',
  minimal_wear: 'Немного поношенное',
  field_tested: 'После полевых испытаний',
  well_worn: 'Поношенное',
  battle_scarred: 'Закалённое в боях',
};

export const CONDITION_SHORT: Record<Condition, string> = {
  factory_new: 'ПСЗ',
  minimal_wear: 'НП',
  field_tested: 'ППИ',
  well_worn: 'ПН',
  battle_scarred: 'ЗВБ',
};

/** Сумма в монетах с разделением разрядов: 1 234,56 */
export function formatCoins(value: Money | string | number, decimals = 2): string {
  const raw = typeof value === 'object' ? value.coins : String(value);
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return '0,00';
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Сумма в TON (только для страницы пополнения). */
export function formatTon(value: TonMoney | string | number, decimals = 2): string {
  const raw = typeof value === 'object' ? value.ton : String(value);
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Компактная запись крупных сумм: 12,4K */
export function formatCompact(value: Money | number): string {
  const amount = typeof value === 'object' ? Number(value.coins) : value;
  if (!Number.isFinite(amount)) return '0';
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(2);
}

/** Процент с двумя знаками: 46.49% */
export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals).replace(/\.?0+$/, (match) => (match.includes('.') ? '' : match))}%`;
}

export function formatMultiplier(value: number): string {
  return `x${value.toFixed(value >= 10 ? 1 : 2)}`;
}

/** Дата и время в локальном формате. */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** «5 минут назад» — для лент событий. */
export function formatRelative(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'только что';
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  }
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatDateTime(date);
}

/** Склонение существительных по числу. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Оставшееся время в формате мм:сс. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Сокращение длинных строк: EQAb…x9Y2 */
export function shorten(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const TRANSACTION_LABELS: Record<string, string> = {
  deposit: 'Пополнение',
  withdrawal: 'Вывод',
  upgrade_stake: 'Ставка в апгрейде',
  upgrade_win: 'Выигрыш в апгрейде',
  upgrade_loss: 'Проигрыш в апгрейде',
  item_sell: 'Продажа предмета',
  admin_adjust: 'Корректировка администратором',
  refund: 'Возврат',
  bonus: 'Бонус',
  test_credit: 'Тестовое начисление',
};

export const DEPOSIT_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает оплаты',
  confirmed: 'Зачислено',
  failed: 'Ошибка',
  expired: 'Истёк',
};

export const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  pending: 'В очереди',
  processing: 'В обработке',
  completed: 'Выдан',
  rejected: 'Отклонена',
};
