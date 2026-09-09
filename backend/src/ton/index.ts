/** Фабрика провайдера TON: выбирается переменной окружения TON_PROVIDER. */
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { MockTonProvider } from './mockProvider';
import { TonCenterProvider } from './tonCenterProvider';
import type { TonProvider } from './TonProvider';

let provider: TonProvider | null = null;

export function getTonProvider(): TonProvider {
  if (provider) return provider;

  if (env.ton.provider === 'mock') {
    if (env.isProduction) {
      throw new Error('Провайдер TON «mock» недопустим в production');
    }
    logger.warn('Используется тестовый провайдер TON (реальные платежи не проверяются)');
    provider = new MockTonProvider();
  } else {
    provider = new TonCenterProvider();
  }

  return provider;
}

/** Доступ к mock-провайдеру для dev-эндпоинтов и тестов. */
export function getMockProvider(): MockTonProvider | null {
  const current = getTonProvider();
  return current instanceof MockTonProvider ? current : null;
}

/** Сброс синглтона (используется в тестах). */
export function resetTonProvider(): void {
  provider = null;
}

export type { TonProvider } from './TonProvider';
