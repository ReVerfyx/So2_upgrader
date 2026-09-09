/**
 * Извлечение каталога скинов из веб-страницы.
 *
 * Сайты с прайсами устроены по-разному, поэтому применяется несколько
 * стратегий подряд — от самой надёжной к самой общей:
 *
 *  1. Данные, встроенные в страницу как JSON (Next.js `__NEXT_DATA__`,
 *     Nuxt `__NUXT__`, теги `<script type="application/json">`).
 *  2. HTML-таблицы: ищется столбец с названием и столбец с ценой.
 *  3. Повторяющиеся карточки: блоки одинаковой структуры, внутри которых
 *     есть текст и число, похожее на цену.
 *  4. Пользовательские CSS-селекторы из файла конфигурации.
 *
 * Режим `--inspect` показывает, что удалось распознать, не записывая файл, —
 * так подбирается конфигурация под конкретный сайт.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

export interface ScrapedItem {
  name: string;
  priceCoins: number;
  imageUrl?: string;
  rarity?: string;
  weapon?: string;
  /** Как была получена запись — попадает в отчёт режима --inspect. */
  strategy: string;
}

export interface ScrapeConfig {
  /** CSS-селектор карточки предмета. */
  itemSelector?: string;
  /** Селекторы внутри карточки. */
  nameSelector?: string;
  priceSelector?: string;
  imageSelector?: string;
  raritySelector?: string;
  /** Атрибут, из которого брать ссылку на изображение. */
  imageAttribute?: string;
  /** Множитель цены (например, если на сайте цены в голде). */
  priceMultiplier?: number;
}

/* ------------------------------- Разбор цены ------------------------------ */

/**
 * Извлекает число из текста цены: «1 250,50 ₽», «1250.5 RUB», «12 500 голды».
 * Возвращает null, если числа нет.
 */
export function parsePrice(text: string): number | null {
  if (!text) return null;

  const cleaned = text
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d.,\s]/g, ' ')
    .trim();

  // Берём самую длинную числовую последовательность: обычно это и есть цена.
  const candidates = cleaned.match(/\d[\d\s]*(?:[.,]\d{1,2})?/g);
  if (!candidates || candidates.length === 0) return null;

  const best = candidates.sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)[0];
  if (!best) return null;

  const normalized = best.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Отличает ячейку с ценой от названия предмета.
 *
 * Важно: в названиях скинов Standoff 2 встречаются числа («M4», «P350»,
 * «Tec-9»), поэтому одного лишь наличия цифр недостаточно. Ценой считается
 * текст с валютным обозначением либо почти целиком состоящий из цифр.
 */
export function looksLikePrice(text: string): boolean {
  const value = text.trim();
  if (value.length === 0 || value.length > 40) return false;
  if (parsePrice(value) === null) return false;

  // Явное указание валюты.
  if (/[₽$€]|руб|rub|usd|голд|coins?|монет/i.test(value)) return true;

  // Почти только цифры и разделители: «9 500», «1 250,50».
  const digits = (value.match(/\d/g) ?? []).length;
  const letters = (value.match(/[a-zа-яё]/gi) ?? []).length;
  return digits > 0 && letters === 0;
}

/** Убирает лишние пробелы и обрезает слишком длинные названия. */
export function cleanName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Похоже ли на название предмета (а не на служебный текст). */
export function looksLikeItemName(name: string): boolean {
  if (name.length < 3 || name.length > 120) return false;
  // Отсекаем чисто числовые ячейки и типичные заголовки.
  if (/^[\d\s.,%+-]+$/.test(name)) return false;
  if (/^(цена|название|предмет|скин|item|name|price|итого|всего)$/i.test(name)) return false;
  return true;
}

/* --------------------------- Стратегия 1: JSON ---------------------------- */

