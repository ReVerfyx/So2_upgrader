/**
 * Работа с адресами TON.
 *
 * Один и тот же кошелёк записывается в разных формах:
 *   UQD9v6... / EQD9v6...  — user-friendly (bounceable и non-bounceable),
 *   0:fdbfa8...            — «сырой» формат.
 * Чтобы платёж не потерялся из-за формата, адреса сравниваются по
 * содержимому, а не как строки.
 */

/** Проверяет, что строка похожа на адрес TON. */
export function isValidTonAddress(address: string): boolean {
  const value = address.trim();
  if (/^(-1|0):[0-9a-fA-F]{64}$/.test(value)) return true;
  if (/^[UEkK][QF][A-Za-z0-9_-]{46}$/.test(value)) return true;
  return false;
}

/**
 * Приводит user-friendly адрес к сравнимому виду: декодирует base64url
 * и возвращает hex хеша аккаунта (32 байта). Для «сырого» адреса
 * возвращает его hex-часть в нижнем регистре.
 */
export function toComparableAddress(address: string): string | null {
  const value = address.trim();

  const raw = /^(-1|0):([0-9a-fA-F]{64})$/.exec(value);
  if (raw?.[2]) return raw[2].toLowerCase();

  if (!/^[A-Za-z0-9_-]{48}$/.test(value)) return null;

  try {
    const buffer = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    // 1 байт флагов + 1 байт workchain + 32 байта хеша + 2 байта CRC
    if (buffer.length !== 36) return null;
    return buffer.subarray(2, 34).toString('hex');
  } catch {
    return null;
  }
}

/** Сравнивает два адреса TON независимо от формы записи. */
export function isSameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = toComparableAddress(a);
  const right = toComparableAddress(b);
  if (!left || !right) return a.trim() === b.trim();
  return left === right;
}
