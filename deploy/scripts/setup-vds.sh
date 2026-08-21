#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_USER='hotticket'
readonly APP_DIRECTORY='/opt/hot-ticket-bot'
readonly DEPLOY_USER='deploy'
readonly ENVIRONMENT_FILE='/etc/hot-ticket-bot.env'
readonly DEPLOY_COMMAND='/usr/local/sbin/hot-ticket-deploy'
readonly SUDOERS_FILE='/etc/sudoers.d/hot-ticket-deploy'
readonly BOT_SERVICE='hot-ticket-bot.service'
readonly ADMIN_SERVICE='hot-ticket-admin.service'
readonly WEB_SERVICE='hot-ticket-web.service'
readonly CADDY_SERVICE='caddy.service'

DEPLOY_PUBLIC_KEY_FILE=''
ENVIRONMENT_SOURCE=''
START_SERVICES=false
ENABLE_ADMIN=false

usage() {
  cat <<'EOF'
Usage:
  sudo ./deploy/scripts/setup-vds.sh [options]

Options:
  --deploy-public-key-file PATH  Public SSH key for the deploy user. Required
                                 only when authorized_keys is currently empty.
  --environment-file PATH        Production environment file to install.
                                 Existing /etc/hot-ticket-bot.env is preserved
                                 when this option is omitted.
  --start                         Run initial sync, enable cron and start bot.
  --enable-admin                  Enable and start the optional admin service.
                                 Implies --start.
  -h, --help                      Show this help.
EOF
}

