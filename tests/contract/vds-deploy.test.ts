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

  it('описывает установку Node.js 24 на чистой Ubuntu', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('https://deb.nodesource.com/setup_24.x');
    expect(readme).toContain('sudo apt install -y nodejs');
  });

  it('описывает фиксированный каталог и локальный sync', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('Ташкент (TAS)');
    expect(readme).toContain('origin=TAS&currency=uzs');
    expect(readme).toContain('/tickets IST');
    expect(readme).toContain('Все направления из Ташкента');
    expect(readme).toContain('cron');
    expect(readme).toContain('внешний cron-сервис не нужны');
  });
});
