/** Тесты форматирования значений интерфейса. */
import { describe, expect, it } from 'vitest';
import {
  formatCoins,
  formatCompact,
  formatCountdown,
  formatMultiplier,
  formatPercent,
  formatTon,
  plural,
  shorten,
} from './format';

/** toLocaleString использует неразрывные пробелы — нормализуем перед сравнением. */
const normalize = (value: string): string => value.replace(/\u00a0/g, ' ');

describe('Форматирование сумм', () => {
  it('выводит монеты с двумя знаками и разделением разрядов', () => {
    const money = { minor: '100000', coins: '1000', formatted: '1000.00', currency: 'COIN' } as const;
    expect(normalize(formatCoins(money))).toBe('1 000,00');
    expect(normalize(formatCoins('1234.5'))).toBe('1 234,50');
    expect(normalize(formatCoins('0'))).toBe('0,00');
  });

  it('выводит TON с двумя знаками', () => {
    expect(normalize(formatTon('12.3456'))).toBe('12,35');
    expect(normalize(formatTon('0'))).toBe('0,00');
  });

  it('сокращает крупные суммы', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatCompact(12.5)).toBe('12.50');
  });
});

describe('Форматирование игровых величин', () => {
  it('показывает проценты без лишних нулей', () => {
    expect(formatPercent(46.49)).toBe('46.49%');
    expect(formatPercent(50)).toBe('50%');
  });

  it('показывает коэффициент', () => {
    expect(formatMultiplier(1.98)).toBe('x1.98');
    expect(formatMultiplier(12.5)).toBe('x12.5');
  });

  it('форматирует обратный отсчёт', () => {
    expect(formatCountdown(90)).toBe('01:30');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
  });
});

describe('Вспомогательные функции', () => {
  it('склоняет существительные', () => {
    expect(plural(1, 'минуту', 'минуты', 'минут')).toBe('минуту');
    expect(plural(3, 'минуту', 'минуты', 'минут')).toBe('минуты');
    expect(plural(11, 'минуту', 'минуты', 'минут')).toBe('минут');
    expect(plural(22, 'минуту', 'минуты', 'минут')).toBe('минуты');
  });

  it('сокращает длинные строки', () => {
    expect(shorten('EQAbCdEfGhIjKlMnOpQrStUvWxYz', 6, 4)).toBe('EQAbCd…WxYz');
    expect(shorten('short')).toBe('short');
  });
});
