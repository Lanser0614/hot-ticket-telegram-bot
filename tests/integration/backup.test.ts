import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { backupDatabase } from '../../src/infrastructure/sqlite/backup.js';
import { openSqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { applyMigrations } from '../../src/infrastructure/sqlite/migrations.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('SQLite backup', () => {
  it('не создаёт пустую копию при отсутствии основной базы', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hot-ticket-backup-'));
    roots.push(root);
    const backupDirectory = join(root, 'backups');

    await expect(backupDatabase({
      databasePath: join(root, 'missing.sqlite'),
      backupDirectory
    })).rejects.toThrow('SQLite database does not exist');
    expect(existsSync(backupDirectory)).toBe(false);
  });

  it('создаёт восстанавливаемую копию и удаляет только старые managed backups', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hot-ticket-backup-'));
    roots.push(root);
    const databasePath = join(root, 'data', 'database.sqlite');
    const backupDirectory = join(root, 'backups');
    mkdirSync(backupDirectory);
    const database = openSqliteDatabase(databasePath);
    applyMigrations(database, resolve('migrations'));
    await database.run(`
      INSERT INTO users (
        telegram_user_id, telegram_chat_id, created_at, updated_at
      ) VALUES (100, 200, 1, 1)
    `);
    database.close();
    const oldManagedBackup = join(backupDirectory, 'hot-ticket-bot-20260720T033000.456Z.sqlite');
    const recentManagedBackup = join(backupDirectory, 'hot-ticket-bot-20260801T033000Z.sqlite');
    const unrelatedFile = join(backupDirectory, 'keep-me.txt');
    writeFileSync(oldManagedBackup, 'old');
    writeFileSync(recentManagedBackup, 'recent');
    writeFileSync(unrelatedFile, 'unrelated');

    const result = await backupDatabase({
      databasePath,
      backupDirectory,
      now: new Date('2026-08-04T03:30:00.123Z')
    });

    expect(result.path).toMatch(/hot-ticket-bot-20260804T033000Z\.sqlite$/u);
    const restored = openSqliteDatabase(result.path);
    expect(await restored.get('SELECT count(*) AS count FROM users')).toEqual({ count: 1 });
    restored.close();
    expect(existsSync(oldManagedBackup)).toBe(false);
    expect(existsSync(recentManagedBackup)).toBe(true);
    expect(existsSync(unrelatedFile)).toBe(true);
  });
});
