/** Тесты middleware безопасности: ограничение частоты и очистка ввода. */
import { describe, expect, it, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, resetRateLimits } from '../src/middleware/rateLimit';
import { sanitizeText } from '../src/lib/validate';
import { AppError } from '../src/lib/errors';

function fakeRequest(ip = '10.0.0.1'): Request {
  return { ip, user: undefined } as unknown as Request;
}

function fakeResponse(): Response {
  return { setHeader: () => undefined } as unknown as Response;
}

describe('Ограничение частоты запросов', () => {
  beforeEach(() => resetRateLimits());

  it('пропускает запросы в пределах лимита и блокирует сверх него', async () => {
    const limiter = rateLimit({ name: 'unit-test', windowMs: 60_000, max: 3 });
    const errors: unknown[] = [];
    const next: NextFunction = (error?: unknown) => errors.push(error);

    // env.isTest увеличивает лимит в 200 раз, поэтому проверяем именно этот порог.
    const effectiveMax = 3 * 200;
    for (let i = 0; i < effectiveMax; i += 1) {
      limiter(fakeRequest(), fakeResponse(), next);
    }
    expect(errors.filter(Boolean)).toHaveLength(0);

    limiter(fakeRequest(), fakeResponse(), next);
    const blocked = errors.filter(Boolean)[0];
    expect(blocked).toBeInstanceOf(AppError);
    expect((blocked as AppError).status).toBe(429);
  });

  it('считает лимиты отдельно для разных адресов', () => {
    const limiter = rateLimit({ name: 'per-ip', windowMs: 60_000, max: 1 });
    const errors: unknown[] = [];
    const next: NextFunction = (error?: unknown) => errors.push(error);

    for (let i = 0; i < 200; i += 1) limiter(fakeRequest('1.1.1.1'), fakeResponse(), next);
    limiter(fakeRequest('2.2.2.2'), fakeResponse(), next);

    expect(errors.filter(Boolean)).toHaveLength(0);
  });
});

describe('Очистка пользовательского ввода', () => {
  it('удаляет HTML-теги', () => {
    expect(sanitizeText('<script>alert(1)</script>Привет')).toBe('alert(1)Привет');
    expect(sanitizeText('<b>жирный</b>')).toBe('жирный');
  });

  it('схлопывает пробелы и обрезает по длине', () => {
    expect(sanitizeText('  много    пробелов  ')).toBe('много пробелов');
    expect(sanitizeText('a'.repeat(100), 10)).toHaveLength(10);
  });

  it('убирает управляющие символы', () => {
    const withControls = `Ник${String.fromCharCode(0)}нейм${String.fromCharCode(7)}`;
    expect(sanitizeText(withControls)).toBe('Ник нейм');
  });
});
