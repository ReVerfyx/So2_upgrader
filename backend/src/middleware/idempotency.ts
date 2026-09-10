/**
 * Идемпотентность изменяющих операций.
 *
 * Клиент передаёт заголовок Idempotency-Key. Если запрос с таким ключом
 * от этого пользователя уже выполнялся, повторный вызов вернёт сохранённый
 * ответ и НЕ выполнит операцию второй раз. Это защищает от:
 *  - двойного нажатия кнопки;
 *  - повторной отправки при обрыве связи;
 *  - гонок при параллельных запросах (уникальный индекс в БД).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pool } from '../db/pool';
import { conflict } from '../lib/errors';
import { logger } from '../lib/logger';

const KEY_TTL_HOURS = 24;

interface StoredResponse {
  response_status: number | null;
  response_body: unknown;
}

export function idempotency(endpoint: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.get('Idempotency-Key');
    if (!key || !req.user) {
      next();
      return;
    }
    if (key.length > 128) {
      next(conflict('Некорректный ключ идемпотентности', 'INVALID_IDEMPOTENCY_KEY'));
      return;
    }

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ body: req.body ?? {}, endpoint }))
      .digest('hex');

    try {
      const existing = await pool.query<StoredResponse & { request_hash: string }>(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND endpoint = $3',
        [req.user.id, key, endpoint],
      );

      const row = existing.rows[0];
      if (row) {
        if (row.request_hash !== requestHash) {
          next(conflict('Этот ключ идемпотентности уже использован с другими параметрами', 'IDEMPOTENCY_KEY_REUSED'));
          return;
        }
        if (row.response_status) {
          res.status(row.response_status).json(row.response_body);
          return;
        }
        // Запрос ещё выполняется — сообщаем клиенту, что нужно подождать.
        next(conflict('Предыдущий запрос ещё выполняется, подождите', 'IDEMPOTENT_REQUEST_IN_PROGRESS'));
        return;
      }

      await pool.query(
        `INSERT INTO idempotency_keys (user_id, key, endpoint, request_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '${KEY_TTL_HOURS} hours')`,
        [req.user.id, key, endpoint, requestHash],
      );
    } catch (error) {
      const message = (error as Error).message;
      // Гонка: параллельный запрос успел вставить тот же ключ.
      if (message.includes('idempotency_user_key_endpoint_key')) {
        next(conflict('Запрос с этим ключом уже обрабатывается', 'IDEMPOTENT_REQUEST_IN_PROGRESS'));
        return;
      }
      logger.error('Ошибка проверки идемпотентности', { error: message });
      next();
      return;
    }

    // Перехватываем ответ, чтобы сохранить его для повторных запросов.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      void pool
        .query(
          'UPDATE idempotency_keys SET response_status = $4, response_body = $5::jsonb WHERE user_id = $1 AND key = $2 AND endpoint = $3',
          [req.user!.id, key, endpoint, res.statusCode, JSON.stringify(body)],
        )
        .catch((error: Error) => logger.error('Не удалось сохранить ответ идемпотентности', { error: error.message }));
      return originalJson(body);
    }) as Response['json'];

    next();
  };
}

/** Удаление просроченных ключей. Вызывается по расписанию. */
export async function cleanupIdempotencyKeys(): Promise<number> {
  const result = await pool.query('DELETE FROM idempotency_keys WHERE expires_at < now()');
  return result.rowCount ?? 0;
}
