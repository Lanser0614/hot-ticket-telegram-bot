# Hot Ticket

Hot Ticket — сервис поиска и отслеживания авиабилетов из городов Узбекистана. Telegram-бот доставляет уведомления и предоставляет быстрые действия, Mini App показывает Hot Deals, Watchlist и историю цен, а административная панель — продуктовую статистику.

Все компоненты работают с одной SQLite-базой. Каталог синхронизируется с Aviasales Explore API каждые 10 минут, а уведомления отправляются при появлении нового подходящего билета или снижении цены.

Production URL задаётся переменной `PUBLIC_BASE_URL`, например `https://tickets.example.com`.

Бот использует исходящий Telegram long polling, а расписание sync и backup устанавливается локально на VDS. Webhook, Nginx, Telegram Serverless и внешний cron-сервис не нужны.

Основная идея продукта:

> Не заставлять пользователя постоянно искать дешёвые билеты, а сообщать ему, когда подходящее предложение появится.

## Возможности

- Telegram-бот с каталогом, поиском по названию/IATA, профилем и пошаговым созданием уведомлений;
- Telegram Mini App с Hot Deals, фильтрами, сортировками, карточкой билета, Watchlist и профилем;
- общие пользовательские настройки и подписки для бота и Mini App;
- onboarding с выбором русского/узбекского языка и города вылета в Узбекистане;
- подписки на направление или `ANY`, диапазон дат, максимальную цену, прямой рейс и поездку туда-обратно;
- максимум 20 активных подписок на пользователя;
- уведомления о новых билетах и снижении цены с защитой от повторной отправки;
- почасовая и дневная история цен маршрута, тренд и Deal Score после накопления достаточных данных;
- подписанные tracking-ссылки, партнёрский marker и статистика человеческих переходов;
- административная панель со статистикой пользователей, цен, кликов, билетов и запуском sync;
- SQLite WAL, автоматические миграции, sync locks, durable Telegram offset и кэш направлений;
- автоматический CI/CD, HTTPS через Caddy и ежедневные резервные копии с хранением семь дней.

Текущие продуктовые ограничения: origin выбирается только среди городов Узбекистана, валюта зафиксирована как `UZS`, а каталог строится по Aviasales Explore Hot Offers, а не по live-поиску всех авиакомпаний.

## Документация

Подробное описание архитектуры и всех реализованных функций находится в [`docs/features`](./docs/features/README.md):

