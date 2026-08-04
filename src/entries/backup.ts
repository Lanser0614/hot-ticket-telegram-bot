import process from 'node:process';

import { backupDatabase } from '../infrastructure/sqlite/backup.js';

const databasePath = process.env.DATABASE_PATH?.trim() || './data/hot-ticket-bot.sqlite';
const backupDirectory = process.env.BACKUP_DIRECTORY?.trim() || './backups';

try {
  const result = await backupDatabase({ databasePath, backupDirectory });
  console.info(JSON.stringify(result));
} catch (error: unknown) {
  console.error('database_backup_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError'
  });
  process.exitCode = 1;
}
