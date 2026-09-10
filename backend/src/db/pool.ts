/** Пул подключений к PostgreSQL. */
import { Pool, types } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// BIGINT (oid 20) по умолчанию приходит строкой — оставляем строку и приводим
// к bigint явно в коде (см. lib/money.ts). NUMERIC также оставляем строкой.
types.setTypeParser(20, (value) => value);

/**
 * Настройка TLS для подключения к базе.
 *
 * Если задан корневой сертификат провайдера (DATABASE_CA_CERT), соединение
 * проверяется по нему — это защищает от подмены сервера. Без сертификата
 * соединение всё равно шифруется, но подлинность не проверяется:
 * так работают многие облачные базы «из коробки».
 */
function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (!env.database.ssl) return undefined;

  if (env.database.caCert) {
    return { rejectUnauthorized: true, ca: env.database.caCert };
  }

  if (env.isProduction) {
    logger.warn(
      'Подключение к базе шифруется без проверки сертификата. ' +
        'Укажите DATABASE_CA_CERT, чтобы включить полную проверку.',
    );
  }
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: env.database.url,
  max: env.database.poolMax,
  ssl: buildSslConfig(),
  application_name: 'upgrader-standoff',
});

pool.on('error', (error) => {
  logger.error('Ошибка пула подключений PostgreSQL', { error: error.message });
});

export async function closePool(): Promise<void> {
  await pool.end();
}
