/**
 * Сборщик каталога предметов.
 *
 * Четыре режима — результат всегда один: файл catalog.json, готовый
 * к загрузке командой `npm run items:import`.
 *
 *   1) scrape   — собрать названия и цены с сайта-прайса
 *   2) csv      — взять из выгрузки CSV (Excel, Google Таблицы)
 *   3) generate — сгенерировать из справочника database/weapons.json
 *   4) inspect  — показать, что удалось распознать на странице, ничего не записывая
 *
 * Примеры:
 *   npm run catalog:inspect  --workspace backend -- --url https://пример/market
 *   npm run catalog:scrape   --workspace backend -- --url https://пример/market --out catalog.json
 *   npm run catalog:scrape   --workspace backend -- --file page.html --config scraper.json
 *   npm run catalog:csv      --workspace backend -- prices.csv
 *   npm run catalog:generate --workspace backend
 */
import fs from 'node:fs';
import path from 'node:path';
import { scrapeHtml, parsePrice, cleanName, type ScrapeConfig, type ScrapedItem } from './catalogSources';
import type { CatalogEntry } from './importCatalog';

/* ------------------------------ Аргументы CLI ----------------------------- */

interface Args {
  command: string;
  url?: string;
  file?: string;
  config?: string;
  out: string;
  limit: number;
  priceMultiplier?: number;
  defaultRarity?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0] ?? 'help', out: 'catalog.json', limit: 5000 };

  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case '--url':
        args.url = value;
        i += 1;
        break;
      case '--file':
        args.file = value;
        i += 1;
        break;
      case '--config':
        args.config = value;
        i += 1;
        break;
      case '--out':
        args.out = value ?? 'catalog.json';
        i += 1;
        break;
      case '--limit':
        args.limit = Number(value) || 5000;
        i += 1;
        break;
      case '--price-multiplier':
        args.priceMultiplier = Number(value) || 1;
        i += 1;
        break;
      case '--rarity':
        args.defaultRarity = value;
        i += 1;
        break;
      default:
        if (!key?.startsWith('--') && !args.file && args.command === 'csv') args.file = key;
    }
  }

  return args;
}

/* ------------------------- Определение вида предмета ---------------------- */

const WEAPON_HINTS: Array<{ pattern: RegExp; weapon: string }> = [
  { pattern: /керамбит|karambit/i, weapon: 'Нож' },
  { pattern: /бабочк|butterfly/i, weapon: 'Нож' },
  { pattern: /байонет|bayonet|штык/i, weapon: 'Нож' },
  { pattern: /кунай|kunai/i, weapon: 'Нож' },
  { pattern: /танто|tanto/i, weapon: 'Нож' },
  { pattern: /кукри|kukri/i, weapon: 'Нож' },
  { pattern: /нож|knife|флип|скелет/i, weapon: 'Нож' },
  { pattern: /перчатк|gloves/i, weapon: 'Перчатки' },
  { pattern: /гранат|grenade/i, weapon: 'Граната' },
  { pattern: /\bakr\b|\bак\b|ak-?47/i, weapon: 'AKR' },
  { pattern: /m4a1/i, weapon: 'M4A1' },
  { pattern: /\bm4\b/i, weapon: 'M4' },
  { pattern: /awm|awp/i, weapon: 'AWM' },
  { pattern: /famas/i, weapon: 'Famas' },
  { pattern: /\baug\b/i, weapon: 'AUG' },
  { pattern: /galil/i, weapon: 'Galil' },
  { pattern: /scar/i, weapon: 'SCAR' },
  { pattern: /ssg/i, weapon: 'SSG' },
  { pattern: /m14/i, weapon: 'M14' },
  { pattern: /mp5/i, weapon: 'MP5' },
  { pattern: /ump/i, weapon: 'UMP45' },
  { pattern: /mp7/i, weapon: 'MP7' },
  { pattern: /p90/i, weapon: 'P90' },
  { pattern: /usp/i, weapon: 'USP' },
  { pattern: /p350/i, weapon: 'P350' },
  { pattern: /desert\s*eagle|deagle/i, weapon: 'Desert Eagle' },
  { pattern: /tec-?9/i, weapon: 'Tec-9' },
  { pattern: /five-?seven/i, weapon: 'Five-Seven' },
  { pattern: /m870/i, weapon: 'M870' },
  { pattern: /spas/i, weapon: 'SPAS' },
  { pattern: /m60/i, weapon: 'M60' },
];

/** Определяет тип оружия по названию предмета. */
export function detectWeapon(name: string): string {
  // Формат «AKR | Дракон»: часть до разделителя — оружие.
  const [head] = name.split('|');
  const source = head?.trim() || name;

  for (const hint of WEAPON_HINTS) {
    if (hint.pattern.test(source) || hint.pattern.test(name)) return hint.weapon;
  }
  return 'Прочее';
}

