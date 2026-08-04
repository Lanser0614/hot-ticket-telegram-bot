import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { openSqliteDatabase } from './database.js';

const MANAGED_BACKUP = /^hot-ticket-bot-\d{8}T\d{6}Z\.sqlite$/u;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function backupName(date: Date): string {
  const timestamp = date.toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '');
  return `hot-ticket-bot-${timestamp}.sqlite`;
}

export async function backupDatabase(input: {
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly now?: Date;
}): Promise<{ readonly path: string; readonly removed: number }> {
  const now = input.now ?? new Date();
  if (!existsSync(input.databasePath)) {
    throw new Error(`SQLite database does not exist: ${input.databasePath}`);
  }
  mkdirSync(input.backupDirectory, { recursive: true });
  const path = join(input.backupDirectory, backupName(now));
  const database = openSqliteDatabase(input.databasePath);
  try {
    await database.backup(path);
  } finally {
    database.close();
  }

  const cutoffName = backupName(new Date(now.getTime() - RETENTION_MS));
  let removed = 0;
  for (const file of readdirSync(input.backupDirectory)) {
    if (MANAGED_BACKUP.test(file) && file < cutoffName) {
      unlinkSync(join(input.backupDirectory, file));
      removed += 1;
    }
  }
  return { path, removed };
}