/** Рекурсивно обходит структуру и собирает объекты, похожие на предметы. */
export function collectItemsFromJson(data: unknown, depth = 0): ScrapedItem[] {
  if (depth > 8 || data === null || typeof data !== 'object') return [];

  const found: ScrapedItem[] = [];

  if (Array.isArray(data)) {
    data.forEach((entry) => found.push(...collectItemsFromJson(entry, depth + 1)));
    return found;
  }

  const record = data as Record<string, unknown>;
  const nameKey = ['name', 'title', 'itemName', 'skin', 'skinName', 'fullName'].find(
    (key) => typeof record[key] === 'string' && looksLikeItemName(String(record[key])),
  );
  const priceKey = ['price', 'cost', 'value', 'priceRub', 'price_rub', 'minPrice', 'avgPrice'].find((key) => {
    const value = record[key];
    return typeof value === 'number' || (typeof value === 'string' && parsePrice(value) !== null);
  });

  if (nameKey && priceKey) {
    const rawPrice = record[priceKey];
    const price = typeof rawPrice === 'number' ? rawPrice : parsePrice(String(rawPrice));
    if (price && price > 0) {
      const image = ['image', 'img', 'icon', 'imageUrl', 'image_url', 'preview'].find(
        (key) => typeof record[key] === 'string',
      );
      const rarity = ['rarity', 'quality', 'grade', 'type'].find((key) => typeof record[key] === 'string');

      found.push({
        name: cleanName(String(record[nameKey])),
        priceCoins: price,
        imageUrl: image ? String(record[image]) : undefined,
        rarity: rarity ? String(record[rarity]) : undefined,
        strategy: 'json',
      });
    }
  }

  Object.values(record).forEach((value) => found.push(...collectItemsFromJson(value, depth + 1)));
  return found;
}

/** Ищет JSON, встроенный в страницу. */
export function extractFromEmbeddedJson($: CheerioAPI): ScrapedItem[] {
  const found: ScrapedItem[] = [];

  $('script').each((_index, element) => {
    const content = $(element).html() ?? '';
    if (content.length < 40) return;

    const candidates: string[] = [];

    // Next.js / обычный JSON-скрипт
    const type = $(element).attr('type') ?? '';
    if (type.includes('json')) candidates.push(content);

    // window.__NUXT__ = {...} / window.__INITIAL_STATE__ = {...}
    const assigned = /window\.__[A-Z_]+__\s*=\s*(\{[\s\S]+?\});?\s*$/.exec(content);
    if (assigned?.[1]) candidates.push(assigned[1]);

    for (const candidate of candidates) {
      try {
        found.push(...collectItemsFromJson(JSON.parse(candidate)));
      } catch {
        /* не JSON — пропускаем */
      }
    }
  });

  return found;
}

/* -------------------------- Стратегия 2: таблицы -------------------------- */

export function extractFromTables($: CheerioAPI): ScrapedItem[] {
  const found: ScrapedItem[] = [];

  $('table').each((_index, table) => {
    const rows = $(table).find('tr');
    if (rows.length < 3) return;

    rows.each((rowIndex, row) => {
      if (rowIndex === 0 && $(row).find('th').length > 0) return; // заголовок

      const cells = $(row).find('td');
      if (cells.length < 2) return;

      const texts = cells.map((_i, cell) => cleanName($(cell).text())).get();

      // Название — ячейка с текстом, цена — ячейка, похожая на цену.
      const name = texts.find((text) => looksLikeItemName(text) && !looksLikePrice(text));
      if (!name) return;

      const priceCell = texts.find((text) => text !== name && looksLikePrice(text));
      const price = priceCell ? parsePrice(priceCell) : null;
      if (!price) return;

      const image = $(row).find('img').first().attr('src');
      found.push({ name, priceCoins: price, imageUrl: image ?? undefined, strategy: 'table' });
    });
  });

  return found;
}

/* -------------------------- Стратегия 3: карточки ------------------------- */