const RARITY_HINTS: Array<{ pattern: RegExp; rarity: CatalogEntry['rarity'] }> = [
  { pattern: /контрабанд|contraband|запрещ/i, rarity: 'contraband' },
  { pattern: /арканн|arcane|тайн/i, rarity: 'arcane' },
  { pattern: /легендар|legendary/i, rarity: 'legendary' },
  { pattern: /эпическ|epic/i, rarity: 'epic' },
  { pattern: /редк|rare/i, rarity: 'rare' },
  { pattern: /обычн|common|ширпотреб/i, rarity: 'common' },
];

/** Определяет редкость: по подсказке с сайта, иначе по цене. */
export function detectRarity(hint: string | undefined, priceCoins: number): CatalogEntry['rarity'] {
  if (hint) {
    const match = RARITY_HINTS.find((entry) => entry.pattern.test(hint));
    if (match) return match.rarity;
  }

  if (priceCoins >= 100_000) return 'contraband';
  if (priceCoins >= 30_000) return 'arcane';
  if (priceCoins >= 5_000) return 'legendary';
  if (priceCoins >= 1_000) return 'epic';
  if (priceCoins >= 200) return 'rare';
  return 'common';
}

/** Определяет состояние предмета по названию. */
export function detectCondition(name: string): CatalogEntry['condition'] {
  if (/прямо с завода|factory new|\bfn\b/i.test(name)) return 'factory_new';
  if (/немного поношен|minimal wear|\bmw\b/i.test(name)) return 'minimal_wear';
  if (/после полевых|field-?tested|\bft\b/i.test(name)) return 'field_tested';
  if (/поношен|well-?worn|\bww\b/i.test(name)) return 'well_worn';
  if (/закал|battle-?scarred|\bbs\b/i.test(name)) return 'battle_scarred';
  return 'field_tested';
}

/** Соответствие «тип оружия → силуэт заглушки». */
const IMAGE_KIND: Record<string, string> = {
  AKR: 'rifle', M4: 'rifle', M4A1: 'rifle', Famas: 'rifle', AUG: 'rifle', Galil: 'rifle', SCAR: 'rifle',
  AWM: 'sniper', SSG: 'sniper', M14: 'sniper',
  MP5: 'smg', UMP45: 'smg', MP7: 'smg', P90: 'smg',
  USP: 'pistol', P350: 'pistol', 'Desert Eagle': 'pistol', 'Tec-9': 'pistol', 'Five-Seven': 'pistol',
  M870: 'shotgun', SPAS: 'shotgun', M60: 'shotgun',
  Нож: 'knife', Керамбит: 'knife', Бабочка: 'knife', 'M9 Байонет': 'knife', Кунай: 'knife',
  Танто: 'knife', Кукри: 'knife', Флип: 'knife', 'Скелетный нож': 'knife', 'Штык-нож': 'knife',
  Перчатки: 'gloves', Граната: 'grenade',
};

/**
 * Ссылка на изображение предмета.
 * Если задан ITEMS_IMAGE_BASE_URL, путь собирается как <base>/<slug>.png —
 * так подключаются собственные картинки. Иначе используется локальная
 * заглушка с силуэтом по типу оружия и цветом редкости.
 */
export function resolveImageUrl(weapon: string, rarity: string, slug: string, kind?: string): string {
  const base = (process.env.ITEMS_IMAGE_BASE_URL || '').replace(/\/+$/, '');
  if (base) return `${base}/${slug}.png`;

  // Тип силуэта: явно переданный (при генерации известна категория),
  // иначе — по названию оружия.
  const resolved = kind ?? IMAGE_KIND[weapon] ?? (/нож|knife|керамбит|бабочка|кунай|танто|кукри/i.test(weapon) ? 'knife' : 'rifle');
  return `/items/${resolved}-${rarity}.svg`;
}

/** Транслитерация названия в slug. */
export function toSlug(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  return name
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `item-${Date.now()}`;
}

/** Превращает распознанную запись в предмет каталога. */
export function toCatalogEntry(item: ScrapedItem, options: { defaultRarity?: string } = {}): CatalogEntry {
  const rarity = options.defaultRarity
    ? (options.defaultRarity as CatalogEntry['rarity'])
    : detectRarity(item.rarity, item.priceCoins);

  const slug = toSlug(item.name);
  const weapon = item.weapon ?? detectWeapon(item.name);

  return {
    slug,
    name: item.name,
    weapon,
    rarity,
    condition: detectCondition(item.name),
    priceCoins: item.priceCoins.toFixed(2),
    // Картинка с сайта-источника, иначе — заглушка по типу оружия и редкости.
    imageUrl: item.imageUrl ?? resolveImageUrl(weapon, rarity, slug),
    isActive: true,
    isWithdrawable: true,
  };
}

