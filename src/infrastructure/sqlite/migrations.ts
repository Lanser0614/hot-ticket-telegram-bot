import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SqliteDatabase } from './database.js';

const MIGRATION_NAME = /^\d{3}_[a-z0-9-]+\.sql$/u;

function checksum(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export function applyMigrations(database: SqliteDatabase, directory: string): void {
  database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const files = readdirSync(directory)
    .filter((name) => MIGRATION_NAME.test(name))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const source = readFileSync(join(directory, file), 'utf8');
    const sourceChecksum = checksum(source);
    database.transaction(() => {
      const applied = database.getSync(
        'SELECT checksum FROM schema_migrations WHERE version = :version',
        { ':version': file }
      );
      if (applied === null) {
        database.execute(source);
        database.runSync(
          `INSERT INTO schema_migrations (version, checksum, applied_at)
           VALUES (:version, :checksum, :appliedAt)`,
          {
            ':version': file,
            ':checksum': sourceChecksum,
            ':appliedAt': Math.floor(Date.now() / 1_000)
          }
        );
        return;
      }
      if (applied.checksum !== sourceChecksum) {
        throw new Error(`Применённая migration ${file} изменена`);
      }
    });
  }
}
