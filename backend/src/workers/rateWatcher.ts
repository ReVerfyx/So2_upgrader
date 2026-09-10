/**
 * Фоновое обновление курса TON → монеты.
 *
 * Курс нужен для пересчёта пополнений, поэтому он обновляется независимо
 * от активности пользователей. При недоступности источников продолжает
 * действовать последний известный курс (см. rateService.getUsableRate).
 */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { refreshRate } from '../services/rateService';

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startRateWatcher(): void {
  if (timer) return;
  if (!env.rates.auto) {
    logger.info('Автообновление курса отключено (RATE_AUTO_UPDATE=false)');
    return;
  }

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await refreshRate();
      if (!result.updated && result.failures.length > 0) {
        logger.warn('Курс не обновлён, используется предыдущее значение', {
          источники: result.failures.map((failure) => `${failure.provider}: ${failure.message}`),
        });
      }
    } catch (error) {
      logger.error('Ошибка обновления курса', { error: (error as Error).message });
    } finally {
      running = false;
    }
  };

  const intervalMs = Math.max(1, env.rates.refreshMinutes) * 60_000;
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  logger.info('Автообновление курса запущено', { интервалМинут: env.rates.refreshMinutes });

  void tick();
}

export function stopRateWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