/* --------------------------------- Режимы -------------------------------- */

async function loadHtml(args: Args): Promise<string> {
  if (args.file) {
    const absolute = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(absolute)) throw new Error(`Файл не найден: ${absolute}`);
    return fs.readFileSync(absolute, 'utf8');
  }

  if (!args.url) throw new Error('Укажите --url адрес страницы или --file путь к сохранённой странице');

  const response = await fetch(args.url, {
    headers: {
      // Некоторые сайты отдают пустую страницу без привычных заголовков браузера.
      'User-Agent': 'Mozilla/5.0 (compatible; StockTwoCatalogBot/1.0)',
      'Accept-Language': 'ru-RU,ru;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`Сайт вернул статус ${response.status}`);
  return response.text();
}

function loadConfig(file?: string): ScrapeConfig {
  if (!file) return {};
  const absolute = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absolute)) throw new Error(`Файл конфигурации не найден: ${absolute}`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8')) as ScrapeConfig;
}

async function commandScrape(args: Args, inspectOnly: boolean): Promise<void> {
  const html = await loadHtml(args);
  const config = loadConfig(args.config);
  if (args.priceMultiplier) config.priceMultiplier = args.priceMultiplier;

  const report = scrapeHtml(html, config);

  console.log(`Размер страницы: ${(html.length / 1024).toFixed(0)} КБ`);
  console.log('Распознано записей по стратегиям:', report.byStrategy);
  console.log(`Итоговый набор: ${report.items.length} предметов`);

  if (report.items.length === 0) {
    console.log('\nНе удалось распознать предметы автоматически.');
    console.log('Сохраните страницу (Ctrl+S) и запустите с --file page.html,');
    console.log('либо задайте селекторы в файле конфигурации:');
    console.log(
      JSON.stringify(
        {
          itemSelector: '.market-item',
          nameSelector: '.market-item__title',
          priceSelector: '.market-item__price',
          imageSelector: 'img',
          priceMultiplier: 1,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const preview = report.items.slice(0, 12);
  console.log('\nПримеры распознанного:');
  preview.forEach((item) => {
    const entry = toCatalogEntry(item, { defaultRarity: args.defaultRarity });
    console.log(`  ${entry.name} — ${entry.priceCoins} монет · ${entry.weapon} · ${entry.rarity}`);
  });

  if (inspectOnly) {
    console.log('\nРежим проверки: файл не записан. Уберите команду inspect, чтобы сохранить каталог.');
    return;
  }

  writeCatalog(
    report.items.slice(0, args.limit).map((item) => toCatalogEntry(item, { defaultRarity: args.defaultRarity })),
    args.out,
  );
}

/** Разбор CSV: колонки name/price обязательны, остальные необязательны. */
export function parseCsv(content: string): ScrapedItem[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = (lines[0]?.includes(';') ? ';' : ',') as string;
  const headers = (lines[0] ?? '').split(delimiter).map((header) => header.trim().toLowerCase());

  const nameIndex = headers.findIndex((header) => /name|назв|предмет|скин/.test(header));
  const priceIndex = headers.findIndex((header) => /price|цена|стоим/.test(header));
  const imageIndex = headers.findIndex((header) => /image|img|картин|изобр/.test(header));
  const rarityIndex = headers.findIndex((header) => /rarity|редк|качеств/.test(header));

  if (nameIndex < 0 || priceIndex < 0) {
    throw new Error('В CSV нужны колонки с названием и ценой (name/название, price/цена)');
  }

  const items: ScrapedItem[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter);
    const name = cleanName(cells[nameIndex] ?? '');
    const price = parsePrice(cells[priceIndex] ?? '');
    if (!name || !price) continue;

    items.push({
      name,
      priceCoins: price,
      imageUrl: imageIndex >= 0 ? cells[imageIndex]?.trim() || undefined : undefined,
      rarity: rarityIndex >= 0 ? cells[rarityIndex]?.trim() || undefined : undefined,
      strategy: 'csv',
    });
  }

  return items;
}

function commandCsv(args: Args): void {
  if (!args.file) throw new Error('Укажите путь к CSV-файлу');
  const absolute = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(absolute)) throw new Error(`Файл не найден: ${absolute}`);

  const items = parseCsv(fs.readFileSync(absolute, 'utf8'));
  console.log(`Из CSV прочитано ${items.length} предметов`);

  writeCatalog(
    items.map((item) => toCatalogEntry(item, { defaultRarity: args.defaultRarity })),
    args.out,
  );
}

/* ------------------------- Генерация из справочника ----------------------- */

interface WeaponsFile {
  categories: Array<{ id: string; title: string; weapons: Array<{ name: string; priceFactor: number }> }>;
  finishes: Record<string, string[]>;
  basePrices: Record<string, number>;
  conditionFactors: Record<string, number>;
}

/** Детерминированный разброс цены, чтобы предметы одной редкости отличались. */
export function priceJitter(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  }
  return 0.8 + (hash % 45) / 100; // 0.80 … 1.24
}

function commandGenerate(args: Args): void {
  const file = path.resolve(process.cwd(), 'database/weapons.json');
  const fallback = path.resolve(__dirname, '..', '..', '..', 'database', 'weapons.json');
  const source = fs.existsSync(file) ? file : fallback;
  if (!fs.existsSync(source)) throw new Error('Не найден справочник database/weapons.json');

  const data = JSON.parse(fs.readFileSync(source, 'utf8')) as WeaponsFile;
  const entries: CatalogEntry[] = [];

  // Ножи и перчатки не бывают обычными — задаём допустимые редкости по категориям.
  const rarityByCategory: Record<string, string[]> = {
    knife: ['epic', 'legendary', 'arcane', 'contraband'],
    gloves: ['legendary', 'arcane', 'contraband'],
    grenade: ['common', 'rare'],
  };

  for (const category of data.categories) {
    const rarities = rarityByCategory[category.id] ?? ['common', 'rare', 'epic', 'legendary', 'arcane'];

    for (const weapon of category.weapons) {
      for (const rarity of rarities) {
        const finishes = data.finishes[rarity] ?? [];
        for (const finish of finishes) {
          const name = `${weapon.name} | ${finish}`;
          const slug = toSlug(name);
          const base = data.basePrices[rarity] ?? 100;
          const condition = pickCondition(rarity, slug, data.conditionFactors);
          const conditionFactor = data.conditionFactors[condition] ?? 1;
          const price = base * weapon.priceFactor * conditionFactor * priceJitter(slug);

          entries.push({
            slug,
            name,
            weapon: weapon.name,
            rarity: rarity as CatalogEntry['rarity'],
            condition: condition as CatalogEntry['condition'],
            priceCoins: Math.max(1, Math.round(price)).toString(),
            imageUrl: resolveImageUrl(weapon.name, rarity, slug, category.id),
            isActive: true,
            isWithdrawable: true,
          });
        }
      }
    }
  }

  console.log(`Сгенерировано ${entries.length} предметов из справочника оружия`);
  writeCatalog(entries, args.out);
}

/** Состояние выбирается детерминированно, дорогие предметы — в лучшем состоянии. */
function pickCondition(rarity: string, seed: string, factors: Record<string, number>): string {
  const conditions = Object.keys(factors);
  if (rarity === 'arcane' || rarity === 'contraband') return 'factory_new';

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 17 + seed.charCodeAt(i)) % 9973;
  return conditions[hash % conditions.length] ?? 'field_tested';
}

/* --------------------------------- Запись -------------------------------- */

function writeCatalog(entries: CatalogEntry[], out: string): void {
  const unique = new Map<string, CatalogEntry>();
  entries.forEach((entry) => unique.set(entry.slug, entry));

  const list = [...unique.values()].sort((a, b) => Number(a.priceCoins) - Number(b.priceCoins));
  const absolute = path.resolve(process.cwd(), out);

  fs.writeFileSync(
    absolute,
    JSON.stringify(
      {
        $comment: 'Каталог предметов. Цены в монетах (1 монета = 1 ₽). Загрузка: npm run items:import -- ' + out,
        generatedAt: new Date().toISOString(),
        items: list,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\nЗаписано ${list.length} предметов в ${absolute}`);
  console.log(`Загрузить в базу: npm run items:import --workspace backend -- ${out}`);
}

/* ---------------------------------- Вход --------------------------------- */

function printHelp(): void {
  console.log(`Сборщик каталога предметов STOCK2

Режимы:
  inspect   --url <адрес>            показать, что распознано на странице
  scrape    --url <адрес> | --file <файл.html> [--config <конфиг.json>]
  csv       <файл.csv>               взять названия и цены из таблицы
  generate                           сгенерировать из database/weapons.json

Общие параметры:
  --out <файл>              куда записать (по умолчанию catalog.json)
  --limit <число>           ограничить количество предметов
  --price-multiplier <n>    умножить цены (если на сайте не рубли)
  --rarity <редкость>       задать редкость всем предметам

Примеры:
  npm run catalog:inspect  --workspace backend -- --url https://example.com/market
  npm run catalog:scrape   --workspace backend -- --file page.html --out catalog.json
  npm run catalog:csv      --workspace backend -- prices.csv
  npm run catalog:generate --workspace backend
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'inspect':
      await commandScrape(args, true);
      break;
    case 'scrape':
      await commandScrape(args, false);
      break;
    case 'csv':
      commandCsv(args);
      break;
    case 'generate':
      commandGenerate(args);
      break;
    default:
      printHelp();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exit(1);
  });
}
