/**
 * Централизованная обработка ошибок.
 * Клиент никогда не получает стек вызовов или текст внутренней ошибки —
 * подробности пишутся в таблицу error_logs и доступны в админ-панели.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { pool } from '../db/pool';
import { env } from '../config/env';

async function persistError(params: {
  level: 'warn' | 'error';
  code: string;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
  userId?: string;
  requestId?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO error_logs (level, code, message, stack, context, user_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.level,
        params.code,
        params.message.slice(0, 2000),
        params.stack?.slice(0, 8000) ?? null,
        JSON.stringify(params.context),
        params.userId ?? null,
        params.requestId ?? null,
      ],
    );
  } catch (error) {
    logger.error('Не удалось сохранить ошибку в журнал', { error: (error as Error).message });
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.path} не найден`, requestId: req.requestId },
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = error instanceof AppError ? error : null;
  const status = appError?.status ?? 500;
  const code = appError?.code ?? 'INTERNAL_ERROR';
  const rawMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
  const message = appError?.expose ? rawMessage : 'Внутренняя ошибка сервера. Попробуйте позже.';

  const context = {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    status,
  };

  if (status >= 500) {
    logger.error('Необработанная ошибка запроса', { ...context, error: rawMessage });
    void persistError({
      level: 'error',
      code,
      message: rawMessage,
      stack: error instanceof Error ? error.stack : undefined,
      context,
      userId: req.user?.id,
      requestId: req.requestId,
    });
  } else if (status === 429 || status === 403) {
    void persistError({
      level: 'warn',
      code,
      message: rawMessage,
      context,
      userId: req.user?.id,
      requestId: req.requestId,
    });
  }

  res.status(status).json({
    error: {
      code,
      message,
      details: appError?.details,
      requestId: req.requestId,
      ...(env.isProduction || status < 500 ? {} : { debug: rawMessage }),
    },
  });
}