- [обзор проекта и архитектура](./docs/features/01-project-overview.md);
- [Telegram-бот](./docs/features/02-telegram-bot.md);
- [поиск билетов](./docs/features/03-ticket-search.md);
- [Watchlist и уведомления](./docs/features/04-watchlist-and-notifications.md);
- [Mini App](./docs/features/05-mini-app.md);
- [история цен и Deal Score](./docs/features/06-price-history-and-deal-score.md);
- [клики и партнёрские ссылки](./docs/features/07-click-tracking.md);
- [административная панель](./docs/features/08-admin-dashboard.md);
- [синхронизация, API, БД, безопасность и эксплуатация](./docs/features/README.md#содержание).

## Компоненты

| Компонент | Процесс | Назначение |
|---|---|---|
| Telegram Bot | `hot-ticket-bot.service` | Long polling, команды и уведомления |
| Mini App API | `hot-ticket-web.service` | `/app`, `/api/v1`, `/go` |
| Admin | `hot-ticket-admin.service` | Dashboard и ручной sync |
| Sync | cron/CD/ручной entry | Загрузка билетов и расчёт истории |
| Backup | cron/ручной entry | Безопасная копия SQLite |

## Требования

- Ubuntu VDS с 1 vCPU, 2 ГБ RAM и минимум 10 ГБ SSD;
- Node.js 24 LTS;
- обычный Telegram Bot API token из [@BotFather](https://t.me/BotFather);
- домен, направленный на VDS, для Telegram Mini App и HTTPS;
- системные команды `systemd`, `cron`, `flock` и Caddy.

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

## GitHub Actions: CI/CD

Workflow `.github/workflows/ci-cd.yml` запускает `npm ci` и `npm run verify` для
каждого pull request и push в `main`. После успешного CI push в `main`
автоматически разворачивается на VDS через SSH.

CD намеренно вызывает на сервере только root-owned скрипт
`/usr/local/sbin/hot-ticket-deploy`. Скрипт принимает только точный SHA текущего
`origin/main`, принудительно приводит tracked-файлы рабочей копии к этому commit,
удаляет untracked-файлы, устанавливает зависимости, собирает приложение,
запускает sync, перезапускает bot и Mini App web services, а также admin
service, если он включён. Перед fetch скрипт восстанавливает владельца рабочей копии
`hotticket:hotticket`, если обнаруживает файлы другого владельца, а после
checkout обновляет собственную root-owned копию. Локальные изменения внутри
Git-репозитория на VDS при deployment удаляются. Игнорируемые `.env`, `data`,
`backups`, `node_modules` и `dist` команда `git clean -fd` не затрагивает;
production environment по-прежнему хранится в `/etc/hot-ticket-bot.env`.

Не запускайте `git pull`, `git fetch` или другие изменяющие Git-команды в этом
каталоге от `root`: используйте `sudo -u hotticket git -C /opt/hot-ticket-bot ...`.
Если старый deploy-скрипт уже завершился с `insufficient permission for adding
an object to repository database .git/objects`, один раз восстановите владельца
и повторно запустите job:

```bash
sudo chown -R hotticket:hotticket /opt/hot-ticket-bot
sudo -u hotticket test -w /opt/hot-ticket-bot/.git/objects
```

После первого успешного deployment с новой версией установите обновлённый
скрипт вручную; далее он будет обновлять себя автоматически:

```bash
sudo install -o root -g root -m 755 \
  /opt/hot-ticket-bot/deploy/scripts/hot-ticket-deploy \
  /usr/local/sbin/hot-ticket-deploy
sudo bash -n /usr/local/sbin/hot-ticket-deploy
```

Один раз подготовьте VDS после клонирования репозитория:

```bash
sudo apt install -y git openssh-server
sudo adduser --disabled-password --gecos '' deploy
sudo install -o root -g root -m 755 deploy/scripts/hot-ticket-deploy /usr/local/sbin/hot-ticket-deploy
echo 'deploy ALL=(root) NOPASSWD: /usr/local/sbin/hot-ticket-deploy *' | sudo tee /etc/sudoers.d/hot-ticket-deploy >/dev/null
sudo chmod 440 /etc/sudoers.d/hot-ticket-deploy
sudo visudo -cf /etc/sudoers.d/hot-ticket-deploy
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudoedit /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

В `authorized_keys` добавьте публичную часть отдельного deploy key. Приватную
часть сохраните в GitHub, в `Settings → Secrets and variables → Actions`.

Создайте environment `production` и добавьте secrets:

- `VDS_HOST` — IP-адрес или hostname VDS;
- `VDS_SSH_USER` — `deploy`;
- `VDS_SSH_PRIVATE_KEY` — приватный SSH-ключ;
- `VDS_KNOWN_HOSTS` — заранее проверенная строка host key сервера.

Если SSH работает не на порту 22, добавьте environment variable
`VDS_SSH_PORT`. Строку для `VDS_KNOWN_HOSTS` можно получить командой
`ssh-keyscan -H -p 22 <IP-сервера>`, но перед сохранением обязательно сверьте
fingerprint с ключом непосредственно на VDS.

Пользователь `hotticket` должен иметь доступ к `origin` для `git fetch`. Для
приватного репозитория настройте на VDS отдельный read-only GitHub deploy key в
home-каталоге `/opt/hot-ticket-bot`.

### Автоматическая настройка нового VDS

Для переноса на новый сервер используйте идемпотентный bootstrap-скрипт
`deploy/scripts/setup-vds.sh`. Сначала скопируйте или клонируйте Git-репозиторий
в `/opt/hot-ticket-bot`, а также передайте на сервер публичный ключ пользователя
`deploy` и production environment-файл. Затем выполните:

```bash
cd /opt/hot-ticket-bot
sudo ./deploy/scripts/setup-vds.sh \
  --deploy-public-key-file /tmp/hot-ticket-github-actions.pub \
  --environment-file /tmp/hot-ticket-bot.env \
  --start
```

Скрипт:

- устанавливает Ubuntu-пакеты и Node.js 24;
- создаёт или переиспользует пользователей `hotticket` и `deploy`;
- настраивает каталоги, SSH `authorized_keys`, sudoers, systemd и cron;
- устанавливает `/etc/hot-ticket-bot.env` с правами `600`;
- запускает `npm ci`, полный `npm run verify`, первый sync, bot и Mini App web service;
- при `--enable-admin` включает отдельный admin service.

Для запуска опциональной admin-панели добавьте `--enable-admin`. Без `--start`
скрипт подготовит и проверит сервер, но не установит cron и не запустит сервисы.
При повторном запуске существующий `/etc/hot-ticket-bot.env` и SSH-ключи
сохраняются, если соответствующие файлы не переданы через параметры.

Посмотреть все параметры:

```bash
sudo ./deploy/scripts/setup-vds.sh --help
```

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
2. выберите своего бота, например `@your_hot_ticket_bot`;
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
TELEGRAM_BOT_TOKEN=<BOTFATHER_TOKEN>
TELEGRAM_BOT_USERNAME=<BOT_USERNAME_WITHOUT_AT>
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
{"processedSources":11}
```

Команда создаёт источники `UZS` для поддерживаемых городов Узбекистана
(`TAS`, `SKD`, `BHK`, `FEG`, `NMA`, `NCU`, `UGC`, `TMJ`, `KSQ`, `AZN`, `NVI`)
и сохраняет полный каталог для каждого origin. Класс и багаж
синхронизируются вместе с билетом, но не передаются как API-фильтры.

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

Откройте своего бота, например `@your_hot_ticket_bot`, и отправьте:

```text
/start
```

При первом входе выберите язык, затем один из городов Узбекистана как origin. Позже язык и город можно изменить в профиле Mini App.
Далее:

1. Нажмите `🔥 Горящие билеты` или отправьте `/tickets`.
2. Введите `Стамбул`/`Istanbul`/`IST` либо нажмите `🌍 Все направления`.
3. Используйте `➡️ Показать ещё`, чтобы пройти весь подходящий каталог.
4. Откройте `/settings`, чтобы изменить origin, класс и требование багажа.
5. Создайте тестовое уведомление. Оно использует выбранный при onboarding origin и валюту `UZS`.

Команда `/tickets IST` сразу открывает первую страницу выбранного направления.
Текущие настройки класса и багажа одинаково применяются к каталогу и ко всем
активным уведомлениям; после изменения настроек пересоздавать подписки не нужно.

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
sudo -u hotticket /bin/bash -c 'set -a; source /etc/hot-ticket-bot.env; cd /opt/hot-ticket-bot; /usr/bin/node dist/entries/sync.js'
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

Если sync не создаёт билеты, запустите ручную команду из раздела «Первый ручной sync» и проверьте `sync_runs` в SQLite. Миграции автоматически применяются как при старте бота, так и при ручном sync.

## Админ-панель (опционально)

Отдельный веб-сервис `dist/entries/admin.js` предоставляет полноценный dashboard с разделами «Обзор», «Пользователи», «Цены», «Переходы» и «Билеты». Панель показывает статистику регистраций, подписок, активного каталога, накопленной истории цен и человеческих кликов, а также позволяет вручную запустить тот же sync job, который используется cron и CD. Это независимый процесс: основной бот по-прежнему работает без входящего HTTP.

Панель защищена HTTP Basic Auth и доступна только через HTTPS. Задайте
переменные в `/etc/hot-ticket-bot.env`:

```dotenv
ADMIN_HOST=127.0.0.1
ADMIN_PORT=8080
ADMIN_USERNAME=<ADMIN_USERNAME>
ADMIN_PASSWORD=<STRONG_RANDOM_PASSWORD>
```

Systemd unit принудительно оставляет Node.js на `127.0.0.1:8080`, даже если в
старом production environment сохранились публичные `ADMIN_HOST` или
`ADMIN_PORT`. Caddy занимает порты 80 и 443, автоматически получает и
продлевает сертификат, перенаправляет HTTP на HTTPS и проксирует админку.
Переход на `/` перенаправляет браузер в защищённый раздел `/admin/`.

Маршруты `/app/*`, `/api/*` и `/go/*` обслуживает Mini App web service на
`127.0.0.1:8081`.

## Telegram Mini App

Mini App доступен по адресу `${PUBLIC_BASE_URL}/app/`, например `https://tickets.example.com/app/`. Он предоставляет Hot Deals с фильтрами и сортировками, детальную карточку билета, 7/30/90-дневную историю маршрута, Deal Score, Watchlist и настройки профиля. Интерфейс и бот используют одну SQLite, поэтому подписки и пользовательские настройки не дублируются. Web service предоставляет API под `/api/v1/*`, а `/go/*` записывает переход и перенаправляет пользователя на Aviasales.

Добавьте в `/etc/hot-ticket-bot.env`:

```dotenv
PUBLIC_BASE_URL=https://tickets.example.com
TELEGRAM_BOT_USERNAME=<BOT_USERNAME_WITHOUT_AT>
WEB_HOST=127.0.0.1
WEB_PORT=8081
CLICK_SIGNING_SECRET=<RANDOM_SECRET_AT_LEAST_32_CHARACTERS>
AFFILIATE_MARKER=
AFFILIATE_LINK_TEMPLATE=https://www.aviasales.uz/search/{search_code}?marker={marker}&sub_id={sub_id}&sub_id1={sub_id1}
MINIAPP_AUTH_MAX_AGE_SECONDS=86400
```

`TELEGRAM_BOT_USERNAME` включает персональные deep links для shared-билетов и
реферальную атрибуцию. Если переменная не задана, каталог и покупка продолжают
работать, но Mini App использует обычный share без реферального payload.

Уведомления сначала попадают в устойчивую SQLite-очередь. Мгновенная доставка
ограничена тремя сообщениями в локальные сутки, quiet hours сохраняют лучший
билет по подписке, а включённый утренний дайджест отправляется после 09:00 по
`Asia/Tashkent` во время очередного cron sync.

Секрет можно сгенерировать непосредственно на VDS, не печатая его в чат:

```bash
openssl rand -hex 32
```

`AFFILIATE_MARKER` можно оставить пустым: внутренний click tracking продолжит
работать, а редирект поведёт на чистую ссылку Aviasales. После получения маркера
вставьте его в environment и перезапустите `hot-ticket-web` и
`hot-ticket-bot`.

Mini App проверяет подпись `Telegram.WebApp.initData` на сервере. Значения
`user.id`, присланные обычным JSON-полем, не используются.

После deployment установите systemd unit и запустите сервис:

```bash
sudo install -m 644 deploy/systemd/hot-ticket-web.service /etc/systemd/system/hot-ticket-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now hot-ticket-web
sudo systemctl status hot-ticket-web --no-pager
```

Затем откройте `@BotFather`, выберите бота и настройте Menu Button с URL
`${PUBLIC_BASE_URL}/app/`, например `https://tickets.example.com/app/`. Кнопка Mini App также появится в
клавиатуре после `/start`, если `PUBLIC_BASE_URL` задан.

Установите Caddy и конфигурацию повторным запуском bootstrap-скрипта:

```bash
cd /opt/hot-ticket-bot
sudo ./deploy/scripts/setup-vds.sh --enable-admin
```

Если на VDS включён firewall (`ufw`/`iptables`), откройте HTTP и HTTPS:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Проверьте конфигурацию и сертификат:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl status caddy hot-ticket-admin --no-pager
curl -I http://tickets.example.com/
curl -I https://tickets.example.com/admin/
```

Первый запрос должен перенаправляться на HTTPS, второй — отвечать `401` с
заголовком `WWW-Authenticate`, пока логин и пароль не переданы. Liveness-проверка
доступна без авторизации на `${PUBLIC_BASE_URL}/healthz`.
