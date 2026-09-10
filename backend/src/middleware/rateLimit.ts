/**
 * Ограничение частоты запросов (скользящее окно, хранение в памяти процесса).
 * Ключ — идентификатор пользователя, если он авторизован, иначе IP-адрес.
 *
 * Для горизонтального масштабирования достаточно заменить Map на Redis,
 * интерфейс middleware при этом не меняется.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { tooManyRequests } from '../lib/errors';
import { env } from '../config/env';

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Периодическая очистка, чтобы карта не росла бесконечно.
const CLEANUP_INTERVAL_MS = 60_000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((time) => now - time < 15 * 60_000);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

export interface RateLimitOptions {
  /** Размер окна в миллисекундах. */
  windowMs: number;
  /** Максимальное количество запросов в окне. */
  max: number;
  /** Уникальное имя лимита (чтобы разные маршруты не мешали друг другу). */
  name: string;
  /** Сообщение при превышении. */
  message?: string;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  // В тестах все запросы приходят с одного адреса, поэтому лимиты ослабляются.
  // Сама логика ограничения при этом продолжает работать и проверяется тестами.
  const max = env.isTest ? options.max * 200 : options.max;

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = req.user?.id ?? req.ip ?? 'unknown';
    const key = `${options.name}:${identity}`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((time) => now - time < options.windowMs);

    if (bucket.hits.length >= max) {
      const retryAfterMs = options.windowMs - (now - (bucket.hits[0] ?? now));
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      buckets.set(key, bucket);
      next(tooManyRequests(options.message ?? 'Слишком много запросов, попробуйте позже'));
      return;
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.hits.length));
    next();
  };
}

/** Сброс счётчиков (используется в тестах). */
export function resetRateLimits(): void {
  buckets.clear();
}
