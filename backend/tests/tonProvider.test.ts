/**
 * Тесты разбора ответов блокчейн-провайдеров.
 *
 * Сетевые вызовы подменяются фикстурами, повторяющими реальный формат
 * ответов toncenter (v2 и v3) и tonapi.io. Так проверяется именно логика
 * распознавания платежей: сумма, комментарий, отправитель, отбраковка
 * неподходящих транзакций.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TonCenterProvider, decodeTextCell, normalizeComment } from '../src/ton/tonCenterProvider';
import { TonApiProvider, parseBlockSeqno } from '../src/ton/tonApiProvider';
import { isSameAddress, isValidTonAddress, toComparableAddress } from '../src/ton/address';

const WALLET = 'UQD9v6hVJAoLWmkMxWruNmwp6Sc6l9cg8EYz3KEW0g_CA90Y';

/** Тело текстового комментария так, как его отдаёт блокчейн: опкод 0x00000000 + UTF-8. */
function textCell(comment: string): string {
  const prefix = Buffer.from([0xb5, 0xee, 0x9c, 0x72, 0x41, 0x01, 0x01, 0x01, 0x00, 0x18, 0x00, 0x00, 0x2c]);
  return Buffer.concat([prefix, Buffer.from([0, 0, 0, 0]), Buffer.from(comment, 'utf8')]).toString('base64');
}

function mockFetch(payload: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      headers: new Map(),
      json: async () => payload,
    })) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Разбор комментария платежа', () => {
  it('извлекает текст из ячейки с опкодом 0x00000000', () => {
    expect(decodeTextCell(textCell('SO2-A1B2C3D4E5'))).toBe('SO2-A1B2C3D4E5');
  });

  it('чистит управляющие символы', () => {
    expect(normalizeComment('  SO2-TEST \n')).toBe('SO2-TEST');
    expect(normalizeComment('   ')).toBeNull();
  });

  it('возвращает null на мусоре', () => {
    expect(decodeTextCell('не-base64!!!')).toBeNull();
  });
});

describe('toncenter API v3', () => {
  it('распознаёт входящий платёж с комментарием', async () => {
    mockFetch({
      transactions: [
        {
          hash: 'aG9tZXdvcmsx',
          lt: '48123456000001',
          now: 1_760_000_000,
          mc_block_seqno: 41_234_567,
          description: { aborted: false, compute_ph: { success: true } },
          in_msg: {
            source: 'UQBsender_address_example_aaaaaaaaaaaaaaaaaaaaaa',
            destination: WALLET,
            value: '2500000000',
            bounced: false,
            message_content: { decoded: { type: 'text_comment', comment: 'SO2-A1B2C3D4E5' } },
          },
        },
      ],
    });

    const provider = new TonCenterProvider('https://toncenter.com', '');
    const transactions = await provider.getIncomingTransactions({ address: WALLET, limit: 50 });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      hash: 'aG9tZXdvcmsx',
      amountNano: 2_500_000_000n,
      comment: 'SO2-A1B2C3D4E5',
      destination: WALLET,
      blockSeqno: 41_234_567,
    });
  });

  it('читает комментарий из тела сообщения, если нет разобранного поля', async () => {
    mockFetch({
      transactions: [
        {
          hash: 'h2',
          lt: '2',
          now: 1_760_000_100,
          in_msg: {
            source: 'UQBsender',
            destination: WALLET,
            value: '880000000',
            message_content: { body: textCell('SO2-FFFFFFFFFF') },
          },
        },
      ],
    });

    const provider = new TonCenterProvider('https://toncenter.com', '');
    const [tx] = await provider.getIncomingTransactions({ address: WALLET, limit: 10 });
    expect(tx?.comment).toBe('SO2-FFFFFFFFFF');
    expect(tx?.amountNano).toBe(880_000_000n);
  });

  it('отбрасывает отклонённые, нулевые и неуспешные транзакции', async () => {
    mockFetch({
      transactions: [
        { hash: 'a', lt: '1', now: 1, in_msg: { value: '0', destination: WALLET } },
        { hash: 'b', lt: '2', now: 2, in_msg: { value: '1000', destination: WALLET, bounced: true } },
        {
          hash: 'c',
          lt: '3',
          now: 3,
          description: { aborted: true },
          in_msg: { value: '1000', destination: WALLET },
        },
        { hash: 'd', lt: '4', now: 4, in_msg: null },
      ],
    });

    const provider = new TonCenterProvider('https://toncenter.com', '');
    const transactions = await provider.getIncomingTransactions({ address: WALLET, limit: 10 });
    expect(transactions).toHaveLength(0);
  });

  it('переключается на v2, если v3 недоступен', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('/api/v3/')) return { ok: false, status: 503, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: [
              {
                transaction_id: { hash: 'v2hash', lt: '99' },
                utime: 1_760_000_500,
                in_msg: {
                  source: 'UQBsender',
                  destination: WALLET,
                  value: '1000000000',
                  message: 'SO2-1234567890',
                },
              },
            ],
          }),
        };
      }) as unknown as typeof fetch,
    );

    const provider = new TonCenterProvider('https://toncenter.com', '');
    const transactions = await provider.getIncomingTransactions({ address: WALLET, limit: 10 });

    expect(calls.some((url) => url.includes('/api/v3/'))).toBe(true);
    expect(calls.some((url) => url.includes('/api/v2/'))).toBe(true);
    expect(transactions[0]).toMatchObject({ hash: 'v2hash', comment: 'SO2-1234567890', amountNano: 1_000_000_000n });
  });
});

