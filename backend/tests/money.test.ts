/** Тесты денежной арифметики: точность важнее всего. */
import { describe, expect, it } from 'vitest';
import { formatTon, nanoToTon, tonToNano, toBigInt, money } from '../src/lib/money';

describe('Конвертация TON ↔ нанотоны', () => {
  it('переводит целые значения', () => {
    expect(tonToNano('1')).toBe(1_000_000_000n);
    expect(tonToNano('0.88')).toBe(880_000_000n);
    expect(tonToNano('123.456789012')).toBe(123_456_789_012n);
  });

  it('не теряет точность на «неудобных» дробях', () => {
    // 0.1 + 0.2 в числах с плавающей точкой даёт 0.30000000000000004
    const sum = tonToNano('0.1') + tonToNano('0.2');
    expect(nanoToTon(sum)).toBe('0.3');
  });

  it('обрабатывает отрицательные суммы', () => {
    expect(tonToNano('-2.5')).toBe(-2_500_000_000n);
    expect(nanoToTon(-2_500_000_000n)).toBe('-2.5');
  });

  it('отклоняет некорректный ввод', () => {
    expect(() => tonToNano('abc')).toThrow();
    expect(() => tonToNano('1.2.3')).toThrow();
    expect(() => tonToNano('')).toThrow();
  });

  it('форматирует для интерфейса с округлением', () => {
    expect(formatTon(1_234_500_000n, 2)).toBe('1.23');
    expect(formatTon(1_235_000_000n, 2)).toBe('1.24');
    expect(formatTon(0n, 2)).toBe('0.00');
  });

  it('приводит значения из БД к bigint', () => {
    expect(toBigInt('42')).toBe(42n);
    expect(toBigInt(42)).toBe(42n);
    expect(toBigInt(null)).toBe(0n);
  });

  it('формирует DTO суммы', () => {
    expect(money(880_000_000n)).toEqual({ nano: '880000000', ton: '0.88', formatted: '0.88' });
  });
});
