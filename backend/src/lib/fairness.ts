/**
 * Provably fair — проверяемая генерация результата апгрейда.
 *
 * Принцип работы:
 *  1. Для каждого пользователя сервер хранит секретное серверное семя (server_seed)
 *     и публикует его SHA-256 хеш (server_seed_hash) ДО игры.
 *  2. Пользователь может задать своё клиентское семя (client_seed).
 *  3. Каждый апгрейд использует счётчик nonce, который увеличивается на 1.
 *  4. Результат = HMAC-SHA256(server_seed, `${client_seed}:${nonce}`) → число 0..999999.
 *  5. После игры сервер раскрывает server_seed вместе с результатом,
 *     и любой желающий может пересчитать бросок и убедиться в честности.
 *
 * Источник случайности — crypto.randomBytes (CSPRNG операционной системы).
 * Клиент физически не может повлиять на результат: он не знает server_seed
 * в момент игры, а nonce и шанс фиксирует сервер.
 */
import crypto from 'node:crypto';

/** Дискретность вероятности — миллионные доли (1_000_000 = 100%). */
export const PPM = 1_000_000;

/** Генерирует новое криптостойкое серверное семя. */
export function generateServerSeed(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Генерирует клиентское семя по умолчанию. */
export function generateClientSeed(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** SHA-256 хеш серверного семени — публикуется до игры. */
export function hashServerSeed(serverSeed: string): string {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Детерминированный бросок в диапазоне [0, 1_000_000).
 * Используется отбраковка (rejection sampling), чтобы полностью исключить
 * смещение, возникающее при взятии остатка от деления.
 */
export function rollPpm(serverSeed: string, clientSeed: string, nonce: number | bigint): number {
  const limit = 2n ** 64n;
  const bucket = limit - (limit % BigInt(PPM)); // граница отбраковки
  for (let round = 0; round < 100; round += 1) {
    const message = `${clientSeed}:${nonce}:${round}`;
    const digest = crypto.createHmac('sha256', serverSeed).update(message).digest('hex');
    const value = BigInt(`0x${digest.slice(0, 16)}`);
    if (value < bucket) {
      return Number(value % BigInt(PPM));
    }
  }
  /* c8 ignore next 2 -- вероятность попасть сюда меньше 2^-100 */
  throw new Error('Не удалось получить несмещённый бросок');
}

/**
 * Проверяет результат апгрейда по раскрытым данным.
 * Эта же функция используется в публичном эндпоинте проверки.
 */
export function verifyRoll(params: {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number | bigint;
  chancePpm: number;
  rollPpm: number;
  success: boolean;
}): { hashValid: boolean; rollValid: boolean; outcomeValid: boolean; valid: boolean; expectedRollPpm: number } {
  const hashValid = hashServerSeed(params.serverSeed) === params.serverSeedHash;
  const expectedRollPpm = rollPpm(params.serverSeed, params.clientSeed, params.nonce);
  const rollValid = expectedRollPpm === params.rollPpm;
  const outcomeValid = (params.rollPpm < params.chancePpm) === params.success;
  return {
    hashValid,
    rollValid,
    outcomeValid,
    valid: hashValid && rollValid && outcomeValid,
    expectedRollPpm,
  };
}

/** Успех наступает, если бросок меньше объявленного шанса. */
export function isSuccess(roll: number, chancePpm: number): boolean {
  return roll < chancePpm;
}
