-- ============================================================================
-- Миграция 002 — автообновление updated_at и настройки по умолчанию
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER items_set_updated_at       BEFORE UPDATE ON items       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_set_updated_at   BEFORE UPDATE ON inventory   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deposits_set_updated_at    BEFORE UPDATE ON deposits    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER withdrawals_set_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Настройки экономики. Значения можно менять из админ-панели,
-- переменные окружения используются как значения по умолчанию при первом запуске.
INSERT INTO app_settings (key, value) VALUES
    ('upgrade', '{"houseEdge": 0.08, "minChance": 0.005, "maxChance": 0.85, "maxMultiplier": 100}'::jsonb),
    ('deposit', '{"minDepositNano": 880000000, "ttlMinutes": 30, "minConfirmations": 1}'::jsonb),
    ('site',    '{"maintenance": false, "announcement": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
