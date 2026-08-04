import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { RawDatabase } from './repositories.js';

type Row = Readonly<Record<string, unknown>>;
type Parameters = Readonly<Record<string, unknown>>;
type BindValue = string | number | bigint | Buffer | null;

function stripPrefixes(parameters: Parameters): Record<string, BindValue> {
  const normalized: Record<string, BindValue> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (
      value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'bigint'
      && !Buffer.isBuffer(value)
    ) {
      throw new TypeError(`Некорректный SQLite parameter ${key}`);
    }
    normalized[key.replace(/^[:@$]/u, '')] = value;
  }
  return normalized;
}

export class SqliteDatabase implements RawDatabase {
  private readonly database: Database.Database;

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { fileMustExist: false, timeout: 5_000 });
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
  }

  public run(query: string, parameters: Parameters = {}): Promise<unknown> {
    return Promise.resolve(this.runSync(query, parameters));
  }

  public runSync(query: string, parameters: Parameters = {}): Database.RunResult {
    const statement = this.database.prepare(query);
    const normalized = stripPrefixes(parameters);
    return Object.keys(normalized).length === 0
      ? statement.run()
      : statement.run(normalized);
  }

  public all(query: string, parameters: Parameters = {}): Promise<readonly Row[]> {
    const statement = this.database.prepare(query);
    const normalized = stripPrefixes(parameters);
    const rows = Object.keys(normalized).length === 0
      ? statement.all()
      : statement.all(normalized);
    return Promise.resolve(rows as Row[]);
  }

  public get(query: string, parameters: Parameters = {}): Promise<Row | null> {
    return Promise.resolve(this.getSync(query, parameters));
  }

  public getSync(query: string, parameters: Parameters = {}): Row | null {
    const statement = this.database.prepare(query);
    const normalized = stripPrefixes(parameters);
    const row = Object.keys(normalized).length === 0
      ? statement.get()
      : statement.get(normalized);
    return row === undefined ? null : row as Row;
  }

  public execute(sql: string): void {
    this.database.exec(sql);
  }

  public transaction<T>(operation: () => T): T {
    return this.database.transaction(operation).immediate();
  }

  public async backup(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await this.database.backup(path);
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }
}

export function openSqliteDatabase(path: string): SqliteDatabase {
  return new SqliteDatabase(path);
}
