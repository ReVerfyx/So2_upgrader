/**
 * Демонстрационный каталог предметов Standoff 2.
 *
 * Цены указаны в МОНЕТАХ (1 монета = 1 ₽) и отражают порядок рыночных цен
 * внутриигровых предметов, но НЕ являются актуальным прайс-листом:
 * реальная стоимость скинов Standoff 2 постоянно меняется.
 *
 * Актуальный каталог со своими ценами и изображениями загружается одной
 * командой без правки кода:
 *
 *     npm run items:import --workspace backend -- ./catalog.json
 *
 * либо через админ-панель (раздел «Предметы»). Формат файла описан
 * в docs/catalog.md, пример — в database/catalog.example.json.
 *
 * Изображения: по умолчанию используются нейтральные локальные заглушки
 * из /public/items. Чтобы подставить собственные картинки, укажите базовый
 * адрес в переменной окружения ITEMS_IMAGE_BASE_URL — тогда путь предмета
 * будет собран как `${ITEMS_IMAGE_BASE_URL}/<slug>.png`.
 */

export type SeedRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'arcane' | 'contraband';
export type SeedCondition = 'factory_new' | 'minimal_wear' | 'field_tested' | 'well_worn' | 'battle_scarred';

export interface SeedItem {
  slug: string;
  name: string;
  weapon: string;
  rarity: SeedRarity;
  condition: SeedCondition;
  /** Цена в монетах (1 монета = 1 ₽). */
  priceCoins: string;
  image?: string;
}

/** Базовый адрес изображений предметов (если задан — используется вместо заглушек). */
const IMAGE_BASE = (process.env.ITEMS_IMAGE_BASE_URL || '').replace(/\/+$/, '');

/** Путь к изображению: собственный CDN либо локальная заглушка по типу оружия. */
export function resolveImage(item: Pick<SeedItem, 'slug' | 'weapon' | 'rarity'>): string {
  if (IMAGE_BASE) return `${IMAGE_BASE}/${item.slug}.png`;
  const kind = WEAPON_KIND[item.weapon] ?? 'rifle';
  return `/items/${kind}-${item.rarity}.svg`;
}

/** Соответствие «оружие → тип силуэта заглушки». */
export const WEAPON_KIND: Record<string, string> = {
  AKR: 'rifle',
  M4: 'rifle',
  M4A1: 'rifle',
  Famas: 'rifle',
  AUG: 'rifle',
  AWM: 'sniper',
  'Scar-H': 'sniper',
  M60: 'rifle',
  MP5: 'smg',
  UMP: 'smg',
  'Tec-9': 'pistol',
  USP: 'pistol',
  P350: 'pistol',
  'Desert Eagle': 'pistol',
  Нож: 'knife',
  Перчатки: 'gloves',
  Граната: 'grenade',
};

/**
 * Каталог. Использованы реальные виды оружия Standoff 2 и общеупотребимые
 * названия расцветок. Перед запуском в бой замените каталог своим прайсом.
 */
