import type { Clock } from '../../application/ports.js';
import type { RawDatabase } from './repositories.js';

const OFFSET_KEY = 'telegram_update_offset';

export class TelegramOffsetStore {
  public constructor(
    private readonly database: RawDatabase,
    private readonly clock: Clock
  ) {}

  public async read(): Promise<number> {
    const row = await this.database.get(
      'SELECT value FROM app_state WHERE key = :key',
      { ':key': OFFSET_KEY }
    );
    if (row === null) return 0;
    const value = row.value;
    if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
      throw new TypeError('Некорректный сохранённый Telegram offset');
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new TypeError('Некорректный сохранённый Telegram offset');
    }
    return parsed;
  }

  public async save(nextOffset: number): Promise<void> {
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) {
      throw new TypeError('Некорректный Telegram offset');
    }
    await this.database.run(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (:key, :value, :updatedAt)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `, {
      ':key': OFFSET_KEY,
      ':value': String(nextOffset),
      ':updatedAt': Math.floor(this.clock.now().getTime() / 1_000)
    });
  }
}
