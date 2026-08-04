import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openSqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { applyMigrations } from '../../src/infrastructure/sqlite/migrations.js';

const temporaryDirectories: string[] = [];
const migrationsDirectory = resolve('migrations');

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hot-ticket-migrations-'));
  temporaryDirectories.push(directory);
  return join(directory, 'database.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SQLite migrations', () => {
  it('создаёт schema один раз и включает pragmas', async () => {
    const database = openSqliteDatabase(temporaryDatabasePath());
    applyMigrations(database, migrationsDirectory);
    applyMigrations(database, migrationsDirectory);

    expect(await database.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(await database.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(await database.get('PRAGMA busy_timeout')).toEqual({ timeout: 5_000 });
    expect(await database.get('SELECT count(*) AS count FROM schema_migrations'))
      .toEqual({ count: 1 });
    expect(await database.get("SELECT name FROM sqlite_master WHERE name = 'app_state'"))
      .toEqual({ name: 'app_state' });
    database.close();
  });

  it('отклоняет изменение уже применённой migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'hot-ticket-migration-change-'));
    temporaryDirectories.push(root);
    const customMigrations = join(root, 'migrations');
    const database = openSqliteDatabase(join(root, 'database.sqlite'));
    mkdirSync(customMigrations);
    const migrationPath = join(customMigrations, '001_test.sql');
    writeFileSync(migrationPath, 'CREATE TABLE example (id INTEGER PRIMARY KEY);');
    applyMigrations(database, customMigrations);
    writeFileSync(migrationPath, 'CREATE TABLE changed (id INTEGER PRIMARY KEY);');

    expect(() => applyMigrations(database, customMigrations)).toThrow('изменена');
    database.close();
  });
});
