# Безопасность

## Границы доступа

- Бот выполняет исходящие запросы к Telegram и не принимает webhook.
- Web и admin Node-процессы слушают только `127.0.0.1`.
- Публичные 80/443 принадлежат Caddy.
- Caddy получает TLS-сертификат и проксирует маршруты на соответствующий процесс.

## Mini App authentication

Frontend передаёт `Telegram.WebApp.initData` в `Authorization: tma ...`.

Сервер:

1. извлекает `hash`;
2. сортирует остальные параметры и строит data-check-string;
3. получает HMAC secret key из bot token по схеме Telegram WebApp;
4. сравнивает hash через timing-safe comparison;
5. проверяет `auth_date`;
6. извлекает Telegram user ID только из подписанного поля `user`.

initData действует минимум сутки: Telegram не обновляет его, пока Mini App остаётся открытым. При заданном меньшем значении сервис безопасно поднимает лимит до суток; более длинное значение допускается до 7 дней. Дата из будущего более чем на 30 секунд отклоняется.

## Admin authentication

`/admin/*` защищён Basic Auth. Username и password сравниваются timing-safe. Оба сравнения выполняются всегда, чтобы время ответа не показывало, какое поле неверно.

Basic Auth используется только поверх HTTPS через Caddy.

## Click signatures

Tracking URL подписан HMAC-SHA256 с секретом минимум 32 символа. В подпись входят ticket/source/user/subscription. Подпись сокращается до 16 байт и кодируется base64url.

Без корректной подписи `/go` возвращает 400 и не выполняет redirect на переданный пользователем URL.

## URL safety

- Aviasales ticket URL нормализуется доменными функциями;
- affiliate template обязан дать HTTPS URL;
- список placeholders ограничен;
- пользователь не передаёт конечный redirect target в `/go`;
- destination берётся из сохранённого ticket snapshot.

## HTTP hardening

Caddy добавляет:

- HSTS;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- удаление Server header;
- gzip/zstd.

Mini App получает CSP:

```text
default-src 'self'
script-src 'self' https://telegram.org
style-src 'self' 'unsafe-inline'
img-src 'self' data: https:
connect-src 'self'
```

Статические файлы Mini App не получают длительный browser cache, чтобы новая версия появлялась сразу после deployment.

## Rate limits

- 60 click redirects на IP в минуту;
- 120 API calls на Telegram user в минуту;
- JSON body ограничен 32 KB.

## systemd hardening

Все сервисы работают от системного пользователя `hotticket` и включают:

- `NoNewPrivileges=true`;
- `PrivateTmp=true`;
- `ProtectSystem=strict`;
- `ProtectHome=true`;
- защиту kernel/control groups;
- доступ на запись только к `data` и `backups`.

## Секреты

Production environment хранится в:

```text
/etc/hot-ticket-bot.env
```

Владелец `hotticket`, права `600`. Секреты не должны храниться в Git или `.env.example`.

Чувствительные переменные:

- `TELEGRAM_BOT_TOKEN`;
- `CLICK_SIGNING_SECRET`;
- `ADMIN_PASSWORD`;
- `AFFILIATE_MARKER`;
- SSH deploy key в GitHub Actions.

## Ограничение профиля

- Контакт принимается только от владельца Telegram ID.
- Mini App не возвращает телефон.
- Пользователь может изменять и отключать только собственные подписки.
