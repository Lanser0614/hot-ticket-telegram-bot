# Дизайн миграции HotTicketBot на VDS

## Цель

Перевести существующий Telegram-бот горячих авиабилетов с Telegram Serverless на обычный VDS с 1 vCPU и 2 ГБ RAM. Сохранить доменную и прикладную логику, заменить только runtime-зависимости, способ получения Telegram updates, базу данных, сборку и эксплуатационные файлы.

После миграции бот не зависит от Telegram Serverless, доменного имени, Telegram webhook, внешнего cron-сервиса или публичного HTTP endpoint.

## Принятые решения

- Production runtime: Node.js 24 LTS.
- Telegram updates: long polling через Bot API `getUpdates`.
- Отправка сообщений: прямые HTTPS-вызовы Telegram Bot API через встроенный `fetch`.
- Хранилище: локальный SQLite-файл через `better-sqlite3`.
- Постоянный процесс: `systemd` service.
- Синхронизация Aviasales: отдельная короткоживущая CLI-команда, запускаемая локальным cron каждые 10 минут.
- Публичный HTTP endpoint синхронизации удаляется.
- Секреты загружаются из защищённого environment-файла вне репозитория.
- Сборка создаёт обычный Node.js-каталог `dist/`.

## Архитектура

```text
Telegram Bot API
       ↑↓ getUpdates / sendMessage / answerCallbackQuery
Постоянный Node.js-процесс под systemd
       ↓
TelegramBotRouter и application services
       ↓
SQLite: /opt/hot-ticket-bot/data/hot-ticket-bot.sqlite
       ↑
Локальный cron → отдельная sync CLI → Aviasales Explore API
```

Доменная модель, application services, presenters и Aviasales mapping остаются независимыми от runtime. Новые VDS-адаптеры реализуют уже существующие порты приложения.

## Компоненты

### Конфигурация

Production-конфигурация загружается один раз при старте процесса и проверяет:

- `TELEGRAM_BOT_TOKEN` — обязательная непустая строка;
- `DATABASE_PATH` — путь к SQLite-файлу, по умолчанию `./data/hot-ticket-bot.sqlite`;
- `AVIASALES_EXPLORE_BASE_URL` — обязательный HTTPS URL;
- `TELEGRAM_POLL_TIMEOUT_SECONDS` — целое число от 1 до 50, по умолчанию 50;
- `TELEGRAM_UPDATE_MAX_ATTEMPTS` — целое число от 1 до 5, по умолчанию 3.

Токен не включается в тексты ошибок и логи. `.env.example` содержит только имена и несекретные значения.

### SQLite

`better-sqlite3` открывает одну connection на процесс. При открытии выполняются:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Миграции хранятся как нумерованные SQL-файлы. Таблица `schema_migrations` фиксирует применённые версии. Применение выполняется транзакционно и идемпотентно при старте bot-процесса и sync-команды.

Существующие таблицы сохраняются. Добавляется таблица состояния приложения для durable Telegram offset:

```sql
CREATE TABLE app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

Существующие SQL-репозитории переносятся из Telegram Serverless namespace в SQLite infrastructure namespace. Небольшой adapter предоставляет им `run`, `get` и `all` поверх prepared statements.

### Telegram Bot API

`TelegramBotApiClient` принимает токен и injectable `fetch`. Он:

- строит URL только из фиксированного `https://api.telegram.org` и токена конфигурации;
- выполняет `getUpdates`, `sendMessage` и `answerCallbackQuery`;
- принимает ответы как `unknown` и валидирует обязательные поля;
- распознаёт Telegram `ok: false` как типизированную ошибку;
- не включает токен или полный URL в ошибку;
- использует `AbortSignal` для timeout и корректной остановки long polling.

Telegram router продолжает получать минимальные внутренние `TelegramMessage` и `TelegramCallbackQuery`, поэтому пользовательские сценарии не переписываются.

### Long polling

Постоянный runner выполняет `getUpdates` с серверным timeout 50 секунд по умолчанию. `allowed_updates` ограничен `message` и `callback_query`.

Алгоритм:

1. прочитать durable offset из `app_state`;
2. запросить updates начиная с offset;
3. проверить каждый update как `unknown`;
4. последовательно передать поддерживаемое событие router;
5. после успешной обработки записать `update_id + 1`;
6. при ошибке сделать до трёх попыток с backoff 1 и 2 секунды между ними;
7. после исчерпания retry залогировать безопасную ошибку, сохранить следующий offset и продолжить, чтобы один повреждённый update не остановил бота навсегда.

При `SIGTERM` или `SIGINT` активный HTTP-запрос отменяется, цикл завершается и SQLite закрывается. Это позволяет `systemd` останавливать процесс без повреждения данных.

### Синхронизация Aviasales

Отдельный entry point открывает конфигурацию и SQLite, применяет миграции, обеспечивает начальную запись `TAS/UZS`, выполняет существующий `SyncHotTicketsJob`, выводит краткий JSON-результат и закрывает базу.

Production-команда:

```bash
npm run sync
```

