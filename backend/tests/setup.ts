/** Общая настройка окружения для тестов (выполняется до импорта приложения). */
process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.TON_PROVIDER = 'mock';
process.env.TON_WATCHER_ENABLED = 'false';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_session_secret_0123456789abcdef0123456789';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test_admin_secret_0123456789';
process.env.TON_WALLET_ADDRESS = process.env.TON_WALLET_ADDRESS || 'EQtest_wallet_address_for_tests_only';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:5173';
process.env.BCRYPT_ROUNDS = '4';
