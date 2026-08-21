# Отслеживание кликов и партнёрские ссылки

## Цель

Все пользовательские кнопки билета могут вести не напрямую на Aviasales, а через подписанный endpoint Hot Ticket:

```text
https://ticket.crosfit.uz/go/:ticketId
```

Endpoint фиксирует переход и делает HTTP 302 redirect на конечную ссылку.

## Источники

| Source | Значение |
|---|---|
| `bot_search` | Обычный поиск в Telegram-боте |
| `bot_notification` | Push-уведомление бота |
| `miniapp_deals` | Карточка в списке Hot Deals |
| `miniapp_card` | Детальная карточка Mini App |
| `miniapp_watchlist` | Зарезервировано для переходов из Watchlist |

## Содержимое tracked link

Ссылка может включать:

- ticket ID;
- source;
- внутренний user ID;
- subscription ID;
- HMAC-подпись.

Подпись строится от всех этих полей с `CLICK_SIGNING_SECRET`. Изменение ID или source делает ссылку недействительной.

Если `PUBLIC_BASE_URL` или signing secret не настроены, фабрика ссылок безопасно возвращает прямую ссылку билета, но внутренний click tracking в этом случае не работает.

## Snapshot клика

При переходе в `link_clicks` сохраняются данные на момент клика:

- ticket ID;
- user ID;
- source;
- origin/destination;
- дата вылета;
- цена и валюта;
- subscription ID;
- тип user-agent;
- время.

Snapshot позволяет строить статистику даже после изменения или деактивации билета.

## Классификация трафика

User-agent классифицируется как:

- `human`;
- `telegram_preview`;
- `bot`.

TelegramBot, crawler, spider, preview и похожие агенты не считаются человеческими переходами в админке.

## Дедупликация

Для человеческого пользователя повторный клик по тому же билету в течение 60 секунд не записывается. Это защищает метрику от двойного tap и повторного открытия Telegram WebView.

## Rate limiting

- `/go` — до 60 запросов в минуту на IP;
- Mini App API — до 120 запросов в минуту на Telegram user ID.

Лимитер хранится в памяти каждого web-процесса и использует fixed one-minute window.

## Партнёрский marker

Если задан `AFFILIATE_MARKER`, redirect строится по `AFFILIATE_LINK_TEMPLATE`.

Доступные placeholders:

- `{search_code}`;
- `{marker}`;
- `{sub_id}` — source;
- `{sub_id1}` — внутренний click ID;
- `{target}` — исходная нормализованная ссылка.

Готовая ссылка обязана использовать HTTPS. Неизвестный placeholder или невалидный шаблон не ломают переход: ошибка логируется, после чего используется обычная ссылка билета.

## Отказоустойчивость

Ошибка записи клика не блокирует пользователя. Сервис логирует её и всё равно перенаправляет на билет. Если ticket ID больше не существует, redirect ведёт на главную Aviasales.

