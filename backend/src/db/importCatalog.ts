/**
 * Импорт каталога предметов из JSON-файла.
 *
 * Зачем: реальные цены скинов Standoff 2 постоянно меняются, поэтому каталог
 * не «зашит» в код. Владелец площадки готовит файл со своими названиями,
 * ценами и ссылками на изображения и загружает его одной командой:
 *
 *     npm run items:import --workspace backend -- ./catalog.json
 *     npm run items:import --workspace backend -- ./catalog.json --deactivate-missing
 *
 * Формат файла — см. database/catalog.example.json и docs/catalog.md.
 * Предметы сопоставляются по slug: существующие обновляются, новые создаются.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';
import { withTransaction, query } from './tx';
import { coinsToMinor } from '../lib/money';
import { logger } from '../lib/logger';

const RARITIES = ['common', 'rare', 'epic', 'legendary', 'arcane', 'contraband'] as const;
const CONDITIONS = ['factory_new', 'minimal_wear', 'field_tested', 'well_worn', 'battle_scarred'] as const;

export interface CatalogEntry {
  slug: string;
  name: string;
  weapon: string;
  rarity: (typeof RARITIES)[number];
  condition?: (typeof CONDITIONS)[number];
  /** Цена в монетах (1 монета = 1 ₽), например "1250" или "1250.50". */
  priceCoins: string | number;
  imageUrl?: string;
  description?: string;
  isActive?: boolean;
  isWithdrawable?: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  deactivated: number;
  errors: Array<{ slug: string; message: string }>;
}

/** Проверяет одну запись каталога. Возвращает текст ошибки или null. */
export function validateEntry(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return 'Запись должна быть объектом';
  const item = entry as Partial<CatalogEntry>;

  if (!item.slug || !/^[a-z0-9-]{2,64}$/.test(item.slug)) {
    return 'Поле slug обязательно: строчная латиница, цифры и дефис, 2–64 символа';
  }
  if (!item.name || item.name.length < 2 || item.name.length > 120) {
    return 'Поле name обязательно, длина 2–120 символов';
  }
  if (!item.weapon || item.weapon.length > 48) return 'Поле weapon обязательно, до 48 символов';
  if (!item.rarity || !RARITIES.includes(item.rarity)) {
    return `Поле rarity должно быть одним из: ${RARITIES.join(', ')}`;
  }
  if (item.condition && !CONDITIONS.includes(item.condition)) {
    return `Поле condition должно быть одним из: ${CONDITIONS.join(', ')}`;
  }
  if (item.priceCoins === undefined) return 'Поле priceCoins обязательно';

  try {
    const minor = coinsToMinor(String(item.priceCoins));
    if (minor <= 0n) return 'Цена должна быть больше нуля';
  } catch {
    return 'Некорректная цена: ожидается число монет, например 1250 или 1250.50';
  }

  return null;
}

/** Применяет каталог к базе. Выполняется одной транзакцией. */
export async function importCatalog(
  entries: unknown[],
  options: { deactivateMissing?: boolean } = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, deactivated: 0, errors: [] };

  const valid: CatalogEntry[] = [];
  entries.forEach((entry, index) => {
    const error = validateEntry(entry);
    if (error) {
      const slug = (entry as { slug?: string })?.slug ?? `#${index + 1}`;
      result.errors.push({ slug, message: error });
      return;
    }
    valid.push(entry as CatalogEntry);
  });

  if (valid.length === 0) return result;

  await withTransaction(async (client) => {
    for (const item of valid) {
      const rows = await query<{ inserted: boolean }>(
        `INSERT INTO items (slug, name, weapon, rarity, condition, image_url, price_minor,
                            is_active, is_withdrawable, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (slug) DO UPDATE
           SET name            = EXCLUDED.name,
               weapon          = EXCLUDED.weapon,
               rarity          = EXCLUDED.rarity,
               condition       = EXCLUDED.condition,
               image_url       = EXCLUDED.image_url,
               price_minor     = EXCLUDED.price_minor,
               is_active       = EXCLUDED.is_active,
               is_withdrawable = EXCLUDED.is_withdrawable,
               description     = EXCLUDED.description
         RETURNING (xmax = 0) AS inserted`,
        [
          item.slug,
          item.name,
          item.weapon,
          item.rarity,
          item.condition ?? 'field_tested',
          item.imageUrl ?? '/items/placeholder.svg',
          coinsToMinor(String(item.priceCoins)).toString(),
          item.isActive ?? true,
          item.isWithdrawable ?? true,
          item.description ?? null,
        ],
        client,
      );

      if (rows[0]?.inserted) result.created += 1;
      else result.updated += 1;
    }

    if (options.deactivateMissing) {
      const slugs = valid.map((item) => item.slug);
      const deactivated = await query<{ id: string }>(
        `UPDATE items SET is_active = FALSE
          WHERE is_active = TRUE AND slug <> ALL($1::text[])
          RETURNING id`,
        [slugs],
        client,
      );
      result.deactivated = deactivated.length;
    }
  });

  return result;
}

/** Читает и разбирает файл каталога. */
export function readCatalogFile(filePath: string): unknown[] {
  // Команда запускается из backend/, а каталог обычно лежит в корне репозитория.
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(process.cwd(), '..', filePath),
    path.resolve(__dirname, '..', '..', '..', filePath),
  ];
  const absolute = candidates.find((candidate) => fs.existsSync(candidate));
  if (!absolute) throw new Error(`Файл не найден: ${candidates[0]}`);

  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown[] }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  throw new Error('Ожидается массив предметов или объект вида { "items": [...] }');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('--'));
  const deactivateMissing = args.includes('--deactivate-missing');

  if (!filePath) {
    console.error('Использование: npm run items:import --workspace backend -- <файл.json> [--deactivate-missing]');
    process.exit(1);
  }

  const entries = readCatalogFile(filePath);
  const result = await importCatalog(entries, { deactivateMissing });

  logger.info('Импорт каталога завершён', {
    создано: result.created,
    обновлено: result.updated,
    деактивировано: result.deactivated,
    ошибок: result.errors.length,
  });

  result.errors.forEach((error) => console.error(` ✗ ${error.slug}: ${error.message}`));
  if (result.errors.length > 0 && result.created + result.updated === 0) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      logger.error('Ошибка импорта каталога', { error: (error as Error).message });
      await pool.end();
      process.exit(1);
    });
}
