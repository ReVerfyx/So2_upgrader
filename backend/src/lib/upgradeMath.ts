/**
 * Математика апгрейда.
 *
 * Базовая формула честная и прозрачная:
 *
 *      шанс = (цена_исходника / цена_цели) * (1 - комиссия)
 *
 * То есть математическое ожидание игрока равно (1 - комиссия) от ставки.
 * Шанс ограничивается снизу и сверху настройками площадки.
 *
 * Ключевое требование: этот же расчёт используется и для предпросмотра
 * (`POST /api/upgrade/preview`), и для реальной игры (`POST /api/upgrade`).
 * Никакой «скрытой» корректировки после нажатия кнопки не существует.
 */
import { PPM } from './fairness';

export interface UpgradeSettings {
  /** Комиссия площадки, доля единицы (0.08 = 8%). */
  houseEdge: number;
  /** Минимальный шанс, доля единицы. */
  minChance: number;
  /** Максимальный шанс, доля единицы. */
  maxChance: number;
  /** Максимальный коэффициент (цена цели / цена исходника). */
  maxMultiplier: number;
}

export interface UpgradeQuote {
  /** Шанс успеха в миллионных долях (целое число, 350000 = 35%). */
  chancePpm: number;
  /** Шанс в процентах для интерфейса. */
  chancePercent: number;
  /** Коэффициент в базисных пунктах (10000 = x1). */
  multiplierBp: number;
  /** Коэффициент числом. */
  multiplier: number;
  /** Потенциальный выигрыш (цена цели минус ставка) в нанотонах. */
  profitNano: bigint;
}

export class UpgradeMathError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'UpgradeMathError';
    this.code = code;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Рассчитывает параметры апгрейда.
 * @param sourcePriceNano цена исходного предмета/ставки, нанотоны
 * @param targetPriceNano цена желаемого предмета, нанотоны
 */
export function calculateUpgrade(
  sourcePriceNano: bigint,
  targetPriceNano: bigint,
  settings: UpgradeSettings,
): UpgradeQuote {
  if (sourcePriceNano <= 0n) {
    throw new UpgradeMathError('Стоимость ставки должна быть больше нуля', 'INVALID_SOURCE_PRICE');
  }
  if (targetPriceNano <= 0n) {
    throw new UpgradeMathError('Стоимость желаемого предмета должна быть больше нуля', 'INVALID_TARGET_PRICE');
  }
  if (targetPriceNano <= sourcePriceNano) {
    throw new UpgradeMathError(
      'Желаемый предмет должен быть дороже исходного',
      'TARGET_NOT_MORE_EXPENSIVE',
    );
  }

  // Коэффициент считаем в базисных пунктах через bigint, без float-погрешности.
  const multiplierBp = Number((targetPriceNano * 10_000n) / sourcePriceNano);
  const multiplier = multiplierBp / 10_000;

  if (multiplier > settings.maxMultiplier) {
    throw new UpgradeMathError(
      `Максимальный доступный коэффициент — x${settings.maxMultiplier}`,
      'MULTIPLIER_TOO_HIGH',
    );
  }

  const rawChance = (1 / multiplier) * (1 - settings.houseEdge);
  const chance = clamp(rawChance, settings.minChance, settings.maxChance);
  const chancePpm = Math.round(chance * PPM);

  if (chancePpm <= 0 || chancePpm >= PPM) {
    throw new UpgradeMathError('Не удалось рассчитать корректный шанс', 'INVALID_CHANCE');
  }

  return {
    chancePpm,
    chancePercent: chancePpm / 10_000,
    multiplierBp,
    multiplier,
    profitNano: targetPriceNano - sourcePriceNano,
  };
}

/**
 * Диапазон цен целевых предметов, доступных для данной ставки.
 * Используется, чтобы показать в интерфейсе только достижимые предметы.
 */
export function targetPriceRange(sourcePriceNano: bigint, settings: UpgradeSettings): { minNano: bigint; maxNano: bigint } {
  // Верхняя граница — ограничение по максимальному коэффициенту.
  const maxNano = (sourcePriceNano * BigInt(Math.round(settings.maxMultiplier * 10_000))) / 10_000n;
  // Нижняя граница — коэффициент строго больше единицы.
  const minNano = sourcePriceNano + 1n;
  return { minNano, maxNano };
}
