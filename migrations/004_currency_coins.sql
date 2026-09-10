-- ============================================================================
-- Миграция 004 — переход на внутреннюю валюту «монеты»
--
-- 1 монета = 1 рубль. Все суммы хранятся в КОПЕЙКАХ (BIGINT):
--     1 монета = 100 копеек.
-- Это исключает ошибки округления и позволяет показывать привычные цены.
--
-- Пополнение по-прежнему приходит в TON: сумма перевода конвертируется
-- в монеты по курсу, который задаётся в настройках (app_settings.rates).
-- ============================================================================

-- --------------------------- Балансы ---------------------------------------
ALTER TABLE balances RENAME COLUMN amount_nano TO amount_minor;
ALTER TABLE balances RENAME COLUMN locked_nano TO locked_minor;
ALTER TABLE balances RENAME CONSTRAINT balances_amount_check TO balances_amount_minor_check;
ALTER TABLE balances RENAME CONSTRAINT balances_locked_check TO balances_locked_minor_check;
ALTER TABLE balances ALTER COLUMN currency SET DEFAULT 'COIN';

-- --------------------------- Предметы --------------------------------------
ALTER TABLE items RENAME COLUMN price_nano TO price_minor;
ALTER TABLE items RENAME CONSTRAINT items_price_check TO items_price_minor_check;
ALTER INDEX items_price_idx RENAME TO items_price_minor_idx;
ALTER INDEX items_active_price_idx RENAME TO items_active_price_minor_idx;

ALTER TABLE inventory RENAME COLUMN price_nano TO price_minor;
ALTER TABLE inventory RENAME CONSTRAINT inventory_price_check TO inventory_price_minor_check;

-- --------------------------- Апгрейды --------------------------------------
ALTER TABLE upgrades RENAME COLUMN source_price_nano TO source_price_minor;
ALTER TABLE upgrades RENAME COLUMN target_price_nano TO target_price_minor;

-- --------------------------- Операции --------------------------------------
ALTER TABLE transactions RENAME COLUMN amount_nano TO amount_minor;
ALTER TABLE transactions RENAME COLUMN balance_before_nano TO balance_before_minor;
ALTER TABLE transactions RENAME COLUMN balance_after_nano TO balance_after_minor;
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'COIN';

ALTER TABLE withdrawals RENAME COLUMN price_nano TO price_minor;

-- --------------------------- Пополнения ------------------------------------
-- amount_nano / received_nano остаются в нанотонах (это реальный перевод),
-- дополнительно фиксируем зачисленную сумму в монетах и применённый курс.
ALTER TABLE deposits ADD COLUMN credited_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE deposits ADD COLUMN rate_minor_per_ton BIGINT;

COMMENT ON COLUMN deposits.amount_nano IS 'Ожидаемая сумма перевода в нанотонах (1 TON = 1e9)';
COMMENT ON COLUMN deposits.received_nano IS 'Фактически полученная сумма в нанотонах';
COMMENT ON COLUMN deposits.credited_minor IS 'Зачислено на баланс в копейках (1 монета = 100 копеек)';
COMMENT ON COLUMN deposits.rate_minor_per_ton IS 'Курс на момент зачисления: копеек за 1 TON';

-- --------------------------- Пересчёт данных -------------------------------
-- Демонстрационные значения, созданные до перехода на монеты, приводим
-- к новой валюте по курсу 1 TON = 350 монет (35 000 копеек).
DO $$
DECLARE
    -- Курс пересчёта демонстрационных данных: 1 TON = 350 монет
    v_rate     CONSTANT NUMERIC := 35000;
    v_nano_ton CONSTANT NUMERIC := 1000000000;
BEGIN
    UPDATE items       SET price_minor = GREATEST(1, ROUND(price_minor::numeric / v_nano_ton * v_rate));
    UPDATE inventory   SET price_minor = ROUND(price_minor::numeric / v_nano_ton * v_rate);
    UPDATE balances    SET amount_minor = ROUND(amount_minor::numeric / v_nano_ton * v_rate),
                           locked_minor = ROUND(locked_minor::numeric / v_nano_ton * v_rate),
                           currency = 'COIN';
    UPDATE upgrades    SET source_price_minor = ROUND(source_price_minor::numeric / v_nano_ton * v_rate),
                           target_price_minor = ROUND(target_price_minor::numeric / v_nano_ton * v_rate);
    UPDATE withdrawals SET price_minor = ROUND(price_minor::numeric / v_nano_ton * v_rate);
    UPDATE transactions SET amount_minor        = ROUND(amount_minor::numeric / v_nano_ton * v_rate),
                            balance_before_minor = ROUND(balance_before_minor::numeric / v_nano_ton * v_rate),
                            balance_after_minor  = ROUND(balance_after_minor::numeric / v_nano_ton * v_rate),
                            currency = 'COIN';
    UPDATE deposits    SET credited_minor = ROUND(received_nano::numeric / v_nano_ton * v_rate)
                     WHERE status = 'confirmed';
END $$;

-- --------------------------- Настройки -------------------------------------
-- Курс обмена TON → монеты и минимальная ставка теперь в копейках.
INSERT INTO app_settings (key, value) VALUES
    ('rates', '{"minorPerTon": 35000, "source": "manual", "updatedAt": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE app_settings
   SET value = (value - 'minStakeNano') || '{"minStakeMinor": 1000}'::jsonb
 WHERE key = 'upgrade';
