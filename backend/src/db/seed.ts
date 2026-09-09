/**
 * Заполнение базы стартовыми данными:
 *  - каталог демонстрационных предметов;
 *  - учётная запись администратора (логин и пароль берутся из окружения).
 *
 * Скрипт идемпотентен — повторный запуск не создаёт дубликатов.
 */
import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { runMigrations } from './migrate';
import { SEED_ITEMS } from './seedData';
import { tonToNano } from '../lib/money';
import { generateClientSeed, generateServerSeed, hashServerSeed } from '../lib/fairness';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export async function seedItems(): Promise<number> {
  let count = 0;
  for (const item of SEED_ITEMS) {
    const result = await pool.query(
      `INSERT INTO items (slug, name, weapon, rarity, condition, image_url, price_nano)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             weapon = EXCLUDED.weapon,
             rarity = EXCLUDED.rarity,
             image_url = EXCLUDED.image_url
       RETURNING id`,
      [item.slug, item.name, item.weapon, item.rarity, item.condition, item.image, tonToNano(item.priceTon).toString()],
    );
    if (result.rowCount) count += 1;
  }
  return count;
}

export async function seedAdmin(): Promise<{ created: boolean; username: string }> {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || (env.isProduction ? '' : 'admin12345');

  if (!password) {
    logger.warn('ADMIN_PASSWORD не задан — администратор не создан');
    return { created: false, username };
  }

  const existing = await pool.query('SELECT id FROM users WHERE username_lower = $1', [username.toLowerCase()]);
  if (existing.rowCount) {
    await pool.query(`UPDATE users SET role = 'admin' WHERE username_lower = $1`, [username.toLowerCase()]);
    return { created: false, username };
  }

  const serverSeed = generateServerSeed();
  const passwordHash = await bcrypt.hash(password, env.security.bcryptRounds);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (username, username_lower, display_name, password_hash, role,
                        server_seed, server_seed_hash, client_seed)
     VALUES ($1, $2, $3, $4, 'admin', $5, $6, $7)
     RETURNING id`,
    [username, username.toLowerCase(), username, passwordHash, serverSeed, hashServerSeed(serverSeed), generateClientSeed()],
  );
  await pool.query('INSERT INTO balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.rows[0]!.id]);
  return { created: true, username };
}

async function main(): Promise<void> {
  await runMigrations();
  const items = await seedItems();
  const admin = await seedAdmin();
  logger.info('Начальные данные загружены', {
    предметов: items,
    администратор: admin.username,
    создан: admin.created,
  });
}

if (require.main === module) {
  main()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error('Ошибка загрузки начальных данных', { error: (error as Error).message });
      await pool.end();
      process.exit(1);
    });
}
