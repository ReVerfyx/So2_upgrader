/**
 * Хелперы для работы с транзакциями БД.
 * Любое изменение баланса выполняется строго внутри транзакции
 * с блокировкой строки баланса (SELECT ... FOR UPDATE),
 * что исключает двойное начисление при параллельных запросах.
 */
import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from './pool';

export type Db = Pick<PoolClient, 'query'>;

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* соединение уже разорвано — игнорируем */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const result = await db.query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}
