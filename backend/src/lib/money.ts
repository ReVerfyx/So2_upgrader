/**
 * Работа с денежными суммами.
 *
 * Внутри системы все суммы — целые числа нанотонов (bigint):
 *   1 TON = 1_000_000_000 нанотон.
 * Это полностью исключает ошибки округления чисел с плавающей точкой.
 * Наружу (в JSON) суммы отдаются строкой нанотонов + готовой строкой в TON.
 */

export const NANO_IN_TON = 1_000_000_000n;
export const TON_DECIMALS = 9;

/** Преобразует строку/число в TON в нанотоны. Бросает ошибку на некорректном вводе. */
export function tonToNano(value: string | number): bigint {
  const raw = typeof value === 'number' ? value.toFixed(TON_DECIMALS) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Некорректная сумма TON: ${value}`);
  }
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const paddedFraction = (fraction + '0'.repeat(TON_DECIMALS)).slice(0, TON_DECIMALS);
  const result = BigInt(whole) * NANO_IN_TON + BigInt(paddedFraction || '0');
  return negative ? -result : result;
}

/** Преобразует нанотоны в строку TON без потери точности. */
export function nanoToTon(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / NANO_IN_TON;
  const fraction = abs % NANO_IN_TON;
  const fractionStr = fraction.toString().padStart(TON_DECIMALS, '0').replace(/0+$/, '');
  const body = fractionStr ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Форматирует нанотоны для интерфейса: 12.35 TON (по умолчанию 2 знака). */
export function formatTon(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(TON_DECIMALS - decimals);
  // Округление к ближайшему
  const scaled = (abs + scale / 2n) / scale;
  const whole = scaled / 10n ** BigInt(decimals);
  const fraction = scaled % 10n ** BigInt(decimals);
  const body = decimals > 0 ? `${whole}.${fraction.toString().padStart(decimals, '0')}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Безопасно приводит значение из БД (string | number | bigint) к bigint. */
export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  if (value === null || value === undefined) return 0n;
  throw new Error(`Невозможно привести значение к bigint: ${String(value)}`);
}

/** Представление суммы для API. */
export interface MoneyDto {
  nano: string;
  ton: string;
  formatted: string;
}

export function money(value: bigint): MoneyDto {
  return {
    nano: value.toString(),
    ton: nanoToTon(value),
    formatted: formatTon(value, 2),
  };
}
