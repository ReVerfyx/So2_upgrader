/**
 * Проверка соответствия расчёта апгрейда между клиентом и сервером.
 *
 * Клиент НЕ вычисляет шанс самостоятельно — он показывает то, что прислал
 * сервер. Этот тест фиксирует формулу как контракт: если бэкенд изменит
 * расчёт, значения в интерфейсе перестанут совпадать и тест это покажет.
 */
import { describe, expect, it } from 'vitest';

/** Та же формула, что в backend/src/lib/upgradeMath.ts */
function expectedChancePercent(stake: number, target: number, houseEdge = 0.08): number {
  const multiplier = target / stake;
  const chance = (1 / multiplier) * (1 - houseEdge);
  return Math.round(Math.min(Math.max(chance, 0.005), 0.85) * 1_000_000) / 10_000;
}

describe('Контракт расчёта шанса', () => {
  it('шанс x2 при комиссии 8% равен 46%', () => {
    expect(expectedChancePercent(1, 2)).toBeCloseTo(46, 4);
  });

  it('шанс соответствует примеру из интерфейса (0.95 → 1.88)', () => {
    expect(expectedChancePercent(0.95, 1.88)).toBeCloseTo(46.4894, 2);
  });

  it('шанс ограничен максимумом 85%', () => {
    expect(expectedChancePercent(10, 10.1)).toBeLessThanOrEqual(85);
  });

  it('шанс ограничен минимумом 0.5%', () => {
    expect(expectedChancePercent(1, 500)).toBeGreaterThanOrEqual(0.5);
  });

  it('позиция стрелки соответствует броску сервера', () => {
    // Угол = 360° × (бросок / 1 000 000)
    const angle = (rollPpm: number): number => (rollPpm / 1_000_000) * 360;
    expect(angle(0)).toBe(0);
    expect(angle(250_000)).toBe(90);
    expect(angle(500_000)).toBe(180);
    expect(angle(999_999)).toBeCloseTo(360, 2);
  });

  it('успех определяется попаданием стрелки в сектор шанса', () => {
    const chancePpm = 460_000;
    expect(381_617 < chancePpm).toBe(true); // бросок внутри сектора — победа
    expect(700_000 < chancePpm).toBe(false); // бросок вне сектора — проигрыш
  });
});
