# Обзор проекта и архитектура

## Назначение

Hot Ticket собирает предложения авиабилетов, позволяет искать их в Telegram, создавать условия отслеживания и получать уведомления о новых билетах или снижении цены. Mini App предоставляет более удобный интерфейс для Hot Deals, истории цены, Watchlist и настроек. Админка показывает состояние продукта и накопленную статистику.

## Технологии

- Node.js 24;
- TypeScript с strict-проверкой;
- Express для Mini App API и админки;
- SQLite через `better-sqlite3`;
- Telegram Bot API через собственный HTTP-клиент;
- статический HTML/CSS/JavaScript для Mini App;
- Caddy для HTTPS и reverse proxy;
- systemd для постоянных процессов;
- cron для sync и backup;
- GitHub Actions для CI/CD.

## Запускаемые процессы

| Процесс | Entry point | systemd unit | Назначение |
|---|---|---|---|
| Telegram-бот | `dist/entries/bot.js` | `hot-ticket-bot.service` | Long polling, команды, каталог, уведомления |
| Mini App API | `dist/entries/web.js` | `hot-ticket-web.service` | Статика `/app`, API `/api/v1`, редиректы `/go` |
| Админка | `dist/entries/admin.js` | `hot-ticket-admin.service` | Dashboard, статистика, ручной sync |
| Синхронизация | `dist/entries/sync.js` | cron/CD/ручной запуск | Загрузка и обработка билетов |
| Backup | `dist/entries/backup.js` | cron | Резервная копия SQLite |

Все процессы открывают один и тот же файл SQLite и автоматически применяют неприменённые миграции при старте.

## Слои приложения

```text
src/
├── domain/          Чистые правила: подписки, цены, Deal Score, подписи
├── application/     Сценарии: бот, поиск, sync, Mini App, админка
├── infrastructure/  SQLite, Aviasales, Telegram, HTTP
├── presentation/    HTML и Telegram-представление
├── entries/         Точки запуска процессов
└── runtime/         Сборка зависимостей приложения
```

### Domain

Содержит правила, не зависящие от Express, Telegram или SQLite:

- нормализация IATA-кодов и валют;
- валидация дат и денежных значений;
- определение нового билета и снижения цены;
- проверка соответствия подписке;
- Deal Score и тренд цены;
- HMAC-подписи Telegram и click tracking;
- генерация партнёрской ссылки.

### Application

Оркестрирует пользовательские сценарии:

- `TelegramBotRouter` обрабатывает команды, сообщения и callback query;
- `TicketService` применяет профиль пользователя и выдаёт страницы каталога;
- `SubscriptionService` создаёт и отключает подписки;
- `SyncTicketsService` сохраняет билеты, историю и отправляет уведомления;
- `MiniAppService` формирует Hot Deals, детали, историю и Watchlist;
- `AdminService` фильтрует каталог и готовит dashboard.

### Infrastructure

Реализует внешние интеграции:

- Aviasales Explore API;
- Telegram Bot API;
- SQLite repositories;
- Express-серверы;
- резервное копирование;
- консольные структурированные логи.

## Главный поток данных

```text
cron / CD / admin button
          │
          ▼
  SyncHotTicketsJob
          │
          ▼
 Aviasales Hot Offers
          │
          ▼
 validate + map tickets
          │
          ├── upsert tickets
          ├── ticket price history
          ├── route price observations
          ├── daily route aggregates
          ├── match subscriptions
          ├── Telegram notifications
          ├── deactivate unseen tickets
          └── refresh destination cache
```

## Общая модель пользователя

Пользователь создаётся командой `/start`. Бот сохраняет Telegram ID, chat ID, имя, username и язык. В профиле также хранятся общие настройки:

- класс: `economy` или `business`;
- багаж: не важно или только с багажом;
- фиксированный origin `TAS`;
- фиксированная валюта `UZS`.

Эти настройки применяются одновременно:

- к поиску в боте;
- к Hot Deals в Mini App;
- к списку доступных направлений;
- к проверке подписок перед отправкой уведомления.

## Что является источником истины

SQLite — единственный источник истины для билетов, профилей, подписок, кликов, sync-истории и цен. Telegram и Mini App не поддерживают независимые копии этих данных.

## Текущие осознанные ограничения

- Проект не является универсальным поисковиком по любому городу вылета.
- Hot Deals строятся по каталогу Explore API, а не по live-поиску всех авиакомпаний.
- Уведомления возникают только для `new_ticket` и `price_drop`; повышение цены уведомление не создаёт.
- История в пользовательском интерфейсе является историей маршрута и класса, а не историей одного конкретного билета.
- До семи дней истории Deal Score не делает сильных выводов.

