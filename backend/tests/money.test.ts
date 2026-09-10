/**
 * Тесты денежной арифметики.
 * Внутренняя валюта — монеты (1 монета = 1 ₽), хранятся в копейках.
 * Пополнение приходит в TON и конвертируется по курсу.
 */
import { describe, expect, it } from 'vitest';
import {
  coinsToMinor,
  formatCoins,
  minorToCoins,
  minorToNano,
  money,
  nanoToMinor,
  nanoToTon,
  toBigInt,
  tonToNano,
} from '../src/lib/money';

describe('Монеты и копейки', () => {
  it('переводит монеты в копейки', () => {
    expect(coinsToMinor('1')).toBe(100n);
    expect(coinsToMinor('1250.50')).toBe(125_050n);
    expect(coinsToMinor(999)).toBe(99_900n);
  });

  it('не теряет точность на дробях', () => {
    // 0.1 + 0.2 в float даёт 0.30000000000000004
    const sum = coinsToMinor('0.1') + coinsToMinor('0.2');
    expect(minorToCoins(sum)).toBe('0.30');
  });

  it('обрабатывает отрицательные суммы', () => {
    expect(coinsToMinor('-25.5')).toBe(-2550n);
    expect(minorToCoins(-2550n)).toBe('-25.50');
  });

  it('отклоняет некорректный ввод', () => {
    expect(() => coinsToMinor('abc')).toThrow();
    expect(() => coinsToMinor('1.234')).toThrow(); // больше двух знаков
    expect(() => coinsToMinor('')).toThrow();
  });

  it('форматирует для интерфейса', () => {
    expect(formatCoins(125_050n)).toBe('1250.50');
    expect(formatCoins(0n)).toBe('0.00');
  });

  it('формирует DTO суммы', () => {
    expect(money(125_050n)).toEqual({
      minor: '125050',
      coins: '1250.50',
      formatted: '1250.50',
      currency: 'COIN',
    });
  });
});

describe('TON и нанотоны', () => {
  it('переводит TON в нанотоны', () => {
    expect(tonToNano('1')).toBe(1_000_000_000n);
    expect(tonToNano('0.88')).toBe(880_000_000n);
    expect(tonToNano('123.456789012')).toBe(123_456_789_012n);
  });

  it('переводит обратно без потерь', () => {
    expect(nanoToTon(880_000_000n)).toBe('0.88');
    expect(nanoToTon(1_000_000_000n)).toBe('1');
  });
});

describe('Конвертация TON → монеты', () => {
  // Курс: 35000 копеек за 1 TON = 350 монет за 1 TON
  const rate = 35_000n;

  it('конвертирует полные суммы', () => {
    expect(nanoToMinor(tonToNano('1'), rate)).toBe(35_000n); // 350 монет
    expect(nanoToMinor(tonToNano('2'), rate)).toBe(70_000n); // 700 монет
    expect(nanoToMinor(tonToNano('0.88'), rate)).toBe(30_800n); // 308 монет
  });

  it('округляет вниз: площадка не зачисляет больше полученного', () => {
    // 0.000001 TON = 0.035 копейки → 0 копеек
    expect(nanoToMinor(1000n, rate)).toBe(0n);
  });

  it('обратная конвертация округляет вверх, чтобы счёт не занизить', () => {
    expect(minorToNano(35_000n, rate)).toBe(tonToNano('1'));
    expect(minorToNano(1n, rate)).toBeGreaterThan(0n);
  });

  it('отклоняет нулевой курс', () => {
    expect(() => minorToNano(100n, 0n)).toThrow();
  });
});

describe('Приведение значений из БД', () => {
  it('приводит к bigint', () => {
    expect(toBigInt('42')).toBe(42n);
    expect(toBigInt(42)).toBe(42n);
    expect(toBigInt(null)).toBe(0n);
  });
});
