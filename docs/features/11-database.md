# База данных

## Общие свойства

Проект использует локальный SQLite-файл. По умолчанию:

```text
./data/hot-ticket-bot.sqlite
```

Production path задаётся через `DATABASE_PATH`.

При открытии включаются:

- WAL journal mode;
- foreign keys;
- busy timeout 5 секунд;
- автоматическое создание родительского каталога.

## Автоматические миграции

Каждый runtime создаёт `schema_migrations` и применяет файлы `NNN_name.sql` по порядку в транзакции.

Для каждой миграции хранится SHA-256 checksum. Если уже применённый SQL-файл позже изменили, приложение останавливается с ошибкой вместо незаметного расхождения схемы.

Текущие миграции:

| Версия | Назначение |
|---|---|
| `001_initial` | Пользователи, билеты, подписки, sync, sessions |
| `002_fixed-tashkent-search` | Class/baggage и фиксированный `TAS/UZS` |
| `003_round-trip` | Return date у билета |
| `004_subscription-round-trip` | Round-trip condition у подписки |
| `005_destination-cache` | Кэш направлений |
| `006_link-clicks` | Snapshot переходов |
| `007_route-price-history` | Почасовая и дневная история маршрутов |
| `008_user-onboarding` | Признак завершённого выбора языка и origin |

## Основные таблицы

### `users`

Telegram-профиль, chat ID, контакт, язык, активность и пользовательские фильтры класса/багажа.

### `tickets`

Текущий каталог. `external_key` уникален. Исторически исчезнувшие билеты остаются с `is_active = 0`.

### `ticket_price_history`

Изменения цены конкретного ticket ID. Новая запись создаётся при первой вставке и каждом фактическом изменении цены.

### `subscriptions`

Условия Watchlist/alert. Отключение меняет `is_active`, не удаляя запись.

### `notification_history`

История доставок. Unique constraint на user/subscription/ticket/price обеспечивает dedup.

### `user_sessions`

Состояние пошаговых Telegram-сценариев с TTL.

### `sync_sources`

Источники загрузки для поддерживаемых origin Узбекистана в валюте `UZS`.

### `sync_runs`

Журнал запусков с результатами и ошибками.

### `sync_locks`

Application locks с owner и expiration.

### `app_state`

Системные key/value. Используется, в частности, для durable Telegram offset.

### `destination_cache`

JSON-массив destination codes для origin/currency/date/class/baggage.

### `link_clicks`

Snapshot человеческих, preview и bot-переходов.

### `route_price_observations`

Raw почасовые наблюдения маршрута. Хранятся 30 дней.

### `route_price_daily`

Дневные агрегаты маршрута: min, average, median, max, samples.

## Почему часть данных дублируется

В `link_clicks` намеренно копируются маршрут и цена, а не только ticket ID. Это сохраняет аналитический контекст, даже если ticket позднее изменился.

`ticket_price_history` и `route_price_daily` решают разные задачи: аудит конкретного предложения и сравнение рынка маршрута.

## Backup

Backup создаётся через SQLite backup API, что корректно работает с WAL. Имя:

```text
hot-ticket-bot-YYYYMMDDTHHMMSSZ.sqlite
```

Managed backups старше семи суток автоматически удаляются. Cron запускает backup ежедневно в 03:30 системного времени VDS.

## Восстановление

Перед восстановлением необходимо:

1. временно отключить cron;
2. остановить bot/web/admin или как минимум исключить запись;
3. сохранить текущие `.sqlite`, `-wal`, `-shm`;
4. установить backup с владельцем `hotticket` и правами `600`;
5. проверить `PRAGMA integrity_check`;
6. запустить сервисы и вернуть cron.