describe('tonapi.io', () => {
  it('распознаёт входящий платёж', async () => {
    mockFetch({
      transactions: [
        {
          hash: 'tonapi-hash',
          lt: 48_123_456_000_001,
          utime: 1_760_000_900,
          success: true,
          aborted: false,
          block: '(0,8000000000000000,41234567)',
          in_msg: {
            source: { address: '0:aaaa' },
            destination: { address: '0:bbbb' },
            value: 3_000_000_000,
            decoded_body: { text: 'SO2-ABCDEF1234' },
          },
        },
      ],
    });

    const provider = new TonApiProvider('https://tonapi.io', '');
    const [tx] = await provider.getIncomingTransactions({ address: WALLET, limit: 10 });

    expect(tx).toMatchObject({
      hash: 'tonapi-hash',
      amountNano: 3_000_000_000n,
      comment: 'SO2-ABCDEF1234',
      blockSeqno: 41_234_567,
    });
  });

  it('разбирает номер блока', () => {
    expect(parseBlockSeqno('(-1,8000000000000000,48123456)')).toBe(48_123_456);
    expect(parseBlockSeqno(undefined)).toBeNull();
  });
});

describe('Адреса TON', () => {
  it('принимает корректные адреса', () => {
    expect(isValidTonAddress(WALLET)).toBe(true);
    expect(isValidTonAddress('EQD9v6hVJAoLWmkMxWruNmwp6Sc6l9cg8EYz3KEW0g_CA90Y')).toBe(true);
    expect(isValidTonAddress('0:' + 'a'.repeat(64))).toBe(true);
  });

  it('отклоняет некорректные', () => {
    expect(isValidTonAddress('не адрес')).toBe(false);
    expect(isValidTonAddress('')).toBe(false);
    expect(isValidTonAddress('EQtest_wallet_address_for_local_development')).toBe(false);
  });

  it('считает UQ- и EQ-формы одним адресом', () => {
    const uq = WALLET;
    const eq = 'EQD9v6hVJAoLWmkMxWruNmwp6Sc6l9cg8EYz3KEW0g_CA90Y';
    expect(toComparableAddress(uq)).toBe(toComparableAddress(eq));
    expect(isSameAddress(uq, eq)).toBe(true);
  });

  it('различает разные кошельки', () => {
    expect(isSameAddress(WALLET, 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });
});
