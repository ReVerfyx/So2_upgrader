/** Тесты расчёта шанса и коэффициента апгрейда. */
import { describe, expect, it } from 'vitest';
import { calculateUpgrade, targetPriceRange, UpgradeMathError } from '../src/lib/upgradeMath';
import { tonToNano } from '../src/lib/money';

const settings = { houseEdge: 0.08, minChance: 0.005, maxChance: 0.85, maxMultiplier: 100 };

describe('Расчёт апгрейда', () => {
  it('считает шанс по формуле (ставка / цель) × (1 − комиссия)', () => {
    const quote = calculateUpgrade(tonToNano('1'), tonToNano('2'), settings);
    // 1/2 * 0.92 = 0.46
    expect(quote.chancePpm).toBe(460_000);
    expect(quote.chancePercent).toBeCloseTo(46, 5);
    expect(quote.multiplier).toBeCloseTo(2, 5);
  });

  it('коэффициент и прибыль рассчитаны верно', () => {
    const quote = calculateUpgrade(tonToNano('0.95'), tonToNano('1.88'), settings);
    expect(quote.multiplier).toBeCloseTo(1.9789, 3);
    expect(quote.profitNano).toBe(tonToNano('0.93'));
    expect(quote.chancePercent).toBeCloseTo(46.4905, 3);
  });

  it('ограничивает шанс сверху', () => {
    const quote = calculateUpgrade(tonToNano('10'), tonToNano('10.1'), settings);
    expect(quote.chancePercent).toBeLessThanOrEqual(85);
  });

  it('ограничивает шанс снизу', () => {
    const quote = calculateUpgrade(tonToNano('1'), tonToNano('99'), settings);
    expect(quote.chancePercent).toBeGreaterThanOrEqual(0.5);
  });

  it('запрещает апгрейд в предмет дешевле или равный', () => {
    expect(() => calculateUpgrade(tonToNano('5'), tonToNano('5'), settings)).toThrow(UpgradeMathError);
    expect(() => calculateUpgrade(tonToNano('5'), tonToNano('4'), settings)).toThrow(/дороже/);
  });

  it('запрещает превышение максимального коэффициента', () => {
    expect(() => calculateUpgrade(tonToNano('1'), tonToNano('500'), settings)).toThrow(/коэффициент/);
  });

  it('отклоняет нулевую или отрицательную ставку', () => {
    expect(() => calculateUpgrade(0n, tonToNano('1'), settings)).toThrow(UpgradeMathError);
    expect(() => calculateUpgrade(-1n, tonToNano('1'), settings)).toThrow(UpgradeMathError);
  });

  it('математическое ожидание игрока равно 1 − комиссия', () => {
    // Проверяем на нескольких коэффициентах: EV = шанс × цель / ставка
    for (const multiplier of [1.5, 2, 3, 5, 10]) {
      const stake = tonToNano('1');
      const target = tonToNano(String(multiplier));
      const quote = calculateUpgrade(stake, target, settings);
      const ev = (quote.chancePpm / 1_000_000) * multiplier;
      expect(ev).toBeCloseTo(1 - settings.houseEdge, 4);
    }
  });

  it('диапазон доступных целей соответствует настройкам', () => {
    const range = targetPriceRange(tonToNano('1'), settings);
    expect(range.minNano).toBe(tonToNano('1') + 1n);
    expect(range.maxNano).toBe(tonToNano('100'));
  });
});
