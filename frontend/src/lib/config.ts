/** Публичные настройки бренда. Значения задаются переменными окружения Vite. */

/** Название площадки. */
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || 'STOCK2';

/** Подпись под логотипом. */
export const BRAND_TAGLINE = import.meta.env.VITE_BRAND_TAGLINE || 'UPGRADER STANDOFF 2';

/** Telegram-канал поддержки и связи с модератором. */
export const TELEGRAM_URL = import.meta.env.VITE_TELEGRAM_URL || 'https://t.me/stock2_shop';

/** Отображаемое имя канала (без ссылки). */
export const TELEGRAM_HANDLE = TELEGRAM_URL.replace(/^https?:\/\/t\.me\//, '@');
