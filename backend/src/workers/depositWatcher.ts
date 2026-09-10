/**
 * Фоновый воркер проверки пополнений.
 *
 * Раз в TON_POLL_INTERVAL_MS опрашивает блокчейн, находит входящие переводы
 * на кошелёк площадки и зачисляет те, что соответствуют неоплаченным счетам.
 * Работает независимо от браузера пользователя — данные из клиента
 * в подтверждении не участвуют вообще.
 */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { getTonProvider } from '../ton';
import {
  creditTransaction,
  expireStaleDeposits,
  hasPendingDeposits,
  refreshPendingHorizon,
} from '../services/depositService';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastCheckedUtime = 0;

export interface WatcherStats {
  checked: number;
  credited: number;
  expired: number;
  errors: number;
}

/** Один цикл проверки. Вынесен отдельно, чтобы вызывать из тестов и админки. */
export async function runWatcherCycle(options: { force?: boolean } = {}): Promise<WatcherStats> {
  const stats: WatcherStats = { checked: 0, credited: 0, expired: 0, errors: 0 };

  // Пока нет неоплаченных счетов, ходить в базу и в блокчейн незачем.
  // Это экономит время работы serverless-базы, которое тарифицируется
  // (Neon, Supabase и подобные засыпают при простое).
  if (!options.force && !hasPendingDeposits()) {
    logger.debug('Активных счетов нет, цикл проверки пропущен');
    return stats;
  }

  try {
    stats.expired = await expireStaleDeposits();
  } catch (error) {
    stats.errors += 1;
    logger.error('Не удалось отметить истёкшие счета', { error: (error as Error).message });
  }

  if (!env.ton.walletAddress) {
    logger.debug('TON_WALLET_ADDRESS не задан — проверка блокчейна пропущена');
    return stats;
  }

  const provider = getTonProvider();
  if (!provider.isConfigured()) {
    logger.warn('Провайдер TON не настроен — проверка пополнений пропущена');
    return stats;
  }

  try {
    const transactions = await provider.getIncomingTransactions({
      address: env.ton.walletAddress,
      limit: 50,
      // Небольшой запас назад, чтобы не потерять транзакции на границе окна.
      sinceUtime: lastCheckedUtime > 0 ? lastCheckedUtime - 600 : undefined,
    });

    stats.checked = transactions.length;

    for (const tx of transactions) {
      try {
        const confirmations = await provider.getConfirmations(tx);
        const result = await creditTransaction(tx, confirmations);
        if (result.credited) stats.credited += 1;
      } catch (error) {
        stats.errors += 1;
        logger.error('Ошибка обработки транзакции TON', {
          hash: tx.hash,
          error: (error as Error).message,
        });
      }
      if (tx.utime > lastCheckedUtime) lastCheckedUtime = tx.utime;
    }
  } catch (error) {
    stats.errors += 1;
    logger.error('Не удалось получить транзакции из блокчейна', { error: (error as Error).message });
  }

  if (stats.credited > 0 || stats.expired > 0) {
    logger.info('Цикл проверки пополнений завершён', { ...stats });
  }

  return stats;
}

export function startDepositWatcher(): void {
  if (timer) return;
  if (!env.ton.watcherEnabled) {
    logger.info('Воркер проверки пополнений отключён (TON_WATCHER_ENABLED=false)');
    return;
  }

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runWatcherCycle();
    } finally {
      running = false;
    }
  };

  // Интервал опроса подстраивается под наличие счетов: часто — когда есть
  // что ждать, редко — когда нет. Так база не будится впустую.
  const scheduleNext = (): void => {
    const interval = hasPendingDeposits() ? env.ton.pollIntervalMs : env.ton.idlePollIntervalMs;
    timer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, interval);
    timer.unref?.();
  };

  logger.info('Воркер проверки пополнений запущен', {
    интервалАктивный: env.ton.pollIntervalMs,
    интервалПростоя: env.ton.idlePollIntervalMs,
  });

  // При старте выясняем, остались ли неоплаченные счета с прошлого запуска.
  void refreshPendingHorizon()
    .catch((error: Error) => logger.warn('Не удалось прочитать активные счета', { error: error.message }))
    .then(() => tick())
    .finally(scheduleNext);
}

export function stopDepositWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
