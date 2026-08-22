# Деплой и эксплуатация

## Production topology

```text
Internet
   │
   ▼
Caddy :80/:443
   ├── /app, /api, /go → hot-ticket-web     127.0.0.1:8081
   └── остальные paths → hot-ticket-admin   127.0.0.1:8080

Telegram Bot API ◄──── hot-ticket-bot long polling

bot + web + admin + sync + backup ──► одна SQLite
```

## CI

GitHub Actions запускает для pull request и push в `main`:

```text
npm ci
npm run verify
```

`verify` включает:

- ESLint;
- TypeScript typecheck;
- Vitest;
- production build.

## CD

Push в `main` после успешного CI:

1. подключается к VDS по SSH;
2. вызывает только root-owned `/usr/local/sbin/hot-ticket-deploy <SHA>`;
3. проверяет точное совпадение SHA с `origin/main`;
4. принудительно приводит checkout к проверенному commit;
5. обновляет собственную root-owned копию deploy script;
6. выполняет `npm ci` и `npm run build`;
7. устанавливает systemd units и Caddyfile;
8. делает `systemctl daemon-reload`;
9. запускает sync на VDS;
10. перезапускает bot и web;
11. перезапускает admin, если он enabled;
12. reload Caddy и проверяет active services.

Локальные незакоммиченные и untracked-файлы внутри repository на VDS не сохраняются. Environment, SQLite, backups, `node_modules` и `dist` находятся в ignored paths и не удаляются `git clean -fd`.

## Первичная настройка

`deploy/scripts/setup-vds.sh`:

- поддерживает Ubuntu;
- устанавливает Node.js 24 и системные пакеты;
- создаёт `hotticket` и `deploy`;
- настраивает SSH/sudoers;
- устанавливает environment;
- устанавливает Caddy;
- устанавливает systemd и cron;
- запускает `npm ci` и полный `npm run verify`;
- опционально делает первый sync и запускает сервисы.

Ключевые варианты:

```bash
sudo ./deploy/scripts/setup-vds.sh --start
sudo ./deploy/scripts/setup-vds.sh --enable-admin
```

`--enable-admin` включает `--start`.

## Environment variables

### Обязательные

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API и Mini App auth |
| `AVIASALES_EXPLORE_BASE_URL` | HTTPS base URL Explore API |

### Storage и bot

| Переменная | Default |
|---|---|
| `DATABASE_PATH` | `./data/hot-ticket-bot.sqlite` |
| `TELEGRAM_POLL_TIMEOUT_SECONDS` | `50` |
| `TELEGRAM_UPDATE_MAX_ATTEMPTS` | `3` |
| `BACKUP_DIRECTORY` | `./backups` |

### Web и tracking

| Переменная | Default/правило |
|---|---|
| `PUBLIC_BASE_URL` | optional HTTPS |
| `WEB_HOST` | `127.0.0.1` |
| `WEB_PORT` | `8081` |
| `MINIAPP_AUTH_MAX_AGE_SECONDS` | `86400` (минимум одни сутки) |
| `CLICK_SIGNING_SECRET` | optional, минимум 32 символа |
| `AFFILIATE_MARKER` | optional |
| `AFFILIATE_LINK_TEMPLATE` | Aviasales search template |

### Admin

| Переменная | Назначение |
|---|---|
| `ADMIN_HOST` | default `127.0.0.1`, systemd принудительно loopback |
| `ADMIN_PORT` | default `8080` |
| `ADMIN_USERNAME` | обязателен для admin process |
| `ADMIN_PASSWORD` | обязателен для admin process |

## Cron

```text
*/10 * * * *  sync
30 3 * * *     backup
```

Время backup — системное время VDS. Sync использует `flock -n` и не ждёт завершения уже работающего cron sync.

## Проверки состояния

```bash
sudo systemctl status hot-ticket-bot hot-ticket-web hot-ticket-admin caddy --no-pager
sudo journalctl -u hot-ticket-bot -n 100 --no-pager
sudo journalctl -u hot-ticket-web -n 100 --no-pager
sudo journalctl -u hot-ticket-admin -n 100 --no-pager
curl -I https://ticket.crosfit.uz/app/
curl -I https://ticket.crosfit.uz/admin/
curl https://ticket.crosfit.uz/healthz
```

Ожидания:

- `/app/` — 200;
- `/admin/` без credentials — 401;
- `/healthz` — `ok`;
- Node-порты доступны только с VDS loopback.

## Ручной sync

```bash
sudo -u hotticket /bin/bash -c \
  'set -a; source /etc/hot-ticket-bot.env; cd /opt/hot-ticket-bot; /usr/bin/node dist/entries/sync.js'
```

Успешный типичный ответ:

```json
{"processedSources":1}
```

## Перезапуск

```bash
sudo systemctl restart hot-ticket-bot
sudo systemctl restart hot-ticket-web
sudo systemctl restart hot-ticket-admin
sudo systemctl reload caddy
```

В обычной работе эти команды выполняет CD; ручной запуск нужен только для диагностики или изменения production environment.

## Наблюдаемость

Приложение пишет структурированные JSON-события в stdout/stderr, которые собирает journald. Значимые события:

- ошибки Telegram polling/update;
- ошибки source sync;
- некорректные предложения Aviasales;
- отклонённые price observations;
- ошибки click logging/affiliate link;
- ошибки web/admin request;
- запуск web/admin process.
