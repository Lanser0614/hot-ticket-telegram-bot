# HTTP API Mini App

## Базовый путь и авторизация

API доступен под:

```text
/api/v1
```

Каждый запрос должен содержать:

```http
Authorization: tma <Telegram.WebApp.initData>
```

Сервер сам проверяет HMAC Telegram и извлекает user ID. Пользовательский ID из JSON body не принимается как источник авторизации.

Ответы API имеют `Cache-Control: no-store`.

## GET `/api/v1/deals`

Получение Hot Deals.

Query parameters:

| Параметр | Описание |
|---|---|
| `destination` | IATA или отсутствует для всех направлений |
| `date_from` | Начальная дата |
| `date_to` | Конечная дата |
| `max_price` | Положительная integer price |
| `direct` | `1`/`true` |
| `baggage` | `1`/`true` |
| `sort` | `best`, `cheapest`, `recent`, `departing_soon` |
| `limit` | По умолчанию 20, максимум 50 |
| `cursor` | Base64url cursor |

Ответ:

```json
{
  "items": [],
  "nextCursor": null
}
```

Каждый item содержит маршрут, даты, цену, свойства рейса, Deal Score и signed `openUrl`.

## GET `/api/v1/tickets/:ticketId`

Возвращает активный билет с Deal Score и tracking URL. Неактивный или отсутствующий билет возвращает validation error.

## GET `/api/v1/routes/:origin/:destination/history`

Query `days` поддерживает 7, 30 или 90. Любое другое значение нормализуется до 30.

Ответ:

```json
{
  "items": [
    {
      "day": "2026-08-21",
      "minPrice": 1480000,
      "averagePrice": 1720000,
      "medianPrice": 1690000,
      "maxPrice": 2110000,
      "sampleCount": 34
    }
  ]
}
```

## GET `/api/v1/destinations`

Возвращает доступные направления для текущего класса и багажа пользователя.

## GET `/api/v1/subscriptions`

Возвращает подписки текущего пользователя.

## POST `/api/v1/subscriptions`

Body:

```json
{
  "destinationCode": "IST",
  "departureDateFrom": "2026-09-01",
  "departureDateTo": "2026-09-30",
  "maxPrice": 1700000,
  "directOnly": true,
  "roundTripOnly": false,
  "baggageRequired": true
}
```

`destinationCode` и `maxPrice` могут быть `null`. Успешный ответ — HTTP 201.

`baggageRequired` сохраняется для совместимости и отображения формы, но сейчас не является самостоятельным фильтром уведомлений. Реальное требование багажа для всех подписок пользователя определяется полем `baggageRequired` его профиля, которое изменяется через `PATCH /api/v1/me`.

## DELETE `/api/v1/subscriptions/:subscriptionId`

Деактивирует собственную подписку. Успех — HTTP 204, отсутствие/чужая подписка — 404.

## GET `/api/v1/me`

Возвращает безопасную часть профиля:

- Telegram user ID;
- first name;
- username;
- preferred trip class;
- baggage required.

Телефон API не возвращает.

## PATCH `/api/v1/me`

Body:

```json
{
  "preferredTripClass": "economy",
  "baggageRequired": false
}
```

## Ошибки

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Описание ошибки"
  }
}
```

Основные статусы:

- 400 — невалидный input;
- 401 — Telegram auth или пользователь не выполнил `/start`;
- 404 — подписка не найдена;
- 429 — rate limit;
- 500 — внутренняя ошибка.

## Другие web routes

| Route | Назначение |
|---|---|
| `/app` | Redirect на `/app/` |
| `/app/*` | Статические файлы Mini App |
| `/go/:ticketId` | Signed click tracking и redirect |
| `/healthz` | Liveness `ok` |
