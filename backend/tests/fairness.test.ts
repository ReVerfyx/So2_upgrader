/**
 * Тесты честности генерации результата.
 * Проверяем главное обещание проекта: заявленная вероятность = реальная.
 */
import { describe, expect, it } from 'vitest';
import {
  generateClientSeed,
  generateServerSeed,
  hashServerSeed,
  isSuccess,
  PPM,
  rollPpm,
  verifyRoll,
} from '../src/lib/fairness';

describe('Provably fair', () => {
  it('хеш семени детерминирован и имеет длину SHA-256', () => {
    const seed = generateServerSeed();
    expect(hashServerSeed(seed)).toBe(hashServerSeed(seed));
    expect(hashServerSeed(seed)).toHaveLength(64);
  });

  it('генерирует разные семена', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => generateServerSeed()));
    expect(seeds.size).toBe(100);
  });

  it('бросок детерминирован при одинаковых входных данных', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    expect(rollPpm(serverSeed, clientSeed, 7)).toBe(rollPpm(serverSeed, clientSeed, 7));
  });

  it('бросок меняется при изменении nonce', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = 'client';
    const first = rollPpm(serverSeed, clientSeed, 1);
    const second = rollPpm(serverSeed, clientSeed, 2);
    expect(first).not.toBe(second);
  });

  it('бросок всегда лежит в диапазоне [0, 1 000 000)', () => {
    const serverSeed = generateServerSeed();
    for (let nonce = 0; nonce < 2000; nonce += 1) {
      const roll = rollPpm(serverSeed, 'client', nonce);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(PPM);
    }
  });

  it('фактическая частота успеха соответствует заявленному шансу', () => {
    // 20 000 бросков при шансе 35% — отклонение не должно превышать 1.5 п.п.
    const serverSeed = generateServerSeed();
    const chancePpm = 350_000;
    const rounds = 20_000;
    let wins = 0;

    for (let nonce = 0; nonce < rounds; nonce += 1) {
      if (isSuccess(rollPpm(serverSeed, 'fairness-check', nonce), chancePpm)) wins += 1;
    }

    const actual = (wins / rounds) * 100;
    expect(Math.abs(actual - 35)).toBeLessThan(1.5);
  });

  it('распределение бросков равномерно по децилям', () => {
    const serverSeed = generateServerSeed();
    const buckets = new Array(10).fill(0);
    const rounds = 20_000;

    for (let nonce = 0; nonce < rounds; nonce += 1) {
      const roll = rollPpm(serverSeed, 'uniformity', nonce);
      buckets[Math.floor((roll / PPM) * 10)] += 1;
    }

    const expected = rounds / 10;
    buckets.forEach((count) => {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.12);
    });
  });

  it('проверка результата подтверждает честную игру', () => {
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const clientSeed = 'my-lucky-seed';
    const nonce = 42;
    const roll = rollPpm(serverSeed, clientSeed, nonce);
    const chancePpm = 460_000;

    const result = verifyRoll({
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      chancePpm,
      rollPpm: roll,
      success: roll < chancePpm,
    });

    expect(result.valid).toBe(true);
    expect(result.hashValid).toBe(true);
    expect(result.rollValid).toBe(true);
    expect(result.outcomeValid).toBe(true);
  });

  it('проверка выявляет подмену результата', () => {
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const roll = rollPpm(serverSeed, 'seed', 1);

    const tampered = verifyRoll({
      serverSeed,
      serverSeedHash,
      clientSeed: 'seed',
      nonce: 1,
      chancePpm: 100_000,
      rollPpm: roll,
      success: roll >= 100_000, // намеренно неверный исход
    });

    expect(tampered.outcomeValid).toBe(false);
    expect(tampered.valid).toBe(false);
  });

  it('проверка выявляет подмену серверного семени', () => {
    const serverSeed = generateServerSeed();
    const otherSeed = generateServerSeed();
    const roll = rollPpm(serverSeed, 'seed', 1);

    const result = verifyRoll({
      serverSeed: otherSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed: 'seed',
      nonce: 1,
      chancePpm: 500_000,
      rollPpm: roll,
      success: roll < 500_000,
    });

    expect(result.hashValid).toBe(false);
    expect(result.valid).toBe(false);
  });
});
