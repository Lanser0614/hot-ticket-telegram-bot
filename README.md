# HotTicketBot

Telegram-бот на Telegram Serverless, который загружает горячие предложения Aviasales, показывает их пользователям и отправляет дедуплицированные уведомления по подпискам.

## Что уже реализовано

- регистрация через `/start` и подтверждение собственного номера через Telegram contact;
- просмотр, фильтрация и сортировка актуальных билетов;
- создание и управление подписками, максимум 20 активных подписок на пользователя;
- синхронизация всех активных пар `origin/currency`, начальная пара — `TAS/UZS`;
- сохранение истории цен, деактивация устаревших билетов и защита от повторных уведомлений;
- retry Aviasales для временных ошибок, timeout 10 секунд и изоляция ошибки отдельного источника;
- строгая TypeScript-модель, SQLite-схема и deploy-сборка без неподдерживаемых runtime-импортов.

## Требования

- Node.js 18 или новее;
- npm;
- Telegram-бот, созданный в [@BotFather](https://t.me/BotFather), и включённый для него Telegram Serverless;
- отдельный CLI access token: `бот → Serverless → CLI Access → Access token` в @BotFather;
- доступ к Aviasales Explore API.

## Локальный запуск проверок

```bash
npm install
npm run verify
```

`npm run verify` последовательно запускает ESLint, проверку типов, тесты и сборку. Результат сборки создаётся в `telegram-dist/`:

```text
telegram-dist/
├── schema.js
├── handlers/
│   ├── callback_query.js
│   └── message.js
└── lib/
    └── sync-hot-tickets.js
```

Папка `telegram-dist/.tgcloud` сохраняется между сборками: в ней CLI хранит локальную привязку и snapshot проекта.

## Конфигурация Aviasales

Единственный базовый URL API:

```text
https://explore-api.aviasales.com
```

В Telegram Serverless он является контролируемой константой production-композиции и не может быть передан пользователем или cron-запросом. Для будущего внешнего HTTP-адаптера образец переменных находится в `.env.example`:

```dotenv
AVIASALES_EXPLORE_BASE_URL=https://explore-api.aviasales.com
SYNC_SECRET=заменить-на-длинный-случайный-секрет
```

Секреты нельзя коммитить в репозиторий или передавать в query string.

## Деплой в Telegram Serverless

Все команды ниже автоматически выполняются из `telegram-dist`, чтобы CLI видел только допустимые deploy-файлы.

1. Соберите проект:

   ```bash
   npm run build
   ```

2. Привяжите проект к боту. Команда интерактивно запросит отдельный CLI access token из раздела Serverless в @BotFather:

   ```bash
   npm run cloud:login
   ```

3. Проверьте локальные изменения относительно snapshot:

   ```bash
   npm run cloud:status
   npm run cloud:diff
   ```

4. Отправьте модули и примените изменения SQLite-схемы:

   ```bash
   npm run cloud:push
   npm run cloud:migrate
   ```

Перед подтверждением migration внимательно просмотрите diff. Для CI можно отдельно использовать поддерживаемые CLI-флаги `--safe`, `--yes` или `--dry-run`.

Официальная документация: [Telegram Serverless](https://core.telegram.org/bots/serverless).

## Ручной запуск синхронизации

После деплоя callable-модуль можно вызвать через Telegram CLI:

```bash
npm run cloud:run-sync
```

Модуль сам создаёт начальный источник `TAS/UZS`, если его ещё нет, затем обрабатывает все активные записи `sync_sources`. Он не принимает извне `origin`, `currency` или URL Aviasales.

## Внешний бесплатный cron

Telegram Serverless предоставляет callable-модули через свой CLI, но в использованной публичной документации нет механизма для произвольного публичного HTTP route. Поэтому внешний cron подключается через небольшой HTTP-адаптер на выбранном позже бесплатном хостинге.

Готовый transport-independent контракт находится в `src/http/sync-endpoint.ts`:

```http
POST /internal/jobs/sync-hot-tickets
Authorization: Bearer <SYNC_SECRET>
```

Успешный ответ:

```json
{
  "status": "success",
  "processed_sources": 1
}
```

Требования к hosting-адаптеру:

- передать endpoint только HTTP method и заголовок `Authorization`;
- хранить `SYNC_SECRET` в секретах платформы;
- не принимать из запроса source-параметры и внешний URL;
- возвращать `401` для неверного секрета, `405` не для `POST`, `500` без внутренних деталей;
- настроить cron так, чтобы повторный запуск был допустим: lock, upsert и notification history уже обеспечивают идемпотентность бизнес-операции.

Конкретный адаптер и расписание будут добавлены после выбора бесплатного cron/hosting-сервиса.

## Основные команды

| Команда | Назначение |
|---|---|
| `npm test` | все тесты |
| `npm run lint` | ESLint |
| `npm run typecheck` | строгая проверка TypeScript |
| `npm run build` | собрать deploy-файлы |
| `npm run verify` | полная локальная проверка |
| `npm run cloud:status` | статус deploy-папки |
| `npm run cloud:diff` | diff deploy-папки |
| `npm run cloud:push` | отправить код в Telegram Serverless |
| `npm run cloud:migrate` | применить schema migration |
| `npm run cloud:run-sync` | вручную вызвать sync-модуль в облаке |