export const SEED_ITEMS: SeedItem[] = [
  // --- Пистолеты и бюджетное оружие -----------------------------------------
  { slug: 'p350-sandstorm', name: 'P350 | Песчаная буря', weapon: 'P350', rarity: 'common', condition: 'field_tested', priceCoins: '35' },
  { slug: 'usp-carbon', name: 'USP | Карбон', weapon: 'USP', rarity: 'common', condition: 'minimal_wear', priceCoins: '60' },
  { slug: 'tec9-graffiti', name: 'Tec-9 | Граффити', weapon: 'Tec-9', rarity: 'common', condition: 'field_tested', priceCoins: '85' },
  { slug: 'mp5-forest', name: 'MP5 | Лесной камуфляж', weapon: 'MP5', rarity: 'common', condition: 'field_tested', priceCoins: '120' },
  { slug: 'ump-urban', name: 'UMP | Городской', weapon: 'UMP', rarity: 'common', condition: 'well_worn', priceCoins: '150' },
  { slug: 'akr-desert-sand', name: 'AKR | Пески пустыни', weapon: 'AKR', rarity: 'common', condition: 'field_tested', priceCoins: '190' },

  // --- Редкие ---------------------------------------------------------------
  { slug: 'm4-urban-camo', name: 'M4 | Городской камуфляж', weapon: 'M4', rarity: 'rare', condition: 'minimal_wear', priceCoins: '280' },
  { slug: 'akr-blue-steel', name: 'AKR | Вороненая сталь', weapon: 'AKR', rarity: 'rare', condition: 'minimal_wear', priceCoins: '420' },
  { slug: 'famas-neon', name: 'Famas | Неон', weapon: 'Famas', rarity: 'rare', condition: 'factory_new', priceCoins: '560' },
  { slug: 'awm-glacier', name: 'AWM | Ледник', weapon: 'AWM', rarity: 'rare', condition: 'factory_new', priceCoins: '750' },
  { slug: 'deagle-crimson', name: 'Desert Eagle | Багровый', weapon: 'Desert Eagle', rarity: 'rare', condition: 'field_tested', priceCoins: '980' },
  { slug: 'ump-cyber-grid', name: 'UMP | Кибер-сетка', weapon: 'UMP', rarity: 'rare', condition: 'minimal_wear', priceCoins: '1250' },

  // --- Эпические ------------------------------------------------------------
  { slug: 'akr-cyber-skull', name: 'AKR | Кибер-череп', weapon: 'AKR', rarity: 'epic', condition: 'factory_new', priceCoins: '1800' },
  { slug: 'm4-hyperbeast', name: 'M4 | Гиперзверь', weapon: 'M4', rarity: 'epic', condition: 'minimal_wear', priceCoins: '2400' },
  { slug: 'awm-asiimov', name: 'AWM | Асимов', weapon: 'AWM', rarity: 'epic', condition: 'field_tested', priceCoins: '3200' },
  { slug: 'kukri-rust', name: 'Кукри | Ржавчина', weapon: 'Нож', rarity: 'epic', condition: 'battle_scarred', priceCoins: '4100' },
  { slug: 'deagle-access-code', name: 'Desert Eagle | Код доступа', weapon: 'Desert Eagle', rarity: 'epic', condition: 'factory_new', priceCoins: '5300' },
  { slug: 'tanto-tiger', name: 'Танто | Тигр', weapon: 'Нож', rarity: 'epic', condition: 'minimal_wear', priceCoins: '6800' },

  // --- Легендарные ----------------------------------------------------------
  { slug: 'akr-dragon', name: 'AKR | Дракон', weapon: 'AKR', rarity: 'legendary', condition: 'factory_new', priceCoins: '9500' },
  { slug: 'kunai-blood', name: 'Кунай | Кровавый', weapon: 'Нож', rarity: 'legendary', condition: 'minimal_wear', priceCoins: '13000' },
  { slug: 'm4-golden-eagle', name: 'M4 | Золотой орёл', weapon: 'M4', rarity: 'legendary', condition: 'minimal_wear', priceCoins: '17500' },
  { slug: 'awm-phantom', name: 'AWM | Фантом', weapon: 'AWM', rarity: 'legendary', condition: 'factory_new', priceCoins: '23000' },
  { slug: 'butterfly-marble', name: 'Бабочка | Мрамор', weapon: 'Нож', rarity: 'legendary', condition: 'factory_new', priceCoins: '31000' },
  { slug: 'm9-bayonet-fade', name: 'M9 Байонет | Градиент', weapon: 'Нож', rarity: 'legendary', condition: 'factory_new', priceCoins: '42000' },

  // --- Арканные -------------------------------------------------------------
  { slug: 'karambit-doppler', name: 'Керамбит | Доплер', weapon: 'Нож', rarity: 'arcane', condition: 'factory_new', priceCoins: '58000' },
  { slug: 'karambit-fade', name: 'Керамбит | Градиент', weapon: 'Нож', rarity: 'arcane', condition: 'factory_new', priceCoins: '74000' },
  { slug: 'butterfly-sapphire', name: 'Бабочка | Сапфир', weapon: 'Нож', rarity: 'arcane', condition: 'factory_new', priceCoins: '95000' },

  // --- Контрабанда (топ рынка) ----------------------------------------------
  { slug: 'gloves-crimson-web', name: 'Перчатки | Багровая паутина', weapon: 'Перчатки', rarity: 'contraband', condition: 'factory_new', priceCoins: '130000' },
  { slug: 'karambit-gold', name: 'Керамбит | Золото', weapon: 'Нож', rarity: 'contraband', condition: 'factory_new', priceCoins: '185000' },
  { slug: 'karambit-ruby', name: 'Керамбит | Рубин', weapon: 'Нож', rarity: 'contraband', condition: 'factory_new', priceCoins: '260000' },
];

/** Стартовые предметы, выдаваемые новому пользователю в тестовом режиме. */
export const STARTER_ITEM_SLUGS = ['p350-sandstorm', 'usp-carbon', 'mp5-forest'];