log() {
  printf '\n==> %s\n' "$1"
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --deploy-public-key-file)
      (($# >= 2)) || die '--deploy-public-key-file requires a path.'
      DEPLOY_PUBLIC_KEY_FILE="$2"
      shift 2
      ;;
    --environment-file)
      (($# >= 2)) || die '--environment-file requires a path.'
      ENVIRONMENT_SOURCE="$2"
      shift 2
      ;;
    --start)
      START_SERVICES=true
      shift
      ;;
    --enable-admin)
      ENABLE_ADMIN=true
      START_SERVICES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die 'run this script as root.'
[[ -r /etc/os-release ]] || die '/etc/os-release is missing.'

# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == 'ubuntu' ]] || die 'only Ubuntu is supported.'

[[ -f "$APP_DIRECTORY/package.json" ]] || die "$APP_DIRECTORY does not contain the project."
[[ -d "$APP_DIRECTORY/.git" ]] || die "$APP_DIRECTORY must be a Git checkout for automatic deployment."

if [[ -n "$DEPLOY_PUBLIC_KEY_FILE" ]]; then
  [[ -r "$DEPLOY_PUBLIC_KEY_FILE" ]] || die "cannot read $DEPLOY_PUBLIC_KEY_FILE."
fi

if [[ -n "$ENVIRONMENT_SOURCE" ]]; then
  [[ -r "$ENVIRONMENT_SOURCE" ]] || die "cannot read $ENVIRONMENT_SOURCE."
fi

readonly TEMP_DIRECTORY="$(mktemp -d /tmp/hot-ticket-vds-setup.XXXXXX)"
cleanup() {
  rm -rf -- "$TEMP_DIRECTORY"
}
trap cleanup EXIT
trap 'printf "Setup failed at line %s.\n" "$LINENO" >&2' ERR

log 'Installing Ubuntu packages'
/usr/bin/apt-get update
/usr/bin/apt-get install -y \
  build-essential \
  apt-transport-https \
  ca-certificates \
  cron \
  curl \
  debian-archive-keyring \
  debian-keyring \
  git \
  gnupg \
  openssh-server \
  python3 \
  sqlite3 \
  sudo \
  util-linux

NODE_MAJOR=''
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
fi

if [[ "$NODE_MAJOR" != '24' || ! -x /usr/bin/node || ! -x /usr/bin/npm ]]; then
  log 'Installing Node.js 24 from NodeSource'
  /usr/bin/curl -fsSL \
    https://deb.nodesource.com/setup_24.x \
    -o "$TEMP_DIRECTORY/nodesource_setup_24.sh"
  /usr/bin/bash "$TEMP_DIRECTORY/nodesource_setup_24.sh"
  /usr/bin/apt-get install -y nodejs
fi

[[ "$(/usr/bin/node --version)" == v24.* ]] || die 'Node.js 24 was not installed.'
[[ -x /usr/bin/npm ]] || die '/usr/bin/npm is missing.'

if [[ -n "$DEPLOY_PUBLIC_KEY_FILE" ]]; then
  /usr/bin/ssh-keygen -lf "$DEPLOY_PUBLIC_KEY_FILE" >/dev/null || die 'invalid deploy public key.'
fi

log 'Creating service accounts and directories'
if ! id "$APP_USER" >/dev/null 2>&1; then
  /usr/sbin/useradd \
    --system \
    --user-group \
    --home-dir "$APP_DIRECTORY" \
    --no-create-home \
    --shell /usr/sbin/nologin \
    "$APP_USER"
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  /usr/sbin/useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

readonly APP_GROUP="$(id -gn "$APP_USER")"
readonly DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"

/usr/bin/install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 \
  "$APP_DIRECTORY/data" \
  "$APP_DIRECTORY/backups"
/usr/bin/chown -R "$APP_USER:$APP_GROUP" "$APP_DIRECTORY"
/usr/bin/chmod 750 "$APP_DIRECTORY" "$APP_DIRECTORY/data" "$APP_DIRECTORY/backups"

readonly DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
[[ -n "$DEPLOY_HOME" ]] || die "cannot determine the home directory for $DEPLOY_USER."
/usr/bin/install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 700 "$DEPLOY_HOME/.ssh"
/usr/bin/touch "$DEPLOY_HOME/.ssh/authorized_keys"
/usr/bin/chown "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_HOME/.ssh/authorized_keys"
/usr/bin/chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"

if [[ -n "$DEPLOY_PUBLIC_KEY_FILE" ]]; then
  readonly DEPLOY_PUBLIC_KEY="$(head -n 1 "$DEPLOY_PUBLIC_KEY_FILE")"
  if ! grep -qxF -- "$DEPLOY_PUBLIC_KEY" "$DEPLOY_HOME/.ssh/authorized_keys"; then
    printf '%s\n' "$DEPLOY_PUBLIC_KEY" >> "$DEPLOY_HOME/.ssh/authorized_keys"
  fi
fi

[[ -s "$DEPLOY_HOME/.ssh/authorized_keys" ]] || die \
  'deploy authorized_keys is empty; pass --deploy-public-key-file.'

log 'Installing environment and deployment configuration'
if [[ -n "$ENVIRONMENT_SOURCE" ]]; then
  /usr/bin/install -o "$APP_USER" -g "$APP_GROUP" -m 600 \
    "$ENVIRONMENT_SOURCE" "$ENVIRONMENT_FILE"
elif [[ ! -e "$ENVIRONMENT_FILE" ]]; then
  /usr/bin/install -o "$APP_USER" -g "$APP_GROUP" -m 600 \
    "$APP_DIRECTORY/.env.example" "$ENVIRONMENT_FILE"
fi

/usr/bin/chown "$APP_USER:$APP_GROUP" "$ENVIRONMENT_FILE"
/usr/bin/chmod 600 "$ENVIRONMENT_FILE"

/usr/bin/install -o root -g root -m 755 \
  "$APP_DIRECTORY/deploy/scripts/hot-ticket-deploy" "$DEPLOY_COMMAND"

printf '%s\n' \
  "$DEPLOY_USER ALL=(root) NOPASSWD: $DEPLOY_COMMAND *" \
  > "$TEMP_DIRECTORY/hot-ticket-deploy.sudoers"
/usr/sbin/visudo -cf "$TEMP_DIRECTORY/hot-ticket-deploy.sudoers"
/usr/bin/install -o root -g root -m 440 \
  "$TEMP_DIRECTORY/hot-ticket-deploy.sudoers" "$SUDOERS_FILE"

/usr/bin/install -o root -g root -m 644 \
  "$APP_DIRECTORY/deploy/systemd/hot-ticket-bot.service" \
  "/etc/systemd/system/$BOT_SERVICE"
/usr/bin/install -o root -g root -m 644 \
  "$APP_DIRECTORY/deploy/systemd/hot-ticket-admin.service" \
  "/etc/systemd/system/$ADMIN_SERVICE"
/usr/bin/install -o root -g root -m 644 \
  "$APP_DIRECTORY/deploy/systemd/hot-ticket-web.service" \
  "/etc/systemd/system/$WEB_SERVICE"

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable ssh cron
/usr/bin/systemctl restart cron

# An older installation may still have the admin process bound to public port 80.
# Restart it with the hardened unit before Caddy attempts to claim ports 80 and 443.
if /usr/bin/systemctl is-active --quiet "$ADMIN_SERVICE"; then
  /usr/bin/systemctl restart "$ADMIN_SERVICE"
fi

if ! command -v caddy >/dev/null 2>&1; then
  log 'Installing Caddy from the official stable repository'
  /usr/bin/curl -1sLf \
    https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    -o "$TEMP_DIRECTORY/caddy-stable.gpg.key"
  /usr/bin/gpg --dearmor --batch --yes \
    -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    "$TEMP_DIRECTORY/caddy-stable.gpg.key"
  /usr/bin/curl -1sLf \
    https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    -o /etc/apt/sources.list.d/caddy-stable.list
  /usr/bin/chmod o+r \
    /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    /etc/apt/sources.list.d/caddy-stable.list
  /usr/bin/apt-get update
  /usr/bin/apt-get install -y caddy
fi

log 'Configuring automatic HTTPS for ticket.crosfit.uz'
/usr/bin/caddy validate \
  --config "$APP_DIRECTORY/deploy/caddy/Caddyfile" \
  --adapter caddyfile
/usr/bin/install -o root -g root -m 644 \
  "$APP_DIRECTORY/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
/usr/bin/systemctl enable "$CADDY_SERVICE"
/usr/bin/systemctl restart "$CADDY_SERVICE"
/usr/bin/systemctl is-active --quiet "$CADDY_SERVICE"

log 'Installing dependencies and verifying the application'
/usr/sbin/runuser --user "$APP_USER" -- /usr/bin/npm --prefix "$APP_DIRECTORY" ci
/usr/sbin/runuser --user "$APP_USER" -- /usr/bin/npm --prefix "$APP_DIRECTORY" run verify

if [[ "$START_SERVICES" == true ]]; then
  grep -Eq '^TELEGRAM_BOT_TOKEN=.+$' "$ENVIRONMENT_FILE" || die \
    "$ENVIRONMENT_FILE does not contain TELEGRAM_BOT_TOKEN."

  log 'Running initial synchronization and starting services'
  /usr/bin/install -o root -g root -m 644 \
    "$APP_DIRECTORY/deploy/cron/hot-ticket-bot" \
    /etc/cron.d/hot-ticket-bot
  /usr/bin/systemctl restart cron

  /usr/sbin/runuser --user "$APP_USER" -- /bin/bash -c '
    set -a
    source "$1"
    cd "$2"
    /usr/bin/node dist/entries/sync.js
  ' _ "$ENVIRONMENT_FILE" "$APP_DIRECTORY"

  /usr/bin/systemctl enable "$BOT_SERVICE"
  /usr/bin/systemctl restart "$BOT_SERVICE"
  /usr/bin/systemctl is-active --quiet "$BOT_SERVICE"

  /usr/bin/systemctl enable "$WEB_SERVICE"
  /usr/bin/systemctl restart "$WEB_SERVICE"
  /usr/bin/systemctl is-active --quiet "$WEB_SERVICE"

  if [[ "$ENABLE_ADMIN" == true ]]; then
    /usr/bin/systemctl enable "$ADMIN_SERVICE"
    /usr/bin/systemctl restart "$ADMIN_SERVICE"
    /usr/bin/systemctl is-active --quiet "$ADMIN_SERVICE"
  fi
else
  log 'Services were not started'
  printf 'Edit %s, then rerun with --start.\n' "$ENVIRONMENT_FILE"
fi

log 'VDS setup completed successfully'
printf 'Node: %s\n' "$(/usr/bin/node --version)"
printf 'Application: %s\n' "$APP_DIRECTORY"
printf 'Deploy user: %s\n' "$DEPLOY_USER"
