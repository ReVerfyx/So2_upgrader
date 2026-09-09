-- ============================================================================
-- Миграция 001 — базовая схема Upgrader Standoff 2
-- Все денежные величины хранятся в нанотонах (1 TON = 1_000_000_000 нанотон)
-- в виде BIGINT, чтобы полностью исключить ошибки округления чисел с плавающей
-- точкой при работе с балансом.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Пользователи
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username          TEXT        NOT NULL,
    username_lower    TEXT        NOT NULL,
    display_name      TEXT        NOT NULL,
    email             TEXT,
    password_hash     TEXT,
    role              TEXT        NOT NULL DEFAULT 'user',
    is_blocked        BOOLEAN     NOT NULL DEFAULT FALSE,
    block_reason      TEXT,
    avatar_url        TEXT,
    -- Задел под внешнюю авторизацию (например, официальный API Standoff 2).
    -- Пароли внешних аккаунтов НИКОГДА не хранятся и не запрашиваются.
    external_provider TEXT,
    external_id       TEXT,
    game_nickname     TEXT,
    contact           TEXT,
    -- Provably fair: семена для проверяемой генерации результата апгрейда
    server_seed       TEXT        NOT NULL,
    server_seed_hash  TEXT        NOT NULL,
    client_seed       TEXT        NOT NULL,
    nonce             BIGINT      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at     TIMESTAMPTZ,
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
    CONSTRAINT users_nonce_check CHECK (nonce >= 0)
);

CREATE UNIQUE INDEX users_username_lower_key ON users (username_lower);
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_external_key ON users (external_provider, external_id)
    WHERE external_provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX users_created_at_idx ON users (created_at DESC);

-- ---------------------------------------------------------------------------
-- Балансы (отдельная таблица: строка блокируется SELECT ... FOR UPDATE)
-- ---------------------------------------------------------------------------
CREATE TABLE balances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    currency     TEXT        NOT NULL DEFAULT 'TON',
    amount_nano  BIGINT      NOT NULL DEFAULT 0,
    locked_nano  BIGINT      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT balances_amount_check CHECK (amount_nano >= 0),
    CONSTRAINT balances_locked_check CHECK (locked_nano >= 0)
);

CREATE UNIQUE INDEX balances_user_currency_key ON balances (user_id, currency);

-- ---------------------------------------------------------------------------
-- Сессии (httpOnly cookie; в базе хранится только SHA-256 хеш токена)
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    csrf_token  TEXT        NOT NULL,
    user_agent  TEXT,
    ip          TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Каталог предметов
-- ---------------------------------------------------------------------------
CREATE TABLE items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    weapon         TEXT        NOT NULL DEFAULT 'Прочее',
    rarity         TEXT        NOT NULL,
    condition      TEXT        NOT NULL DEFAULT 'field_tested',
    image_url      TEXT        NOT NULL DEFAULT '/items/placeholder.svg',
    price_nano     BIGINT      NOT NULL,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    is_withdrawable BOOLEAN    NOT NULL DEFAULT TRUE,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT items_price_check CHECK (price_nano > 0),
    CONSTRAINT items_rarity_check CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'arcane', 'contraband')),
    CONSTRAINT items_condition_check CHECK (condition IN ('factory_new', 'minimal_wear', 'field_tested', 'well_worn', 'battle_scarred'))
);

CREATE UNIQUE INDEX items_slug_key ON items (slug);
CREATE INDEX items_price_idx ON items (price_nano);
CREATE INDEX items_rarity_idx ON items (rarity);
CREATE INDEX items_active_price_idx ON items (is_active, price_nano);

-- ---------------------------------------------------------------------------
-- Инвентарь пользователя
-- ---------------------------------------------------------------------------
CREATE TABLE inventory (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id       UUID        NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
    status        TEXT        NOT NULL DEFAULT 'available',
    condition     TEXT        NOT NULL DEFAULT 'field_tested',
    price_nano    BIGINT      NOT NULL,
    acquired_from TEXT        NOT NULL DEFAULT 'system',
    source_id     UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inventory_status_check CHECK (status IN ('available', 'locked', 'consumed', 'withdrawn')),
    CONSTRAINT inventory_price_check CHECK (price_nano >= 0),
    CONSTRAINT inventory_source_check CHECK (acquired_from IN ('upgrade', 'purchase', 'admin', 'bonus', 'test', 'system'))
);

CREATE INDEX inventory_user_status_idx ON inventory (user_id, status);
CREATE INDEX inventory_item_idx ON inventory (item_id);
CREATE INDEX inventory_created_idx ON inventory (created_at DESC);

-- ---------------------------------------------------------------------------
-- Апгрейды (результат считает только сервер, результат проверяем)
-- ---------------------------------------------------------------------------
CREATE TABLE upgrades (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source_type         TEXT        NOT NULL,
    source_inventory_id UUID        REFERENCES inventory (id) ON DELETE SET NULL,
    source_item_id      UUID        REFERENCES items (id) ON DELETE SET NULL,
    source_price_nano   BIGINT      NOT NULL,
    target_item_id      UUID        NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
    target_price_nano   BIGINT      NOT NULL,
    multiplier_bp       INTEGER     NOT NULL,
    chance_ppm          INTEGER     NOT NULL,
    roll_ppm            INTEGER     NOT NULL,
    success             BOOLEAN     NOT NULL,
    result_inventory_id UUID        REFERENCES inventory (id) ON DELETE SET NULL,
    server_seed         TEXT        NOT NULL,
    server_seed_hash    TEXT        NOT NULL,
    client_seed         TEXT        NOT NULL,
    nonce               BIGINT      NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT upgrades_source_type_check CHECK (source_type IN ('item', 'balance')),
    CONSTRAINT upgrades_chance_check CHECK (chance_ppm > 0 AND chance_ppm < 1000000),
    CONSTRAINT upgrades_roll_check CHECK (roll_ppm >= 0 AND roll_ppm < 1000000)
);

