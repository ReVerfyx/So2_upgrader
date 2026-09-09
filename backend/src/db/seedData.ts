/**
 * Демонстрационный каталог предметов.
 *
 * Изображения — нейтральные локальные placeholder-заглушки (SVG) из /public/items.
 * Реальные картинки подставляются позднее через админ-панель
 * (поле «Ссылка на изображение» у предмета) без изменения кода.
 */
export interface SeedItem {
  slug: string;
  name: string;
  weapon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'arcane' | 'contraband';
  condition: 'factory_new' | 'minimal_wear' | 'field_tested' | 'well_worn' | 'battle_scarred';
  priceTon: string;
  image: string;
}

const img = (rarity: string) => `/items/placeholder-${rarity}.svg`;

export const SEED_ITEMS: SeedItem[] = [
  { slug: 'ak-desert-sand', name: 'AKR | Пески пустыни', weapon: 'AKR', rarity: 'common', condition: 'field_tested', priceTon: '0.35', image: img('common') },
  { slug: 'm4-urban-grey', name: 'M4 | Городской серый', weapon: 'M4', rarity: 'common', condition: 'well_worn', priceTon: '0.42', image: img('common') },
  { slug: 'usp-carbon', name: 'USP | Карбон', weapon: 'USP', rarity: 'common', condition: 'minimal_wear', priceTon: '0.58', image: img('common') },
  { slug: 'p350-steel', name: 'P350 | Сталь', weapon: 'P350', rarity: 'common', condition: 'factory_new', priceTon: '0.72', image: img('common') },
  { slug: 'mp5-forest', name: 'MP5 | Лесной камуфляж', weapon: 'MP5', rarity: 'common', condition: 'field_tested', priceTon: '0.95', image: img('common') },

  { slug: 'ak-blue-steel', name: 'AKR | Вороненая сталь', weapon: 'AKR', rarity: 'rare', condition: 'minimal_wear', priceTon: '1.40', image: img('rare') },
  { slug: 'm4-crimson', name: 'M4 | Багровый рассвет', weapon: 'M4', rarity: 'rare', condition: 'field_tested', priceTon: '1.88', image: img('rare') },
  { slug: 'awp-glacier', name: 'AWM | Ледник', weapon: 'AWM', rarity: 'rare', condition: 'factory_new', priceTon: '2.60', image: img('rare') },
  { slug: 'ump-neon-grid', name: 'UMP | Неоновая сетка', weapon: 'UMP', rarity: 'rare', condition: 'minimal_wear', priceTon: '3.15', image: img('rare') },
  { slug: 'kukri-rust', name: 'Кукри | Ржавчина', weapon: 'Нож', rarity: 'rare', condition: 'battle_scarred', priceTon: '4.20', image: img('rare') },

  { slug: 'ak-neon-rider', name: 'AKR | Неоновый всадник', weapon: 'AKR', rarity: 'epic', condition: 'factory_new', priceTon: '6.50', image: img('epic') },
  { slug: 'm4-hyperbeast', name: 'M4 | Гиперзверь', weapon: 'M4', rarity: 'epic', condition: 'minimal_wear', priceTon: '8.90', image: img('epic') },
  { slug: 'awp-asiimov', name: 'AWM | Асимов', weapon: 'AWM', rarity: 'epic', condition: 'field_tested', priceTon: '12.40', image: img('epic') },
  { slug: 'desert-eagle-code', name: 'Desert Eagle | Код доступа', weapon: 'Desert Eagle', rarity: 'epic', condition: 'factory_new', priceTon: '15.80', image: img('epic') },
  { slug: 'butterfly-tiger', name: 'Бабочка | Тигр', weapon: 'Нож', rarity: 'epic', condition: 'minimal_wear', priceTon: '19.90', image: img('epic') },

  { slug: 'ak-legendary-dragon', name: 'AKR | Дракон', weapon: 'AKR', rarity: 'legendary', condition: 'factory_new', priceTon: '28.00', image: img('legendary') },
  { slug: 'm4-golden-eagle', name: 'M4 | Золотой орёл', weapon: 'M4', rarity: 'legendary', condition: 'minimal_wear', priceTon: '36.50', image: img('legendary') },
  { slug: 'awp-phantom', name: 'AWM | Фантом', weapon: 'AWM', rarity: 'legendary', condition: 'factory_new', priceTon: '48.00', image: img('legendary') },
  { slug: 'karambit-fade', name: 'Керамбит | Градиент', weapon: 'Нож', rarity: 'legendary', condition: 'factory_new', priceTon: '64.00', image: img('legendary') },
  { slug: 'bayonet-marble', name: 'Штык-нож | Мрамор', weapon: 'Нож', rarity: 'legendary', condition: 'minimal_wear', priceTon: '82.00', image: img('legendary') },

  { slug: 'ak-arcane-storm', name: 'AKR | Арканный шторм', weapon: 'AKR', rarity: 'arcane', condition: 'factory_new', priceTon: '110.00', image: img('arcane') },
  { slug: 'awp-void-walker', name: 'AWM | Странник пустоты', weapon: 'AWM', rarity: 'arcane', condition: 'factory_new', priceTon: '145.00', image: img('arcane') },
  { slug: 'karambit-doppler', name: 'Керамбит | Доплер', weapon: 'Нож', rarity: 'arcane', condition: 'factory_new', priceTon: '190.00', image: img('arcane') },
  { slug: 'butterfly-sapphire', name: 'Бабочка | Сапфир', weapon: 'Нож', rarity: 'arcane', condition: 'factory_new', priceTon: '260.00', image: img('arcane') },

  { slug: 'gloves-crimson-web', name: 'Перчатки | Багровая паутина', weapon: 'Перчатки', rarity: 'contraband', condition: 'factory_new', priceTon: '340.00', image: img('contraband') },
  { slug: 'karambit-ruby', name: 'Керамбит | Рубин', weapon: 'Нож', rarity: 'contraband', condition: 'factory_new', priceTon: '480.00', image: img('contraband') },
  { slug: 'awp-dragon-lore', name: 'AWM | Наследие дракона', weapon: 'AWM', rarity: 'contraband', condition: 'factory_new', priceTon: '720.00', image: img('contraband') },
];

/** Стартовые предметы, выдаваемые новому пользователю в тестовом режиме. */
export const STARTER_ITEM_SLUGS = ['ak-desert-sand', 'usp-carbon', 'mp5-forest'];
