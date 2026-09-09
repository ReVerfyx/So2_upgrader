# STOCK2 — Upgrader Standoff 2

Игровая площадка апгрейда скинов Standoff 2: **честные шансы с проверкой
результата**, пополнение в TON, внутренняя валюта «монеты» (1 монета = 1 ₽),
прозрачная очередь вывода предметов и полноценная админ-панель.

Telegram: [@stock2_shop](https://t.me/stock2_shop)

---

## Главное о честности

| Обещание | Как обеспечено |
| --- | --- |
| Показанная вероятность = реальная | Шанс считает сервер одной формулой для предпросмотра и игры. Клиент присылает шанс, который видел (`expectedChancePpm`); расхождение отклоняет игру с кодом `CHANCE_MISMATCH`, деньги не списываются |
| Результат нельзя подменить | Исход вычисляется на сервере до анимации: `HMAC-SHA256(server_seed, client_seed:nonce)`. Анимация только доводит стрелку до полученной позиции |
| Результат можно перепроверить | SHA-256 хеш серверного семени публикуется **до** игры, само семя раскрывается после смены. Эндпоинт `GET /api/upgrades/:id/verify` пересчитывает бросок |
| Баланс нельзя «нарисовать» | Пополнение подтверждает фоновый воркер, который сам находит транзакцию в блокчейне TON. Запрос вида `amount=100` из браузера ничего не начисляет |
| Нет двойных начислений | Уникальный индекс на хеш транзакции + блокировка строк `SELECT … FOR UPDATE` в транзакциях БД + ключи идемпотентности |
| Вывод описан честно | Выдача выполняется оператором вручную, интерфейс показывает реальный статус «Заявка в очереди» и позицию в очереди |

Формула шанса: `шанс = (ставка / цена цели) × (1 − комиссия)`.
При комиссии 8% апгрейд x2 даёт ровно 46%.

---

## Стек

| Слой | Технологии |
| --- | --- |
| Бэкенд | Node.js 20+, TypeScript, Express, PostgreSQL 16 (`pg`, без ORM), zod, bcryptjs |
| Фронтенд | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query |
| Тесты | Vitest + Supertest (66 тестов бэкенда, 14 фронтенда) |
| Инфраструктура | Docker Compose, nginx, GitHub Actions |

Дизайн-система построена по референсу upgrader.vip — см. [docs/reference.md](docs/reference.md).

---

## Структура проекта

```
stock2/
├── backend/                  # API на Express + PostgreSQL
│   ├── src/
│   │   ├── config/env.ts     # валидация переменных окружения
│   │   ├── db/               # пул, транзакции, миграции, сиды, импорт каталога
│   │   ├── lib/              # деньги, provably fair, математика апгрейда, ошибки
│   │   ├── middleware/       # авторизация, CSRF, rate limit, идемпотентность
│   │   ├── routes/           # REST API
│   │   ├── services/         # бизнес-логика (баланс, апгрейд, платежи, вывод)
│   │   ├── ton/              # адаптер блокчейна TON (toncenter / mock)
│   │   └── workers/          # фоновая проверка пополнений
│   └── tests/                # юнит- и интеграционные тесты
├── frontend/                 # SPA на React + Vite
│   └── src/
│       ├── components/       # UI: карточки, круг апгрейда, модалки, скелетоны
│       ├── hooks/            # авторизация, уведомления
│       ├── lib/              # API-клиент, форматирование, конфиг бренда
│       └── pages/            # страницы, включая admin/
├── migrations/               # SQL-миграции
├── database/                 # пример каталога предметов
├── public/items/             # нейтральные заглушки изображений
├── docs/                     # анализ референса, формат каталога
├── .github/workflows/        # CI и деплой
├── docker-compose.yml
└── .env.example
```

---

## Быстрый старт

### 1. Требования

* Node.js 20+
* PostgreSQL 16 (или Docker)

### 2. Установка

```bash
git clone <адрес-репозитория> stock2 && cd stock2
npm install
cp .env.example .env      # заполните значения (см. раздел «Переменные окружения»)
```

### 3. База данных

```bash
# Вариант A — Docker
docker compose up -d postgres

# Вариант B — локальный PostgreSQL
createdb stock2

# Миграции + демонстрационный каталог + администратор
npm run migrate
npm run seed
```

### 4. Запуск в разработке

```bash
npm run dev            # backend :4000 и frontend :5173 одновременно
# либо по отдельности
npm run dev:backend
npm run dev:frontend
```

Откройте <http://localhost:5173>. В тестовом режиме (`TEST_MODE=true`) доступны
быстрый вход, начисление тестовых монет и имитация платежа TON.

Администратор по умолчанию: `ADMIN_USERNAME` / `ADMIN_PASSWORD` из `.env`
(в разработке — `admin` / `admin12345`). **Обязательно смените в production.**

### 5. Запуск через Docker

```bash
cp .env.example .env      # заполните POSTGRES_PASSWORD, SESSION_SECRET и др.
docker compose up -d --build
```

Фронтенд — `http://localhost:8080`, API — `http://localhost:4000`.

---

## Переменные окружения

Все значения задаются в `.env` (локально) или в GitHub Secrets / переменных
окружения сервера. **Секреты никогда не попадают в репозиторий.**

### Обязательные в production

| Переменная | Описание |
| --- | --- |
| `DATABASE_URL` | `postgres://пользователь:пароль@хост:5432/база` |
| `SESSION_SECRET` | Секрет подписи сессий, ≥32 символа: `openssl rand -hex 32` |
| `ADMIN_SECRET` | Секрет служебных админ-операций, ≥16 символов |
| `APP_URL` | Публичный адрес сайта, например `https://stock2.ru` |
| `TON_WALLET_ADDRESS` | Адрес кошелька для приёма пополнений |
| `TON_PROVIDER` | `toncenter` (в production `mock` запрещён кодом) |
| `TON_API_KEY` | Ключ API провайдера блокчейна |

### Экономика

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `COIN_MINOR_PER_TON` | `35000` | Копеек за 1 TON (35000 = 350 монет). Меняется и в админ-панели |
| `MIN_DEPOSIT_TON` | `0.88` | Минимальная сумма пополнения |
| `DEPOSIT_TTL_MINUTES` | `30` | Время жизни счёта |
| `UPGRADE_HOUSE_EDGE` | `0.08` | Комиссия площадки (8%) |
| `UPGRADE_MIN_CHANCE` / `UPGRADE_MAX_CHANCE` | `0.005` / `0.85` | Границы шанса |
| `UPGRADE_MAX_MULTIPLIER` | `100` | Максимальный коэффициент |
| `UPGRADE_MIN_STAKE_COINS` | `10` | Минимальная ставка балансом |

### Авторизация Google

| Переменная | Описание |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Из Google Cloud Console → Credentials → OAuth client ID (Web application) |
| `GOOGLE_REDIRECT_URI` | Строго как в консоли: `https://ваш-домен/api/auth/google/callback` |
| `GOOGLE_SUCCESS_REDIRECT` | Куда вернуть пользователя после входа (по умолчанию `APP_URL`) |

Если переменные пусты, кнопка «Продолжить с Google» просто не показывается —
остаётся вход по логину и паролю.

### Прочее

| Переменная | Описание |
| --- | --- |
| `TEST_MODE` | `true` включает `/api/dev/*`. В production принудительно отключается кодом |
| `ITEMS_IMAGE_BASE_URL` | Базовый адрес изображений предметов |
| `VITE_BRAND_NAME`, `VITE_BRAND_TAGLINE`, `VITE_TELEGRAM_URL` | Настройки бренда фронтенда |

---

## Валюта и цены

* Внутренняя валюта — **монеты**: `1 монета = 1 ₽`.
* В базе суммы хранятся в **копейках** типом `BIGINT` (`price_minor`,
  `amount_minor`) — никаких чисел с плавающей точкой.
* Пополнение приходит в **TON** и конвертируется по курсу «монет за 1 TON».
  Курс фиксируется в момент создания счёта, поэтому его изменение не влияет
  на уже выставленные счета.
* Курс меняется в админ-панели (раздел «Коэффициенты») или переменной
  `COIN_MINOR_PER_TON`.

### Свой каталог скинов и цен

Каталог не «зашит» в код: цены на скины Standoff 2 постоянно меняются.
Загрузите свой прайс одной командой:

```bash
npm run items:import --workspace backend -- ./catalog.json
npm run items:import --workspace backend -- ./catalog.json --deactivate-missing
```

Формат файла и работа с изображениями — [docs/catalog.md](docs/catalog.md),
пример — `database/catalog.example.json`. Предметы также правятся вручную
в админ-панели (раздел «Предметы»), включая ссылку на изображение.

---

## REST API

### Публичные

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/health` | Состояние сервиса и БД |
| `GET` | `/api/config` | Публичная конфигурация (без секретов) |
| `GET` | `/api/items` | Каталог предметов с фильтрами |
| `GET` | `/api/items/:id` | Карточка предмета |
| `GET` | `/api/upgrades/recent` | Лента последних выигрышей |
| `GET` | `/api/upgrades/settings` | Коэффициенты площадки |

### Авторизация

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Регистрация |
| `POST` | `/api/auth/login` | Вход по логину и паролю |
| `POST` | `/api/auth/logout` | Выход |
| `POST` | `/api/auth/password` | Смена пароля |
| `GET` | `/api/auth/google` | Начало входа через Google |
| `GET` | `/api/auth/google/callback` | Возврат из Google |
| `POST` | `/api/auth/test-login` | Тестовый вход (только `TEST_MODE`) |

### Пользователь

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/user` | Профиль, баланс, статистика, честность |
| `PATCH` | `/api/user` | Изменение профиля |
| `GET` | `/api/balance` | Текущий баланс |
| `GET` | `/api/transactions` | Журнал операций |
| `GET` | `/api/user/fairness` | Хеш семени, клиентское семя, nonce |
| `POST` | `/api/user/fairness/rotate` | Смена семени с раскрытием прошлого |

### Инвентарь и апгрейд

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/inventory` | Инвентарь |
| `GET` | `/api/inventory/:id` | Подробности предмета |
| `POST` | `/api/inventory/:id/sell` | Продажа предмета |
| `POST` | `/api/upgrade/preview` | Расчёт: шанс, коэффициент, выигрыш |
| `POST` | `/api/upgrade` | Игра (идемпотентно) |
| `GET` | `/api/upgrade/targets` | Доступные цели для ставки |
| `GET` | `/api/upgrades` | История игр |
| `GET` | `/api/upgrades/:id/verify` | Проверка честности игры |

### Платежи и вывод

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/deposit/info` | Минимум, курс, время жизни счёта |
| `POST` | `/api/deposit` | Создать счёт (адрес, сумма, QR, комментарий) |
| `GET` | `/api/deposit/:id` | Статус счёта |
| `GET` | `/api/deposits` | История пополнений |
| `POST` | `/api/withdraw` | Заявка на вывод предмета |
| `GET` | `/api/withdrawals` | Мои заявки |
| `POST` | `/api/withdrawals/:id/cancel` | Отмена заявки в очереди |

### Админ (`role = admin`)

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/admin/stats` | Сводка |
| `GET` | `/api/admin/users` | Пользователи |
| `POST` | `/api/admin/users/:id/block` | Блокировка |
| `POST` | `/api/admin/users/:id/balance` | Корректировка баланса |
| `POST` | `/api/admin/users/:id/grant-item` | Выдача предмета |
| `GET` | `/api/admin/withdrawals` | Очередь выводов |
| `POST` | `/api/admin/withdrawals/:id/take` | Взять в работу |
| `POST` | `/api/admin/withdrawals/:id/process` | Выполнить (TX/комментарий) |
| `POST` | `/api/admin/withdrawals/:id/reject` | Отклонить с причиной |
| `GET` | `/api/admin/deposits` | Платежи |
| `POST` | `/api/admin/deposits/:id/confirm` | Ручное подтверждение |
| `POST` | `/api/admin/deposits/check` | Принудительная проверка блокчейна |
| `GET/POST/PATCH` | `/api/admin/items` | Управление предметами |
| `PUT` | `/api/admin/settings/upgrade` | Коэффициенты |
| `PUT` | `/api/admin/settings/rates` | Курс TON → монеты |
| `PUT` | `/api/admin/settings/deposit` | Параметры пополнения |
| `GET` | `/api/admin/upgrades` | История всех игр |
| `GET` | `/api/admin/logs` | Действия администраторов |
| `GET` | `/api/admin/errors` | Журнал ошибок |

---

## Схема базы данных

`users`, `balances`, `sessions`, `items`, `inventory`, `upgrades`, `deposits`,
`withdrawals`, `transactions`, `admin_logs`, `idempotency_keys`, `error_logs`,
`app_settings`, `server_seeds`, `schema_migrations`.

Все таблицы связаны внешними ключами, для частых выборок созданы индексы
(инвентарь по пользователю и статусу, история по дате, уникальные индексы на
`payment_id`, `tx_hash`, ключи идемпотентности).

Миграции применяются автоматически при старте сервера либо вручную:

```bash
npm run migrate
```

---

## Подключение TON

1. Создайте кошелёк (Tonkeeper, Tonhub) и укажите его адрес в
   `TON_WALLET_ADDRESS`. Приватный ключ на сервер **не передаётся** — приём
   платежей работает только на чтение блокчейна.
2. Получите ключ API на <https://toncenter.com/> и задайте `TON_API_KEY`,
   `TON_PROVIDER=toncenter`.
3. Включите воркер: `TON_WATCHER_ENABLED=true`, интервал — `TON_POLL_INTERVAL_MS`.
4. Проверьте: создайте счёт на сайте, отправьте перевод **с комментарием**
   (`SO2-XXXXXXXXXX`), баланс пополнится после подтверждения.

Другой провайдер подключается реализацией интерфейса `TonProvider`
(`backend/src/ton/TonProvider.ts`) — бизнес-логику менять не нужно.

---

## Тесты, линтеры, сборка

```bash
npm run typecheck    # TypeScript обоих пакетов
npm run lint         # ESLint
npm run test         # Vitest: 66 тестов бэкенда + 14 фронтенда
npm run build        # сборка backend и frontend
```

Интеграционные тесты требуют `DATABASE_URL`; без него они пропускаются.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/stock2_test npm run test --workspace backend
```

---

## GitHub Actions

### CI (`.github/workflows/ci.yml`)

Запускается на каждый push и pull request:

1. установка зависимостей;
2. проверка типов TypeScript;
3. ESLint;
4. миграции на сервисном PostgreSQL;
5. тесты бэкенда и фронтенда;
6. сборка бэкенда и фронтенда;
7. подготовка и публикация артефакта развёртывания;
8. сборка Docker-образов (только для `main`).

Никаких секретов для CI не требуется — используется сервисный PostgreSQL
и `TON_PROVIDER=mock`.

### Deploy (`.github/workflows/deploy.yml`)

Запускается вручную (`workflow_dispatch`) или по тегу `v*`.
Добавьте секреты в **Settings → Secrets and variables → Actions**:

| Секрет | Назначение |
| --- | --- |
| `DEPLOY_HOST` | Адрес сервера |
| `DEPLOY_USER` | Пользователь SSH |
| `DEPLOY_SSH_KEY` | Приватный ключ SSH |
| `DEPLOY_PATH` | Путь к проекту на сервере |
| `DEPLOY_PORT` | Порт SSH (необязательно) |

Переменные бренда (`VITE_BRAND_NAME`, `VITE_TELEGRAM_URL` и др.) задаются
в **Settings → Secrets and variables → Actions → Variables**.

---

## Свой домен

1. **DNS.** Создайте A-запись на IP сервера: `@ → 1.2.3.4` и `www → 1.2.3.4`.
2. **Переменные.** В `.env` на сервере:
   ```env
   APP_URL=https://stock2.ru
   CORS_ORIGINS=https://stock2.ru,https://www.stock2.ru
   TRUST_PROXY=1
   GOOGLE_REDIRECT_URI=https://stock2.ru/api/auth/google/callback
   ```
3. **HTTPS.** Поставьте перед контейнерами nginx или Caddy с Let's Encrypt:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d stock2.ru -d www.stock2.ru
   ```
   Пример проксирования (`/etc/nginx/sites-available/stock2`):
   ```nginx
   server {
       server_name stock2.ru www.stock2.ru;
       location / { proxy_pass http://127.0.0.1:8080; }
       location /api/ {
           proxy_pass http://127.0.0.1:4000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
4. **Google OAuth.** В Google Cloud Console добавьте в *Authorized redirect
   URIs* адрес `https://stock2.ru/api/auth/google/callback`, а в *Authorized
   JavaScript origins* — `https://stock2.ru`.
5. **Перезапуск.** `docker compose up -d --build`.

Cookie сессии выставляются с `Secure` при `NODE_ENV=production`, поэтому
HTTPS обязателен.

---

## Безопасность

* Сессии в httpOnly cookie, в базе — только HMAC-хеш токена.
* CSRF-защита по схеме double submit для всех изменяющих запросов.
* Ограничение частоты запросов по пользователю и IP на каждом чувствительном
  маршруте.
* Идемпотентность платежей, апгрейдов и заявок на вывод.
* Проверка владельца предмета и его статуса перед каждой операцией.
* Валидация всех входных данных через zod, очистка пользовательского текста.
* Пароли — bcrypt; пароль администратора нигде во фронтенде не хранится.
* Все действия администраторов и все ошибки пишутся в журналы, доступные
  в админ-панели.
* Тестовый режим физически отключается при `NODE_ENV=production`.

---

## Ответственность и ограничения

* Проект не аффилирован с Axlebolt и Standoff 2. Названия предметов
  используются как игровая терминология.
* Демонстрационный каталог и цены — примерные; загрузите свой прайс перед
  запуском (см. [docs/catalog.md](docs/catalog.md)).
* Изображения предметов не поставляются: используются нейтральные заглушки,
  свои картинки подключаются ссылкой. Не размещайте чужие изображения без прав.
* Выдача предметов выполняется вручную оператором — интерфейс сообщает об
  этом пользователю прямо.

## Лицензия

Apache License 2.0 — см. [LICENSE](LICENSE).