CREATE INDEX upgrades_user_created_idx ON upgrades (user_id, created_at DESC);
CREATE INDEX upgrades_created_idx ON upgrades (created_at DESC);
CREATE INDEX upgrades_success_idx ON upgrades (success);

-- ---------------------------------------------------------------------------
-- Пополнения через TON
-- ---------------------------------------------------------------------------
CREATE TABLE deposits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    payment_id     TEXT        NOT NULL,
    wallet_address TEXT        NOT NULL,
    amount_nano    BIGINT      NOT NULL,
    received_nano  BIGINT      NOT NULL DEFAULT 0,
    status         TEXT        NOT NULL DEFAULT 'pending',
    tx_hash        TEXT,
    sender_address TEXT,
    confirmations  INTEGER     NOT NULL DEFAULT 0,
    metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    confirmed_at   TIMESTAMPTZ,
    CONSTRAINT deposits_status_check CHECK (status IN ('pending', 'confirmed', 'failed', 'expired')),
    CONSTRAINT deposits_amount_check CHECK (amount_nano > 0)
);

CREATE UNIQUE INDEX deposits_payment_id_key ON deposits (payment_id);
-- Гарантия отсутствия двойного зачисления одной и той же транзакции блокчейна
CREATE UNIQUE INDEX deposits_tx_hash_key ON deposits (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX deposits_user_created_idx ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_status_idx ON deposits (status);
CREATE INDEX deposits_expires_idx ON deposits (expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Заявки на вывод предметов (обрабатываются администратором вручную)
-- ---------------------------------------------------------------------------
CREATE TABLE withdrawals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    inventory_id  UUID        REFERENCES inventory (id) ON DELETE SET NULL,
    item_id       UUID        NOT NULL REFERENCES items (id) ON DELETE RESTRICT,
    item_name     TEXT        NOT NULL,
    price_nano    BIGINT      NOT NULL,
    game_nickname TEXT        NOT NULL,
    contact       TEXT,
    status        TEXT        NOT NULL DEFAULT 'pending',
    admin_id      UUID        REFERENCES users (id) ON DELETE SET NULL,
    admin_comment TEXT,
    tx_hash       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at  TIMESTAMPTZ,
    CONSTRAINT withdrawals_status_check CHECK (status IN ('pending', 'processing', 'completed', 'rejected'))
);

CREATE UNIQUE INDEX withdrawals_active_inventory_key ON withdrawals (inventory_id)
    WHERE status IN ('pending', 'processing') AND inventory_id IS NOT NULL;
CREATE INDEX withdrawals_user_created_idx ON withdrawals (user_id, created_at DESC);
CREATE INDEX withdrawals_status_created_idx ON withdrawals (status, created_at);

-- ---------------------------------------------------------------------------
-- Журнал всех операций с балансом
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type                TEXT        NOT NULL,
    amount_nano         BIGINT      NOT NULL,
    currency            TEXT        NOT NULL DEFAULT 'TON',
    balance_before_nano BIGINT      NOT NULL,
    balance_after_nano  BIGINT      NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'completed',
    reference_type      TEXT,
    reference_id        UUID,
    tx_hash             TEXT,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT transactions_type_check CHECK (type IN (
        'deposit', 'withdrawal', 'upgrade_stake', 'upgrade_win', 'upgrade_loss',
        'item_sell', 'admin_adjust', 'refund', 'bonus', 'test_credit'
    )),
    CONSTRAINT transactions_status_check CHECK (status IN ('pending', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX transactions_user_created_idx ON transactions (user_id, created_at DESC);
CREATE INDEX transactions_type_idx ON transactions (type);
CREATE INDEX transactions_reference_idx ON transactions (reference_type, reference_id);
CREATE INDEX transactions_created_idx ON transactions (created_at DESC);

-- ---------------------------------------------------------------------------
-- Журнал действий администраторов
-- ---------------------------------------------------------------------------
CREATE TABLE admin_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID        REFERENCES users (id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip          TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_logs_admin_idx ON admin_logs (admin_id, created_at DESC);
CREATE INDEX admin_logs_created_idx ON admin_logs (created_at DESC);
CREATE INDEX admin_logs_target_idx ON admin_logs (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Ключи идемпотентности (защита от повторной отправки запросов)
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key             TEXT        NOT NULL,
    endpoint        TEXT        NOT NULL,
    request_hash    TEXT        NOT NULL,
    response_status INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX idempotency_user_key_endpoint_key ON idempotency_keys (user_id, key, endpoint);
CREATE INDEX idempotency_expires_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Журнал ошибок (доступен в админ-панели)
-- ---------------------------------------------------------------------------
CREATE TABLE error_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level      TEXT        NOT NULL DEFAULT 'error',
    code       TEXT,
    message    TEXT        NOT NULL,
    stack      TEXT,
    context    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    user_id    UUID        REFERENCES users (id) ON DELETE SET NULL,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT error_logs_level_check CHECK (level IN ('warn', 'error', 'fatal'))
);

CREATE INDEX error_logs_created_idx ON error_logs (created_at DESC);
CREATE INDEX error_logs_level_idx ON error_logs (level);

-- ---------------------------------------------------------------------------
-- Настройки приложения (коэффициенты апгрейда и т.п.)
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID        REFERENCES users (id) ON DELETE SET NULL
);
