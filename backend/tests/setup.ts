/** Общая настройка окружения для тестов (выполняется до импорта приложения). */
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.TON_PROVIDER = 'mock';
process.env.TON_WATCHER_ENABLED = 'false';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_session_secret_0123456789abcdef0123456789';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test_admin_secret_0123456789';
// Адрес в корректном формате TON: валидация кошелька выполняется на старте.
process.env.TON_WALLET_ADDRESS =
  process.env.TON_WALLET_ADDRESS || 'UQD9v6hVJAoLWmkMxWruNmwp6Sc6l9cg8EYz3KEW0g_CA90Y';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:5173';
process.env.BCRYPT_ROUNDS = '4';
// Курс в тестах задаётся вручную: обращений к биржевым источникам нет.
process.env.RATE_AUTO_UPDATE = 'false';
process.env.RATE_MAX_AGE_MINUTES = '0';
process.env.COIN_MINOR_PER_TON = '35000';
