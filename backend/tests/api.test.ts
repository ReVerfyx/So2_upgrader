/**
 * Интеграционные тесты API.
 * Запускаются, если задан DATABASE_URL (в CI поднимается сервис PostgreSQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { hasDatabase, TestClient, uniqueUsername } from './helpers';

const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('API Upgrader Standoff 2', () => {
  let app: Express;
  let pool: typeof import('../src/db/pool').pool;

  beforeAll(async () => {
    const { runMigrations } = await import('../src/db/migrate');
    const { seedItems } = await import('../src/db/seed');
    const poolModule = await import('../src/db/pool');
    const { createApp } = await import('../src/app');

    pool = poolModule.pool;
    await runMigrations();
    await seedItems();
    app = createApp();
  });

  afterAll(async () => {
    await pool.end();
  });

  /* ------------------------------ Служебное ------------------------------ */

  it('отвечает на проверку работоспособности', async () => {
    const client = new TestClient(app);
    const response = await client.get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('ok');
  });

  it('отдаёт публичный каталог предметов без авторизации', async () => {
    const client = new TestClient(app);
    const response = await client.get('/api/items?limit=5');
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toHaveProperty('rarity');
    expect(response.body.items[0].price).toHaveProperty('formatted');
  });

  /* ------------------------------ Авторизация ---------------------------- */

  it('регистрирует пользователя и выдаёт сессию в httpOnly cookie', async () => {
    const client = new TestClient(app);
    const username = uniqueUsername('reg');
    const response = await client.post('/api/auth/register', { username, password: 'supersecret123' });

    expect(response.status).toBe(201);
    expect(response.body.user.username).toBe(username);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((cookie) => cookie.startsWith('so2_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
  });

  it('не пускает с неверным паролем', async () => {
    const client = new TestClient(app);
    const username = uniqueUsername('login');
    await client.post('/api/auth/register', { username, password: 'supersecret123' });

    const fresh = new TestClient(app);
    const response = await fresh.post('/api/auth/login', { username, password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('требует авторизацию для приватных данных', async () => {
    const client = new TestClient(app);
    const response = await client.get('/api/inventory');
    expect(response.status).toBe(401);
  });

  it('отклоняет изменяющий запрос без CSRF-токена', async () => {
    const client = new TestClient(app);
    await client.post('/api/auth/register', { username: uniqueUsername('csrf'), password: 'supersecret123' });
    const response = await client.postWithoutCsrf('/api/dev/balance', { amount: '10' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  /* -------------------------------- Апгрейд ------------------------------ */

  describe('Апгрейд', () => {
    let client: TestClient;
    let inventoryId: string;
    let targetItemId: string;
    let expectedChancePpm: number;

    beforeAll(async () => {
      client = new TestClient(app);
      await client.post('/api/auth/register', { username: uniqueUsername('upg'), password: 'supersecret123' });
      await client.post('/api/dev/balance', { amount: '5000' });
      await client.post('/api/dev/starter-pack');

      const inventory = await client.get('/api/inventory?sort=price_desc&limit=1');
      inventoryId = inventory.body.items[0].id;

      const targets = await client.get(`/api/upgrade/targets?sourceInventoryId=${inventoryId}&limit=3`);
      targetItemId = targets.body.items[1].id;

      const preview = await client.post('/api/upgrade/preview', {
        sourceType: 'item',
        sourceInventoryId: inventoryId,
        targetItemId,
      });
      expectedChancePpm = preview.body.quote.chancePpm;
    });

    it('предпросмотр показывает шанс, коэффициент и потенциальный выигрыш', async () => {
      const response = await client.post('/api/upgrade/preview', {
        sourceType: 'item',
        sourceInventoryId: inventoryId,
        targetItemId,
      });
      expect(response.status).toBe(200);
      const quote = response.body.quote;
      expect(quote.chancePpm).toBeGreaterThan(0);
      expect(quote.chancePpm).toBeLessThan(1_000_000);
      expect(quote.multiplier).toBeGreaterThan(1);
      expect(quote.potentialWin.minor).toBe(quote.target.priceMinor);
    });

    it('отклоняет игру, если показанный шанс не совпал с серверным', async () => {
      const response = await client.post('/api/upgrade', {
        sourceType: 'item',
        sourceInventoryId: inventoryId,
        targetItemId,
        expectedChancePpm: 999_000,
      });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHANCE_MISMATCH');
    });

    it('выполняет апгрейд и возвращает готовый результат для анимации', async () => {
      const response = await client.post(
        '/api/upgrade',
        { sourceType: 'item', sourceInventoryId: inventoryId, targetItemId, expectedChancePpm },
        { 'Idempotency-Key': `upgrade-${Date.now()}` },
      );

      expect(response.status).toBe(200);
      const result = response.body.result;
      expect(result.chancePpm).toBe(expectedChancePpm);
      expect(result.rollPpm).toBeGreaterThanOrEqual(0);
      expect(result.rollPpm).toBeLessThan(1_000_000);
      // Результат обязан соответствовать броску: клиент не может его изменить.
      expect(result.success).toBe(result.rollPpm < result.chancePpm);
      expect(result.fairness.serverSeedHash).toHaveLength(64);
      // Серверное семя не раскрывается до ротации.
      expect(result.fairness.serverSeed).toBeNull();
    });

    it('не позволяет использовать один предмет дважды', async () => {
      const response = await client.post('/api/upgrade', {
        sourceType: 'item',
        sourceInventoryId: inventoryId,
        targetItemId,
      });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ITEM_NOT_AVAILABLE');
    });

    it('не позволяет апгрейдить чужой предмет', async () => {
      const stranger = new TestClient(app);
      await stranger.post('/api/auth/register', { username: uniqueUsername('str'), password: 'supersecret123' });
      await stranger.post('/api/dev/starter-pack');
      const strangerInventory = await stranger.get('/api/inventory?limit=1');
      const strangerItemId = strangerInventory.body.items[0].id;

      const response = await client.post('/api/upgrade', {
        sourceType: 'item',
        sourceInventoryId: strangerItemId,
        targetItemId,
      });
      expect([403, 404]).toContain(response.status);
    });

    it('повторный запрос с тем же Idempotency-Key не создаёт вторую игру', async () => {
      const key = `idem-${Date.now()}`;
      const body = { sourceType: 'balance', stake: '100', targetItemId };

      const first = await client.post('/api/upgrade', body, { 'Idempotency-Key': key });
      const second = await client.post('/api/upgrade', body, { 'Idempotency-Key': key });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.result.id).toBe(first.body.result.id);
    });

    it('не позволяет играть на сумму больше баланса', async () => {
      const response = await client.post('/api/upgrade', {
        sourceType: 'balance',
        stake: '10000000',
        targetItemId,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('позволяет проверить игру после ротации серверного семени', async () => {
      const history = await client.get('/api/upgrades?limit=1');
      const upgradeId = history.body.items[0].id;

      const before = await client.get(`/api/upgrades/${upgradeId}/verify`);
      expect(before.body.verifiable).toBe(false);

      await client.post('/api/user/fairness/rotate', { clientSeed: 'test-seed' });

      const after = await client.get(`/api/upgrades/${upgradeId}/verify`);
      expect(after.body.verifiable).toBe(true);
      expect(after.body.verification.valid).toBe(true);
      expect(after.body.verification.hashValid).toBe(true);
      expect(after.body.verification.rollValid).toBe(true);
    });
  });

  /* ------------------------------ Пополнение ----------------------------- */

  describe('Пополнение через TON', () => {
    let client: TestClient;

    beforeAll(async () => {
      client = new TestClient(app);
      await client.post('/api/auth/register', { username: uniqueUsername('dep'), password: 'supersecret123' });
    });

    it('отклоняет сумму ниже минимальной', async () => {
      const response = await client.post('/api/deposit', { amount: '0.5' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('DEPOSIT_AMOUNT_TOO_SMALL');
    });

    it('создаёт счёт с QR-кодом и уникальным идентификатором платежа', async () => {
      const response = await client.post('/api/deposit', { amount: '5' });
      expect(response.status).toBe(201);
      const deposit = response.body.deposit;
      expect(deposit.paymentId).toMatch(/^SO2-[A-F0-9]{10}$/);
      expect(deposit.status).toBe('pending');
      expect(deposit.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(deposit.paymentUrl).toContain('ton://transfer/');
      expect(deposit.secondsLeft).toBeGreaterThan(0);
    });

    it('НЕ зачисляет баланс по данным из браузера', async () => {
      const before = await client.get('/api/balance');
      // Пытаемся «просто попросить» деньги — счёт создан, но баланс не изменился.
      await client.post('/api/deposit', { amount: '1000' });
      const after = await client.get('/api/balance');
      expect(after.body.balance.minor).toBe(before.body.balance.minor);
    });

    it('зачисляет баланс только после реальной транзакции в блокчейне', async () => {
      const created = await client.post('/api/deposit', { amount: '3' });
      const deposit = created.body.deposit;
      const paymentId = deposit.paymentId;

      const before = await client.get('/api/balance');
      await client.post('/api/dev/ton/simulate-payment', { paymentId });
      const after = await client.get('/api/balance');

      // 3 TON конвертируются в монеты по курсу, зафиксированному в счёте
      const credited = BigInt(after.body.balance.minor) - BigInt(before.body.balance.minor);
      expect(credited).toBe(BigInt(deposit.expectedCoins.minor));
      expect(credited).toBeGreaterThan(0n);

      const updated = await client.get(`/api/deposit/${deposit.id}`);
      expect(updated.body.deposit.status).toBe('confirmed');
      expect(updated.body.deposit.txHash).toBeTruthy();
      expect(updated.body.deposit.credited.minor).toBe(credited.toString());
    });

    it('не зачисляет недоплату', async () => {
      const created = await client.post('/api/deposit', { amount: '10' });
      const paymentId = created.body.deposit.paymentId;

      const before = await client.get('/api/balance');
      await client.post('/api/dev/ton/simulate-payment', { paymentId, amountTon: '2' });
      const after = await client.get('/api/balance');

      expect(after.body.balance.minor).toBe(before.body.balance.minor);
    });

    it('не зачисляет одну транзакцию дважды', async () => {
      const created = await client.post('/api/deposit', { amount: '4' });
      const paymentId = created.body.deposit.paymentId;

      await client.post('/api/dev/ton/simulate-payment', { paymentId });
      const afterFirst = await client.get('/api/balance');

      // Повторный прогон воркера по тем же транзакциям.
      await client.post('/api/dev/ton/simulate-payment', { paymentId, amountTon: '4' });
      const afterSecond = await client.get('/api/balance');

      // Вторая транзакция относится к уже оплаченному счёту и зачислена не будет.
      expect(afterSecond.body.balance.minor).toBe(afterFirst.body.balance.minor);
    });
  });

  /* -------------------------------- Вывод -------------------------------- */

  describe('Вывод предметов', () => {
    let client: TestClient;
    let inventoryId: string;

    beforeAll(async () => {
      client = new TestClient(app);
      await client.post('/api/auth/register', { username: uniqueUsername('wd'), password: 'supersecret123' });
      await client.post('/api/dev/starter-pack');
      const inventory = await client.get('/api/inventory?limit=1');
      inventoryId = inventory.body.items[0].id;
    });

    it('создаёт заявку со статусом «в очереди» и честной формулировкой', async () => {
      const response = await client.post('/api/withdraw', {
        inventoryId,
        gameNickname: 'TestPlayer',
        contact: '@test',
      });
      expect(response.status).toBe(201);
      expect(response.body.withdrawal.status).toBe('pending');
      expect(response.body.withdrawal.statusLabel).toContain('очереди');
      expect(response.body.notice).toContain('вручную');
    });

    it('блокирует предмет: повторная заявка невозможна', async () => {
      const response = await client.post('/api/withdraw', { inventoryId, gameNickname: 'TestPlayer' });
      expect(response.status).toBe(409);
    });

    it('позволяет отменить заявку и возвращает предмет', async () => {
      const list = await client.get('/api/withdrawals?limit=1');
      const withdrawalId = list.body.items[0].id;

      const cancelled = await client.post(`/api/withdrawals/${withdrawalId}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.withdrawal.status).toBe('rejected');

      const item = await client.get(`/api/inventory/${inventoryId}`);
      expect(item.body.item.status).toBe('available');
    });
  });

  /* ------------------------------ Админка -------------------------------- */

  describe('Админ-панель', () => {
    let admin: TestClient;
    let userClient: TestClient;
    let userId: string;

    beforeAll(async () => {
      const { seedAdmin } = await import('../src/db/seed');
      process.env.ADMIN_USERNAME = 'testadmin';
      process.env.ADMIN_PASSWORD = 'adminpassword123';
      await seedAdmin();

      admin = new TestClient(app);
      await admin.post('/api/auth/login', { username: 'testadmin', password: 'adminpassword123' });

      userClient = new TestClient(app);
      const registered = await userClient.post('/api/auth/register', {
        username: uniqueUsername('adm'),
        password: 'supersecret123',
      });
      userId = registered.body.user.id;
    });

    it('закрывает админ-API от обычных пользователей', async () => {
      const response = await userClient.get('/api/admin/users');
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ADMIN_REQUIRED');
    });

    it('показывает сводную статистику', async () => {
      const response = await admin.get('/api/admin/stats');
      expect(response.status).toBe(200);
      expect(response.body.stats.users.total).toBeGreaterThan(0);
    });

    it('корректирует баланс вручную и пишет запись в журнал', async () => {
      const response = await admin.post(`/api/admin/users/${userId}/balance`, {
        amount: '750.50',
        direction: 'credit',
        reason: 'Компенсация за сбой',
      });
      expect(response.status).toBe(200);
      expect(response.body.balance.minor).toBe('75050');

      const logs = await admin.get('/api/admin/logs?limit=5');
      const entry = (logs.body.items as Array<{ action: string }>).find((log) => log.action === 'balance.adjust');
      expect(entry).toBeDefined();
    });

    it('блокирует пользователя и завершает его сессии', async () => {
      const blocked = await admin.post(`/api/admin/users/${userId}/block`, {
        blocked: true,
        reason: 'Нарушение правил',
      });
      expect(blocked.status).toBe(200);
      expect(blocked.body.user.isBlocked).toBe(true);

      // Сессия пользователя отозвана — доступ закрыт.
      const attempt = await userClient.get('/api/user');
      expect(attempt.status).toBe(401);

      await admin.post(`/api/admin/users/${userId}/block`, { blocked: false });
    });

    it('обрабатывает заявку на вывод по всему циклу статусов', async () => {
      const player = new TestClient(app);
      await player.post('/api/auth/register', { username: uniqueUsername('flow'), password: 'supersecret123' });
      await player.post('/api/dev/starter-pack');
      const inventory = await player.get('/api/inventory?limit=1');
      const created = await player.post('/api/withdraw', {
        inventoryId: inventory.body.items[0].id,
        gameNickname: 'FlowPlayer',
      });
      const withdrawalId = created.body.withdrawal.id;

      const taken = await admin.post(`/api/admin/withdrawals/${withdrawalId}/take`);
      expect(taken.body.withdrawal.status).toBe('processing');

      const completed = await admin.post(`/api/admin/withdrawals/${withdrawalId}/process`, {
        txHash: 'trade-123',
        comment: 'Выдано',
      });
      expect(completed.body.withdrawal.status).toBe('completed');
      expect(completed.body.withdrawal.txHash).toBe('trade-123');
    });

    it('позволяет менять коэффициенты апгрейда', async () => {
      const response = await admin.put('/api/admin/settings/upgrade', {
        houseEdge: 0.1,
        minChance: 0.01,
        maxChance: 0.8,
        maxMultiplier: 50,
        minStake: '20',
      });
      expect(response.status).toBe(200);

      const settings = await admin.get('/api/upgrades/settings');
      expect(settings.body.houseEdgePercent).toBe(10);

      // Возвращаем значения по умолчанию, чтобы не влиять на другие тесты.
      await admin.put('/api/admin/settings/upgrade', {
        houseEdge: 0.08,
        minChance: 0.005,
        maxChance: 0.85,
        maxMultiplier: 100,
        minStake: '10',
      });
    });
  });
});
