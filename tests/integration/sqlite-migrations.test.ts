import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it('берёт write reservation до чтения migration state', () => {
    const databasePath = temporaryDatabasePath();
    const first = openSqliteDatabase(databasePath);
    const second = openSqliteDatabase(databasePath);
    first.execute('CREATE TABLE lock_probe (id INTEGER PRIMARY KEY)');
    second.execute('PRAGMA busy_timeout = 1');

    expect(() => first.transaction(() => {
      first.getSync('SELECT count(*) AS count FROM lock_probe');
      second.runSync('INSERT INTO lock_probe (id) VALUES (1)');
    })).toThrow(/SQLITE_BUSY|database is locked/iu);

    first.close();
    second.close();
  });

  it('создаёт schema один раз и включает pragmas', async () => {
    const database = openSqliteDatabase(temporaryDatabasePath());
    applyMigrations(database, migrationsDirectory);
    applyMigrations(database, migrationsDirectory);

    expect(await database.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(await database.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(await database.get('PRAGMA busy_timeout')).toEqual({ timeout: 5_000 });
    expect(await database.get('SELECT count(*) AS count FROM schema_migrations'))
      .toEqual({ count: 2 });
    expect(await database.get("SELECT name FROM sqlite_master WHERE name = 'app_state'"))
      .toEqual({ name: 'app_state' });
    database.close();
  });

  it('приводит legacy данные к TAS/UZS и включает единственный source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hot-ticket-legacy-migration-'));
    temporaryDirectories.push(root);
    const customMigrations = join(root, 'migrations');
    mkdirSync(customMigrations);
    writeFileSync(
      join(customMigrations, '001_initial.sql'),
      readFileSync(resolve('migrations/001_initial.sql'), 'utf8')
    );
    const database = openSqliteDatabase(join(root, 'database.sqlite'));
    applyMigrations(database, customMigrations);

    database.runSync(`
      INSERT INTO users (
        telegram_user_id, telegram_chat_id, default_origin_code,
        preferred_currency_code, created_at, updated_at
      ) VALUES (100, 200, 'ALA', 'USD', 1, 1)
    `);
    database.runSync(`
      INSERT INTO tickets (
        external_key, origin_code, destination_code, departure_date, price,
        currency_code, ticket_link, raw_payload, first_seen_at, last_seen_at,
        created_at, updated_at
      ) VALUES (
        'legacy', 'TAS', 'IST', '2026-09-01', 100, 'UZS',
        'https://www.aviasales.uz/search/TAS0109IST1', '{}', 1, 1, 1, 1
      )
    `);
    database.runSync(`
      INSERT INTO subscriptions (
        user_id, origin_code, currency_code, departure_date_from,
        departure_date_to, baggage_required, created_at, updated_at
      ) VALUES (1, 'ALA', 'USD', '2026-09-01', '2026-09-30', 1, 1, 1)
    `);
    database.runSync(`
      INSERT INTO sync_sources (
        origin_code, currency_code, is_enabled, created_at, updated_at
      ) VALUES ('ALA', 'USD', 1, 1, 1), ('TAS', 'UZS', 0, 1, 1)
    `);

    writeFileSync(
      join(customMigrations, '002_fixed-tashkent-search.sql'),
      readFileSync(resolve('migrations/002_fixed-tashkent-search.sql'), 'utf8')
    );
    applyMigrations(database, customMigrations);

    expect(await database.get(`
      SELECT default_origin_code, preferred_currency_code,
        preferred_trip_class, baggage_required
      FROM users WHERE id = 1
    `)).toEqual({
      default_origin_code: 'TAS',
      preferred_currency_code: 'UZS',
      preferred_trip_class: 'economy',
      baggage_required: 0
    });
    expect(await database.get(`
      SELECT origin_code, currency_code, baggage_required
      FROM subscriptions WHERE id = 1
    `)).toEqual({ origin_code: 'TAS', currency_code: 'UZS', baggage_required: 0 });
    expect(await database.get('SELECT trip_class FROM tickets WHERE id = 1'))
      .toEqual({ trip_class: 'economy' });
    expect(await database.all(`
      SELECT origin_code, currency_code FROM sync_sources
      WHERE is_enabled = 1 ORDER BY id
    `)).toEqual([{ origin_code: 'TAS', currency_code: 'UZS' }]);
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
