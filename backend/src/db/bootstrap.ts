/**
 * Первичное наполнение базы при старте.
 *
 * Нужно для развёртывания «в один клик»: после деплоя на пустой базе
 * появляются каталог предметов и учётная запись администратора,
 * и сайтом можно пользоваться сразу.
 *
 * Включается переменной SEED_ON_START=true. Работает только на пустой базе:
 * если предметы уже есть, каталог не трогается, чтобы не перезаписать
 * цены, настроенные владельцем площадки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';
import { logger } from '../lib/logger';
import { seedAdmin, seedItems } from './seed';
import { importCatalog, readCatalogFile } from './importCatalog';

export interface BootstrapResult {
  itemsImported: number;
  adminCreated: boolean;
  skipped: boolean;
}

/** Ищет файл каталога в стандартных местах. */
function findCatalogFile(): string | null {
  const candidates = [
    process.env.CATALOG_FILE,
    'database/catalog.json',
    '../database/catalog.json',
    path.resolve(__dirname, '..', '..', '..', 'database', 'catalog.json'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.map((candidate) => path.resolve(process.cwd(), candidate)).find((file) => fs.existsSync(file)) ?? null;
}

export async function bootstrapDatabase(): Promise<BootstrapResult> {
  const result: BootstrapResult = { itemsImported: 0, adminCreated: false, skipped: false };

  const countRow = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM items');
  const existingItems = Number(countRow.rows[0]?.count ?? '0');

  if (existingItems > 0) {
    logger.info('Каталог уже заполнен, первичное наполнение пропущено', { предметов: existingItems });
    result.skipped = true;
  } else {
    const catalogFile = findCatalogFile();

    if (catalogFile) {
      const entries = readCatalogFile(catalogFile);
      const imported = await importCatalog(entries);
      result.itemsImported = imported.created + imported.updated;
      logger.info('Каталог загружен при первом запуске', {
        файл: catalogFile,
        создано: imported.created,
        ошибок: imported.errors.length,
      });
    } else {
      // Файла каталога нет — кладём демонстрационный набор,
      // чтобы сайт не оказался пустым.
      result.itemsImported = await seedItems();
      logger.info('Загружен демонстрационный каталог', { предметов: result.itemsImported });
    }
  }

  // Администратор создаётся, только если заданы логин и пароль.
  if (process.env.ADMIN_PASSWORD) {
    const admin = await seedAdmin();
    result.adminCreated = admin.created;
    if (admin.created) logger.info('Создана учётная запись администратора', { логин: admin.username });
  }

  return result;
}
