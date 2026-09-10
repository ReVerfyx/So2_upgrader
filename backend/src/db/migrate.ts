/**
 * Раннер миграций.
 * Каждый SQL-файл из папки /migrations применяется один раз,
 * внутри транзакции, факт применения фиксируется в schema_migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from './pool';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = (() => {
  const candidates = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '..', 'migrations'),
    path.resolve(__dirname, '..', '..', '..', 'migrations'),
  ];
  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) throw new Error('Не найдена папка migrations');
  return found;
})();

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map<string, string>();
  const rows = await pool.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
  rows.rows.forEach((row) => applied.set(row.name, row.checksum));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(file);

    if (previous) {
      if (previous !== checksum) {
        logger.warn('Файл миграции изменился после применения', { file });
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      executed.push(file);
      logger.info('Миграция применена', { file });
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Ошибка в миграции ${file}: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  if (executed.length === 0) logger.info('Новых миграций нет, схема актуальна');
  return executed;
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error('Не удалось применить миграции', { error: (error as Error).message });
      await pool.end();
      process.exit(1);
    });
}
