# HotTicketBot на VDS

Telegram-бот горячих авиабилетов Aviasales. Бот работает постоянным Node.js-процессом через long polling, хранит данные в локальном SQLite и запускает синхронизацию локальным cron каждые 10 минут.

Домен, webhook, Nginx, Telegram Serverless и внешний cron-сервис не нужны.

## Возможности

- `/start`, Telegram-профиль и проверка владельца контакта;
- просмотр, фильтрация и сортировка горячих билетов;
- подписки на направления, даты, цену, прямой рейс и багаж;
- максимум 20 активных подписок на пользователя;
- импорт всех активных `sync_sources`, начальный источник `TAS/UZS`;
- история цен, price-drop уведомления и защита от повторной отправки;
- SQLite WAL, sync locks, durable Telegram offset и автоматические миграции;
- ежедневные резервные копии с хранением семь дней.

## Требования

- Ubuntu VDS с 1 vCPU, 2 ГБ RAM и минимум 10 ГБ SSD;
- Node.js 24 LTS;
- обычный Telegram Bot API token из [@BotFather](https://t.me/BotFather);
- системные команды `systemd`, `cron` и `flock`.

На чистой Ubuntu установите системные зависимости и Node.js 24 из репозитория [NodeSource](https://github.com/nodesource/distributions):

```bash
sudo apt update
sudo apt install -y ca-certificates curl cron util-linux sqlite3
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup_24.sh
sudo -E bash /tmp/nodesource_setup_24.sh
sudo apt install -y nodejs
sudo apt install -y build-essential python3
```

Проверьте Node.js:

```bash
node --version
npm --version
command -v node
```

Ожидается Node.js `v24.x`. Готовый systemd unit использует `/usr/bin/node`. Если `command -v node` показывает другой путь, замените `ExecStart` в unit и пути Node в cron-файле.

## Локальная проверка проекта

```bash
npm ci
npm run verify
```

`verify` последовательно запускает ESLint, strict TypeScript, все тесты и production build. Результат создаётся в `dist/`.

## 1. Создание пользователя и каталога на VDS

```bash
sudo useradd --system --user-group --home-dir /opt/hot-ticket-bot --create-home --shell /usr/sbin/nologin hotticket
sudo mkdir -p /opt/hot-ticket-bot/data /opt/hot-ticket-bot/backups
sudo chown -R hotticket:hotticket /opt/hot-ticket-bot
sudo chmod 750 /opt/hot-ticket-bot /opt/hot-ticket-bot/data /opt/hot-ticket-bot/backups
```

Скопируйте репозиторий в `/opt/hot-ticket-bot`. Можно использовать `git clone`, `rsync` или `scp`. После копирования:

```bash
sudo chown -R hotticket:hotticket /opt/hot-ticket-bot
cd /opt/hot-ticket-bot
sudo -u hotticket npm ci
sudo -u hotticket npm run verify
```

## 2. Получение Telegram token

Откройте [@BotFather](https://t.me/BotFather):

1. `/mybots`;
2. выберите `@hot_ticket_buy_bot`;
3. нажмите `API Token`;
4. скопируйте token.

Это обычный Bot API token. Никому его не отправляйте и не добавляйте в Git.

## 3. Настройка environment

```bash
sudo install -o hotticket -g hotticket -m 600 /opt/hot-ticket-bot/.env.example /etc/hot-ticket-bot.env
sudoedit /etc/hot-ticket-bot.env
```

Production-значения:

```dotenv
TELEGRAM_BOT_TOKEN=вставьте-token-из-BotFather
DATABASE_PATH=/opt/hot-ticket-bot/data/hot-ticket-bot.sqlite
BACKUP_DIRECTORY=/opt/hot-ticket-bot/backups
AVIASALES_EXPLORE_BASE_URL=https://explore-api.aviasales.com
TELEGRAM_POLL_TIMEOUT_SECONDS=50
TELEGRAM_UPDATE_MAX_ATTEMPTS=3
```

Проверьте права, не печатая содержимое файла:

```bash
sudo stat -c '%U %G %a %n' /etc/hot-ticket-bot.env
```

Ожидается:

```text
hotticket hotticket 600 /etc/hot-ticket-bot.env
```

## 4. Установка systemd service

```bash
sudo install -o root -g root -m 644 deploy/systemd/hot-ticket-bot.service /etc/systemd/system/hot-ticket-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now hot-ticket-bot
```

При старте приложение:

1. проверяет environment;
2. открывает SQLite и применяет миграции;
3. отключает старый Telegram webhook без удаления ожидающих updates;
4. запускает long polling.

Проверка:

```bash
sudo systemctl status hot-ticket-bot --no-pager
sudo journalctl -u hot-ticket-bot -n 100 --no-pager
```

## 5. Первый ручной sync

```bash
sudo -u hotticket /bin/bash -c 'set -a; source /etc/hot-ticket-bot.env; cd /opt/hot-ticket-bot; /usr/bin/node dist/entries/sync.js'
```

Успешный результат:

```json
{"processedSources":1}
```

Команда создаёт `TAS/UZS`, загружает предложения Aviasales и сохраняет их в SQLite.

## 6. Установка локального cron

```bash
sudo install -o root -g root -m 644 deploy/cron/hot-ticket-bot /etc/cron.d/hot-ticket-bot
sudo systemctl restart cron
```

Расписание:

- sync каждые 10 минут;
- SQLite backup ежедневно в 03:30 по системному времени VDS;
- `flock` не позволяет двум sync-процессам работать одновременно;
- managed backups старше семи дней удаляются автоматически.

Проверка cron:

```bash
sudo cat /etc/cron.d/hot-ticket-bot
sudo journalctl -u cron -n 100 --no-pager
```

## 7. Проверка Telegram-бота

Откройте `@hot_ticket_buy_bot` и отправьте:

```text
/start
```

Далее отправьте собственный контакт, откройте горячие билеты и создайте тестовую подписку.

## Управление процессом

```bash
sudo systemctl status hot-ticket-bot --no-pager
sudo systemctl restart hot-ticket-bot
sudo systemctl stop hot-ticket-bot
sudo systemctl start hot-ticket-bot
sudo journalctl -u hot-ticket-bot -f
```

## Ручные команды проекта

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify
npm start
npm run sync
npm run backup
```

Локальные `start`, `sync` и `backup` читают `.env`, если он существует. На VDS systemd и cron читают `/etc/hot-ticket-bot.env`.

## Обновление приложения

```bash
sudo systemctl stop hot-ticket-bot
cd /opt/hot-ticket-bot
sudo -u hotticket git pull --ff-only
sudo -u hotticket npm ci
sudo -u hotticket npm run verify
sudo systemctl start hot-ticket-bot
sudo systemctl status hot-ticket-bot --no-pager
```

Если проект копируется без Git, замените только исходники, `migrations`, `deploy`, `package.json` и `package-lock.json`, затем повторите `npm ci`, `npm run verify` и restart.

## Backup и восстановление

Создать копию вручную:

```bash
sudo -u hotticket /bin/bash -c 'set -a; source /etc/hot-ticket-bot.env; cd /opt/hot-ticket-bot; /usr/bin/node dist/entries/backup.js'
```

Перед восстановлением временно отключите cron-файл и остановите бот:

```bash
sudo mv /etc/cron.d/hot-ticket-bot /etc/cron.d/hot-ticket-bot.disabled
sudo systemctl stop hot-ticket-bot
sudo -u hotticket /bin/bash -c 'cd /opt/hot-ticket-bot/data; test ! -e hot-ticket-bot.sqlite || mv hot-ticket-bot.sqlite hot-ticket-bot.sqlite.before-restore; test ! -e hot-ticket-bot.sqlite-wal || mv hot-ticket-bot.sqlite-wal hot-ticket-bot.sqlite-wal.before-restore; test ! -e hot-ticket-bot.sqlite-shm || mv hot-ticket-bot.sqlite-shm hot-ticket-bot.sqlite-shm.before-restore'
sudo install -o hotticket -g hotticket -m 600 /opt/hot-ticket-bot/backups/hot-ticket-bot-YYYYMMDDTHHMMSSZ.sqlite /opt/hot-ticket-bot/data/hot-ticket-bot.sqlite
sudo systemctl start hot-ticket-bot
sudo mv /etc/cron.d/hot-ticket-bot.disabled /etc/cron.d/hot-ticket-bot
```

Подставьте точное существующее имя backup-файла вместо примера. Перед production-восстановлением рекомендуется проверить копию отдельной командой `sqlite3 <backup-file> 'PRAGMA integrity_check;'`.

## Диагностика

Если бот не отвечает:

```bash
sudo systemctl status hot-ticket-bot --no-pager
sudo journalctl -u hot-ticket-bot -n 200 --no-pager
sudo -u hotticket test -r /etc/hot-ticket-bot.env
sudo -u hotticket test -w /opt/hot-ticket-bot/data
```

Если sync не создаёт билеты, запустите ручную команду из раздела «Первый ручной sync» и проверьте `sync_runs` в SQLite. Ошибка одной пары source не останавливает обработку остальных пар.
# hot-ticket-telegram-bot
