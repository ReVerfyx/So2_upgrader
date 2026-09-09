/** Точка входа сервера. */
import { createApp } from './app';
import { env, assertProductionConfig } from './config/env';
import { logger } from './lib/logger';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { startDepositWatcher, stopDepositWatcher } from './workers/depositWatcher';
import { cleanupIdempotencyKeys } from './middleware/idempotency';

async function main(): Promise<void> {
  assertProductionConfig();

  // Проверяем соединение с БД до старта HTTP-сервера.
  await pool.query('SELECT 1');
  logger.info('Подключение к PostgreSQL установлено');

  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    await runMigrations();
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('Сервер запущен', {
      порт: env.port,
      окружение: env.nodeEnv,
      тестовыйРежим: env.testMode,
      провайдерTON: env.ton.provider,
    });
  });

  startDepositWatcher();

  // Ежечасная очистка просроченных ключей идемпотентности и сессий.
  const cleanupTimer = setInterval(
    () => {
      void cleanupIdempotencyKeys().catch((error: Error) =>
        logger.error('Ошибка очистки ключей идемпотентности', { error: error.message }),
      );
      void pool
        .query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`)
        .catch((error: Error) => logger.error('Ошибка очистки сессий', { error: error.message }));
    },
    60 * 60_000,
  );
  cleanupTimer.unref?.();

  const shutdown = (signal: string): void => {
    logger.info('Получен сигнал завершения, останавливаем сервер', { signal });
    stopDepositWatcher();
    clearInterval(cleanupTimer);
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    // Аварийный выход, если соединения зависли.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: Error) => {
  logger.error('Не удалось запустить сервер', { error: error.message, stack: error.stack });
  process.exit(1);
});
