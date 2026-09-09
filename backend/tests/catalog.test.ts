/**
 * Тесты сборщика каталога: распознавание цен, оружия, редкости,
 * разбор HTML-страниц и CSV-выгрузок.
 */
import { describe, expect, it } from 'vitest';
import { parsePrice, cleanName, looksLikeItemName, looksLikePrice, scrapeHtml, dedupe } from '../src/db/catalogSources';
import {
  detectCondition,
  detectRarity,
  detectWeapon,
  parseCsv,
  priceJitter,
  resolveImageUrl,
  toCatalogEntry,
  toSlug,
} from '../src/db/buildCatalog';
import { validateEntry } from '../src/db/importCatalog';

describe('Разбор цены', () => {
  it('понимает разные форматы', () => {
    expect(parsePrice('1 250,50 ₽')).toBe(1250.5);
    expect(parsePrice('1250.50 RUB')).toBe(1250.5);
    expect(parsePrice('12 500 голды')).toBe(12500);
    expect(parsePrice('от 599 ₽')).toBe(599);
  });

  it('возвращает null, если цены нет', () => {
    expect(parsePrice('нет в наличии')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });
});

describe('Распознавание названий', () => {
  it('отсекает служебный текст', () => {
    expect(looksLikeItemName('AKR | Дракон')).toBe(true);
    expect(looksLikeItemName('Цена')).toBe(false);
    expect(looksLikeItemName('1 250,00')).toBe(false);
    expect(looksLikeItemName('ab')).toBe(false);
  });

  it('чистит пробелы', () => {
    expect(cleanName('  AKR   |   Дракон \n')).toBe('AKR | Дракон');
  });
});

describe('Отличие цены от названия', () => {
  it('распознаёт цену по валюте или чистым цифрам', () => {
    expect(looksLikePrice('9 500 ₽')).toBe(true);
    expect(looksLikePrice('1250,50')).toBe(true);
    expect(looksLikePrice('12 500 голды')).toBe(true);
  });

  it('не принимает за цену названия с числами', () => {
    // Названия оружия Standoff 2 содержат цифры — это не цены
    expect(looksLikePrice('M4 | Дракон')).toBe(false);
    expect(looksLikePrice('P350 | Сталь')).toBe(false);
    expect(looksLikePrice('Tec-9 | Граффити')).toBe(false);
    expect(looksLikePrice('M9 Байонет | Золото')).toBe(false);
  });

  it('карточки с числами в названии разбираются верно', () => {
    const cards = ['M4 | Дракон', 'P350 | Сталь', 'Tec-9 | Граффити', 'M9 Байонет | Золото', 'AWM | Ледник', 'UMP45 | Неон']
      .map((name, index) => `<div class="c"><span>${name}</span><b>${100 + index * 10} ₽</b></div>`)
      .join('');

    const report = scrapeHtml(`<div>${cards}</div>`);
    expect(report.items).toHaveLength(6);
    expect(report.items.map((item) => item.name)).toContain('Tec-9 | Граффити');
    expect(report.items.find((item) => item.name.startsWith('M9'))?.priceCoins).toBe(130);
  });
});

describe('Определение свойств предмета', () => {
  it('находит тип оружия по названию', () => {
    expect(detectWeapon('AKR | Дракон')).toBe('AKR');
    expect(detectWeapon('Керамбит | Градиент')).toBe('Нож');
    expect(detectWeapon('Бабочка | Сапфир')).toBe('Нож');
    expect(detectWeapon('Desert Eagle | Код доступа')).toBe('Desert Eagle');
    expect(detectWeapon('Перчатки | Паутина')).toBe('Перчатки');
    expect(detectWeapon('Неизвестная штука')).toBe('Прочее');
  });

  it('определяет редкость по подсказке', () => {
    expect(detectRarity('Легендарное', 100)).toBe('legendary');
    expect(detectRarity('Арканное', 100)).toBe('arcane');
    expect(detectRarity('Контрабанда', 100)).toBe('contraband');
  });

  it('определяет редкость по цене, если подсказки нет', () => {
    expect(detectRarity(undefined, 50)).toBe('common');
    expect(detectRarity(undefined, 500)).toBe('rare');
    expect(detectRarity(undefined, 2000)).toBe('epic');
    expect(detectRarity(undefined, 8000)).toBe('legendary');
    expect(detectRarity(undefined, 40_000)).toBe('arcane');
    expect(detectRarity(undefined, 150_000)).toBe('contraband');
  });

  it('определяет состояние', () => {
    expect(detectCondition('AKR | Дракон (Прямо с завода)')).toBe('factory_new');
    expect(detectCondition('AKR | Дракон (Field-Tested)')).toBe('field_tested');
    expect(detectCondition('AKR | Дракон')).toBe('field_tested');
  });

  it('транслитерирует название в slug', () => {
    expect(toSlug('Керамбит | Градиент')).toBe('kerambit-gradient');
    expect(toSlug('AKR | Дракон')).toBe('akr-drakon');
    expect(toSlug('M9 Байонет | Золото')).toBe('m9-bayonet-zoloto');
  });

  it('подставляет заглушку изображения по типу оружия', () => {
    expect(resolveImageUrl('Керамбит', 'arcane', 'kerambit-doppler')).toBe('/items/knife-arcane.svg');
    expect(resolveImageUrl('AWM', 'epic', 'awm-asimov')).toBe('/items/sniper-epic.svg');
    expect(resolveImageUrl('USP', 'common', 'usp-karbon')).toBe('/items/pistol-common.svg');
  });

  it('разброс цены детерминирован и лежит в заданном коридоре', () => {
    expect(priceJitter('test')).toBe(priceJitter('test'));
    for (const seed of ['a', 'akr-drakon', 'kerambit-zoloto']) {
      expect(priceJitter(seed)).toBeGreaterThanOrEqual(0.8);
      expect(priceJitter(seed)).toBeLessThanOrEqual(1.25);
    }
  });
});

describe('Готовая запись каталога', () => {
  it('проходит проверку импорта', () => {
    const entry = toCatalogEntry({ name: 'AKR | Дракон', priceCoins: 9500, strategy: 'test' });
    expect(validateEntry(entry)).toBeNull();
    expect(entry).toMatchObject({ slug: 'akr-drakon', weapon: 'AKR', rarity: 'legendary' });
  });
});

describe('Разбор HTML-страниц', () => {
  it('читает таблицу с ценами', () => {
    const html = `
      <table>
        <tr><th>Скин</th><th>Цена</th></tr>
        <tr><td>AKR | Дракон</td><td>9 500 ₽</td></tr>
        <tr><td>Керамбит | Рубин</td><td>54 060 ₽</td></tr>
        <tr><td>USP | Карбон</td><td>60 ₽</td></tr>
      </table>`;

    const report = scrapeHtml(html);
    expect(report.items.length).toBe(3);
    expect(report.items.find((item) => item.name.includes('Дракон'))?.priceCoins).toBe(9500);
  });

  it('читает данные из встроенного JSON', () => {
    const html = `<script type="application/json">
      {"props":{"items":[
        {"name":"AWM | Фантом","price":23000,"rarity":"legendary","image":"/a.png"},
        {"name":"Бабочка | Сапфир","price":95000,"rarity":"arcane"}
      ]}}
    </script>`;

    const report = scrapeHtml(html);
    expect(report.items.length).toBe(2);
    expect(report.items[0]?.strategy).toBe('json');
  });

  it('читает повторяющиеся карточки', () => {
    const cards = Array.from(
      { length: 8 },
      (_value, index) => `<div class="market-card"><span>AKR | Скин ${index}</span>  <b>${100 + index} ₽</b></div>`,
    ).join('');

    const report = scrapeHtml(`<div>${cards}</div>`);
    expect(report.items.length).toBeGreaterThanOrEqual(8);
  });

  it('работает по пользовательским селекторам', () => {
    const html = `
      <div class="p"><h3 class="t">AKR | Дракон</h3><span class="c">9500</span><img src="/img/akr.png"></div>
      <div class="p"><h3 class="t">USP | Карбон</h3><span class="c">60</span><img src="/img/usp.png"></div>`;

    const report = scrapeHtml(html, { itemSelector: '.p', nameSelector: '.t', priceSelector: '.c' });
    const fromConfig = report.items.filter((item) => item.strategy === 'config');
    expect(fromConfig.length).toBe(2);
    expect(fromConfig[0]?.imageUrl).toBe('/img/akr.png');
  });

  it('применяет множитель цены', () => {
    const html = `<div class="p"><span class="t">AKR | Дракон</span><span class="c">100</span></div>
                  <div class="p"><span class="t">USP | Карбон</span><span class="c">10</span></div>`;
    const report = scrapeHtml(html, {
      itemSelector: '.p',
      nameSelector: '.t',
      priceSelector: '.c',
      priceMultiplier: 1.5,
    });
    expect(report.items.find((item) => item.name.includes('Дракон'))?.priceCoins).toBe(150);
  });

  it('убирает дубли, оставляя минимальную цену', () => {
    const items = dedupe([
      { name: 'AKR | Дракон', priceCoins: 9500, strategy: 'a' },
      { name: 'akr | дракон', priceCoins: 9000, strategy: 'b' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.priceCoins).toBe(9000);
  });
});

describe('Разбор CSV', () => {
  it('читает выгрузку с запятой', () => {
    const csv = 'name,price,rarity\nAKR | Дракон,9500,Легендарное\nUSP | Карбон,60,Обычное';
    const items = parseCsv(csv);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'AKR | Дракон', priceCoins: 9500, rarity: 'Легендарное' });
  });

  it('читает выгрузку с точкой с запятой и русскими заголовками', () => {
    const csv = 'Название;Цена;Изображение\nКерамбит | Рубин;54 060;https://cdn/k.png';
    const items = parseCsv(csv);
    expect(items[0]).toMatchObject({ name: 'Керамбит | Рубин', priceCoins: 54060 });
    expect(items[0]?.imageUrl).toBe('https://cdn/k.png');
  });

  it('требует колонки с названием и ценой', () => {
    expect(() => parseCsv('a,b\n1,2')).toThrow(/название/i);
  });
});
