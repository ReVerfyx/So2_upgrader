/** Пул подключений к PostgreSQL. */
import { Pool, types } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// BIGINT (oid 20) по умолчанию приходит строкой — оставляем строку и приводим
// к bigint явно в коде (см. lib/money.ts). NUMERIC также оставляем строкой.
types.setTypeParser(20, (value) => value);

export const pool = new Pool({
  connectionString: env.database.url,
  max: env.database.poolMax,
  ssl: env.database.ssl ? { rejectUnauthorized: false } : undefined,
  application_name: 'upgrader-standoff',
});

pool.on('error', (error) => {
  logger.error('Ошибка пула подключений PostgreSQL', { error: error.message });
});

export async function closePool(): Promise<void> {
  await pool.end();
}