/** Ищет группы одинаковых блоков, внутри которых есть название и цена. */
export function extractFromRepeatedCards($: CheerioAPI): ScrapedItem[] {
  // Группируем элементы по классу: повторяющийся класс = карточки одного вида.
  const groups = new Map<string, Element[]>();

  $('[class]').each((_index, element) => {
    const className = ($(element).attr('class') ?? '').trim();
    if (!className || className.length > 120) return;
    const list = groups.get(className);
    if (list) list.push(element);
    else groups.set(className, [element]);
  });

  let best: ScrapedItem[] = [];

  for (const [, nodes] of groups) {
    if (nodes.length < 5) continue; // нужна повторяющаяся структура

    const items: ScrapedItem[] = [];
    for (const node of nodes) {
      const whole = cleanName($(node).text());
      if (whole.length > 300 || whole.length < 3) continue;

      // Разбираем карточку по вложенным элементам: отдельно название,
      // отдельно цена. Это надёжнее, чем делить общий текст.
      const chunks: string[] = [];
      $(node)
        .find('*')
        .each((_i, child) => {
          const text = cleanName($(child).text());
          if (text.length > 0 && text.length <= 120) chunks.push(text);
        });
      if (chunks.length === 0) chunks.push(whole);

      const priceChunk = chunks.find((text) => looksLikePrice(text));
      const price = priceChunk ? parsePrice(priceChunk) : null;
      if (!price) continue;

      const nameCandidates = chunks
        .filter((text) => text !== priceChunk && looksLikeItemName(text) && !looksLikePrice(text))
        .sort((a, b) => b.length - a.length);

      const name = nameCandidates[0];
      if (!name) continue;

      const image = $(node).find('img').first().attr('src') ?? $(node).find('img').first().attr('data-src');
      items.push({ name, priceCoins: price, imageUrl: image ?? undefined, strategy: 'cards' });
    }

    if (items.length > best.length) best = items;
  }

  return best;
}

/* ----------------------- Стратегия 4: свои селекторы ---------------------- */

export function extractWithConfig($: CheerioAPI, config: ScrapeConfig): ScrapedItem[] {
  if (!config.itemSelector) return [];

  const items: ScrapedItem[] = [];
  const multiplier = config.priceMultiplier ?? 1;

  $(config.itemSelector).each((_index, node) => {
    const scope = $(node);
    const nameText = config.nameSelector ? scope.find(config.nameSelector).first().text() : scope.text();
    const priceText = config.priceSelector ? scope.find(config.priceSelector).first().text() : scope.text();

    const name = cleanName(nameText);
    // При явно указанном селекторе цены доверяем ему без дополнительных проверок.
    const price = config.priceSelector ? parsePrice(priceText) : looksLikePrice(priceText) ? parsePrice(priceText) : null;
    if (!looksLikeItemName(name) || !price) return;

    const imageAttribute = config.imageAttribute ?? 'src';
    const image = config.imageSelector
      ? scope.find(config.imageSelector).first().attr(imageAttribute)
      : scope.find('img').first().attr(imageAttribute);

    const rarity = config.raritySelector ? cleanName(scope.find(config.raritySelector).first().text()) : undefined;

    items.push({
      name,
      priceCoins: price * multiplier,
      imageUrl: image ?? undefined,
      rarity: rarity || undefined,
      strategy: 'config',
    });
  });

  return items;
}

/* ------------------------------- Общий вход ------------------------------- */

export interface ScrapeReport {
  items: ScrapedItem[];
  byStrategy: Record<string, number>;
}

/** Прогоняет все стратегии и возвращает лучший результат. */
export function scrapeHtml(html: string, config: ScrapeConfig = {}): ScrapeReport {
  const $ = cheerio.load(html);

  const attempts: ScrapedItem[][] = [
    extractWithConfig($, config),
    extractFromEmbeddedJson($),
    extractFromTables($),
    extractFromRepeatedCards($),
  ];

  const byStrategy: Record<string, number> = {};
  attempts.forEach((items) => {
    items.forEach((item) => {
      byStrategy[item.strategy] = (byStrategy[item.strategy] ?? 0) + 1;
    });
  });

  // Побеждает стратегия, давшая больше всего уникальных названий.
  const best = attempts
    .map((items) => dedupe(items))
    .sort((a, b) => b.length - a.length)[0] ?? [];

  return { items: best, byStrategy };
}

/** Убирает повторы по названию, оставляя минимальную цену. */
export function dedupe(items: ScrapedItem[]): ScrapedItem[] {
  const map = new Map<string, ScrapedItem>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = map.get(key);
    if (!existing || item.priceCoins < existing.priceCoins) map.set(key, item);
  }
  return [...map.values()];
}
