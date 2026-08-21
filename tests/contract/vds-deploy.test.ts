import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('VDS deploy files', () => {
  it('запускает hardened systemd service без HTTP port', () => {
    const unit = readFileSync('deploy/systemd/hot-ticket-bot.service', 'utf8');
    expect(unit).toContain('User=hotticket');
    expect(unit).toContain('EnvironmentFile=/etc/hot-ticket-bot.env');
    expect(unit).toContain('WorkingDirectory=/opt/hot-ticket-bot');
    expect(unit).toContain('ExecStart=/usr/bin/node dist/entries/bot.js');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('NoNewPrivileges=true');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).not.toMatch(/PORT|nginx|webhook/iu);
  });

  it('запускает sync каждые 10 минут и backup в 03:30 системного времени', () => {
    const cron = readFileSync('deploy/cron/hot-ticket-bot', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    expect(cron).not.toContain('CRON_TZ');
    expect(cron).toContain('*/10 * * * * hotticket');
    expect(cron).toContain('flock -n /run/lock/hot-ticket-bot-sync.lock');
    expect(cron).toContain('dist/entries/sync.js');
    expect(cron).toContain('30 3 * * * hotticket');
    expect(cron).toContain('dist/entries/backup.js');
    expect(cron).toContain('source /etc/hot-ticket-bot.env');
    expect(readme).toContain('03:30 по системному времени VDS');
  });

  it('терминирует TLS через Caddy и не выставляет Node admin напрямую', () => {
    const caddyfile = readFileSync('deploy/caddy/Caddyfile', 'utf8');
    const adminUnit = readFileSync('deploy/systemd/hot-ticket-admin.service', 'utf8');
    const webUnit = readFileSync('deploy/systemd/hot-ticket-web.service', 'utf8');
    const setup = readFileSync('deploy/scripts/setup-vds.sh', 'utf8');
    expect(caddyfile).toContain('ticket.crosfit.uz');
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:8080');
    expect(caddyfile).toContain('/app/* /api /api/* /go /go/*');
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:8081');
    expect(adminUnit).toContain('ADMIN_HOST=127.0.0.1 ADMIN_PORT=8080');
    expect(adminUnit).not.toContain('CAP_NET_BIND_SERVICE');
    expect(webUnit).toContain('WEB_HOST=127.0.0.1 WEB_PORT=8081');
    expect(webUnit).toContain('NoNewPrivileges=true');
    expect(setup).toContain('dl.cloudsmith.io/public/caddy/stable');
    expect(setup).toContain('/etc/caddy/Caddyfile');
    expect(setup).toContain('hot-ticket-web.service');
  });

  it('описывает установку Node.js 24 на чистой Ubuntu', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('https://deb.nodesource.com/setup_24.x');
    expect(readme).toContain('sudo apt install -y nodejs');
  });

  it('описывает каталог Узбекистана и локальный sync', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('городов Узбекистана');
    expect(readme).toContain('`TAS`, `SKD`, `BHK`');
    expect(readme).toContain('/tickets IST');
    expect(readme).toContain('Все направления');
    expect(readme).toContain('cron');
    expect(readme).toContain('внешний cron-сервис не нужны');
  });

  it('принудительно приводит VDS к проверенному commit из origin/main', () => {
    const deploy = readFileSync('deploy/scripts/hot-ticket-deploy', 'utf8');
    expect(deploy).toContain('fetch --prune origin "$EXPECTED_BRANCH"');
    expect(deploy).toContain('rev-parse "origin/$EXPECTED_BRANCH"');
    expect(deploy).toContain('checkout --force -B "$EXPECTED_BRANCH" "$COMMIT"');
    expect(deploy).toContain('reset --hard "$COMMIT"');
    expect(deploy).toContain('clean -fd');
    expect(deploy).toContain('/usr/bin/chown -R "$APP_USER:$APP_GROUP" "$DEPLOY_DIRECTORY"');
    expect(deploy).toContain('"$DEPLOY_DIRECTORY/deploy/scripts/hot-ticket-deploy" "$DEPLOY_COMMAND_UPDATE"');
    expect(deploy).toContain('/usr/bin/mv -f "$DEPLOY_COMMAND_UPDATE" "$DEPLOY_COMMAND"');
    expect(deploy).not.toContain('merge --ff-only');
  });
});