Cron запускает её каждые 10 минут через `flock`. Это предотвращает параллельные CLI-процессы. Существующие lock-записи в SQLite сохраняются как дополнительная защита на уровне каждой пары source.

### Сборка

Telegram Serverless build policy и `tgcloud` удаляются. TypeScript собирается для Node.js 24 в `dist/`. Production `npm start` запускает собранный bot entry point, а `npm run sync` — собранный sync entry point.

Production runtime не должен содержать imports `sdk`, `sdk/db`, `sdk/api` или `sdk/fetch`.

## Потоки данных

### Пользовательское сообщение

```text
Telegram getUpdates
→ unknown validation
→ TelegramMessage
→ TelegramBotRouter
→ services
→ SQLite repositories
→ Telegram sendMessage
→ durable offset
```

### Cron-синхронизация

```text
VDS cron
→ flock
→ sync CLI
→ migrations
→ enabled sync_sources
→ Aviasales
→ ticket upsert / price history
→ subscription matching
→ Telegram notification
→ notification history
→ process exit
```

## Ошибки и восстановление

- Сетевая ошибка long polling приводит к backoff и новому запросу, но не завершает systemd service.
- Ошибка отдельного Telegram update изолируется и после ограниченного retry не блокирует очередь.
- Ошибка одной Aviasales source-пары не останавливает остальные пары.
- SQLite `busy_timeout` сглаживает короткую конкуренцию bot-процесса и sync CLI.
- `flock` предотвращает наложение cron-запусков.
- Существующие notification history и уникальные ограничения предотвращают повторные уведомления.
- `systemd` перезапускает bot-процесс после непредвиденного завершения.
- Ежедневный cron в 03:30 создаёт SQLite backup; копии старше семи дней удаляются только из выделенного каталога backup.

## Безопасность

- Bot API token хранится только в `/etc/hot-ticket-bot.env` с правами `0600`.
- Systemd service запускается от отдельного непривилегированного пользователя.
- Каталог данных доступен только этому пользователю.
- Нет открытого HTTP-порта приложения, webhook или cron endpoint.
- Все внешние запросы используют HTTPS.
- Telegram user ID, contact ownership, subscription ownership и лимит подписок проверяются существующей application-логикой.
- Логи не содержат токен, секреты или полный ответ Aviasales.

## Эксплуатация VDS

Репозиторий содержит готовые примеры:

- `deploy/systemd/hot-ticket-bot.service`;
- `deploy/cron/hot-ticket-bot-sync`;
- production environment example;
- команды установки Node.js 24 LTS, зависимостей, сборки и миграций;
- запуск, restart, status и просмотр journal logs;
- backup и restore SQLite.

Целевая раскладка:

```text
/opt/hot-ticket-bot/
├── dist/
├── migrations/
├── data/
├── node_modules/
├── package.json
└── package-lock.json

/etc/hot-ticket-bot.env
/etc/systemd/system/hot-ticket-bot.service
/etc/cron.d/hot-ticket-bot-sync
```

## Тестирование и release gate

Добавляются проверки:

- конфигурация VDS и запрет пустого токена;
- применение миграций в новой и уже инициализированной временной базе;
- реальные repository integration-тесты на временном SQLite-файле;
- Telegram API response validation и отсутствие токена в ошибках;
- long polling dispatch, durable offset, retry, пропуск poison update и graceful stop;
- sync CLI composition с тестовыми зависимостями;
- production build и отсутствие Serverless imports;
- статическая проверка systemd и cron-файлов.

Сохраняются существующие domain, application, Aviasales и Telegram flow-тесты. Старые Serverless contract/build-тесты заменяются VDS-контрактами.

Release gate:

```bash
npm run verify
```

Команда должна успешно выполнить lint, strict TypeScript typecheck, все Vitest suites и production build.

## Удаляемые Serverless-компоненты

- `@tgcloud/cli` и cloud npm scripts;
- `scripts/tgcloud.mjs`, Telegram deploy build и build policy;
- `telegram-dist`;
- `schema.ts` с `sdk/db` DSL;
- `src/types/telegram-sdk.d.ts`;
- Serverless handlers и callable entry point;
- `src/http/sync-endpoint.ts` и его тесты;
- imports `sdk`, `sdk/db`, `sdk/api` и `sdk/fetch`.

Удаление безопасно: функциональные use cases сохраняются, а история файлов остаётся в Git.

## Критерии готовности

- Бот запускается на чистом VDS без Telegram Serverless и домена.
- `/start`, contact, tickets, settings и subscriptions работают через long polling.
- Перезапуск процесса продолжает чтение с сохранённого Telegram offset.
- Локальный cron синхронизирует `TAS/UZS` каждые 10 минут.
- SQLite сохраняет пользователей, билеты, цены, подписки, историю уведомлений и sync runs.
- Один VDS с 1 vCPU и 2 ГБ RAM достаточен для MVP-профиля нагрузки.
- Нет публичного listening-порта или обязательного внешнего cron-сервиса.
- `npm run verify` проходит полностью.
