/**
 * Абстракция источника курса TON → рубль.
 *
 * Курс нужен, чтобы пересчитать реальное пополнение в TON во внутренние
 * монеты (1 монета = 1 ₽). Источники подключаются независимо друг от друга
 * и опрашиваются по очереди — если первый недоступен, берётся следующий.
 */

export interface RateQuote {
  /** Сколько рублей стоит 1 TON. */
  rubPerTon: number;
  /** Имя источника, попавшее в журнал и в админ-панель. */
  source: string;
  /** Время получения курса. */
  fetchedAt: Date;
}

export interface RateProvider {
  readonly name: string;
  /** Настроен ли источник (например, задан ли ключ API). */
  isConfigured(): boolean;
  /** Получить курс. Бросает ошибку, если источник недоступен. */
  fetchRate(signal?: AbortSignal): Promise<RateQuote>;
}

/** Проверка правдоподобности курса: защита от «мусорных» значений. */
export function assertSaneRate(rubPerTon: number, source: string): number {
  if (!Number.isFinite(rubPerTon) || rubPerTon <= 0) {
    throw new Error(`Источник ${source} вернул некорректный курс: ${rubPerTon}`);
  }
  // Разумный коридор: от 1 ₽ до 100 000 ₽ за TON.
  // Выход за границы означает ошибку источника или подмену ответа.
  if (rubPerTon < 1 || rubPerTon > 100_000) {
    throw new Error(`Источник ${source} вернул курс вне допустимого диапазона: ${rubPerTon} ₽ за TON`);
  }
  return rubPerTon;
}
