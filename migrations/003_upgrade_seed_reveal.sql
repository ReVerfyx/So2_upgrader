-- ============================================================================
-- Миграция 003 — раскрытие серверного семени (provably fair)
--
-- Серверное семя нельзя показывать сразу после игры: зная его, игрок мог бы
-- заранее вычислить результат следующего апгрейда (nonce увеличивается на 1).
-- Поэтому семя раскрывается только после его ротации, а до этого публикуется
-- лишь SHA-256 хеш, зафиксированный ДО игры.
-- ============================================================================

ALTER TABLE upgrades ADD COLUMN revealed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX upgrades_seed_hash_idx ON upgrades (user_id, server_seed_hash);

-- История использованных семян: позволяет проверить любую прошлую игру.
CREATE TABLE server_seeds (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    server_seed      TEXT        NOT NULL,
    server_seed_hash TEXT        NOT NULL,
    client_seed      TEXT        NOT NULL,
    nonce_used       BIGINT      NOT NULL DEFAULT 0,
    revealed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX server_seeds_user_idx ON server_seeds (user_id, revealed_at DESC);
CREATE UNIQUE INDEX server_seeds_hash_key ON server_seeds (user_id, server_seed_hash);

-- Минимальная ставка балансом в апгрейде (0.1 TON).
UPDATE app_settings
   SET value = value || '{"minStakeNano": 100000000}'::jsonb
 WHERE key = 'upgrade';
