import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../src/application/ports.js';
import { TelegramOffsetStore } from '../../../src/infrastructure/sqlite/offset-store.js';
import type { RawDatabase } from '../../../src/infrastructure/sqlite/repositories.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-04T12:00:00Z');
  }
}

class StateDatabase implements RawDatabase {
  public value: unknown = null;

  public run(_query: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<void> {
    this.value = parameters[':value'];
    return Promise.resolve();
  }

  public all(): Promise<readonly Readonly<Record<string, unknown>>[]> {
    return Promise.resolve([]);
  }

  public get(): Promise<Readonly<Record<string, unknown>> | null> {
    return Promise.resolve(this.value === null ? null : { value: this.value });
  }
}

describe('TelegramOffsetStore', () => {
  it('сохраняет следующий offset между экземплярами', async () => {
    const database = new StateDatabase();
    const first = new TelegramOffsetStore(database, new FixedClock());
    expect(await first.read()).toBe(0);
    await first.save(42);
    const second = new TelegramOffsetStore(database, new FixedClock());
    expect(await second.read()).toBe(42);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('отклоняет offset %s', async (offset) => {
    const store = new TelegramOffsetStore(new StateDatabase(), new FixedClock());
    await expect(store.save(offset)).rejects.toThrow('offset');
  });

  it('отклоняет повреждённое значение базы', async () => {
    const database = new StateDatabase();
    database.value = '1.5';
    const store = new TelegramOffsetStore(database, new FixedClock());
    await expect(store.read()).rejects.toThrow('сохранённый');
  });
});
