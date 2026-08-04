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

  it('запускает sync каждые 10 минут и backup в 03:30', () => {
    const cron = readFileSync('deploy/cron/hot-ticket-bot', 'utf8');
    expect(cron).toContain('*/10 * * * * hotticket');
    expect(cron).toContain('flock -n /run/lock/hot-ticket-bot-sync.lock');
    expect(cron).toContain('dist/entries/sync.js');
    expect(cron).toContain('30 3 * * * hotticket');
    expect(cron).toContain('dist/entries/backup.js');
    expect(cron).toContain('source /etc/hot-ticket-bot.env');
  });
});
