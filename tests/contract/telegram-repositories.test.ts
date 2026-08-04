import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports.js';
import { ApplicationRepositories, type RawDatabase } from '../../src/infrastructure/sqlite/repositories.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-04T12:00:00Z');
  }
}

class FakeDatabase implements RawDatabase {
  public readonly calls: Array<{
    mode: 'run' | 'all' | 'get';
    query: string;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  public readonly getResults: Array<Readonly<Record<string, unknown>> | null> = [];
  public readonly allResults: Array<readonly Readonly<Record<string, unknown>>[]> = [];

  public run(query: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<void> {
    this.calls.push({ mode: 'run', query, parameters });
    return Promise.resolve();
  }

  public all(
    query: string,
    parameters: Readonly<Record<string, unknown>> = {}
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    this.calls.push({ mode: 'all', query, parameters });
    return Promise.resolve(this.allResults.shift() ?? []);
  }

  public get(
    query: string,
    parameters: Readonly<Record<string, unknown>> = {}
  ): Promise<Readonly<Record<string, unknown>> | null> {
    this.calls.push({ mode: 'get', query, parameters });
    return Promise.resolve(this.getResults.shift() ?? null);
  }
}

function userRow(): Readonly<Record<string, unknown>> {
  return {
    id: 1,
    telegram_user_id: 100,
    telegram_chat_id: 200,
    username: 'traveler',
    first_name: 'Ali',
    last_name: null,
    phone_number: null,
    language_code: 'ru',
    default_origin_code: 'TAS',
    preferred_currency_code: 'UZS',
    is_active: 1,
    created_at: 1_775_300_400,
    updated_at: 1_775_300_400
  };
}

describe('ApplicationRepositories', () => {
  it('upsert пользователя использует unique telegram_user_id и bound params', async () => {
    const db = new FakeDatabase();
    db.getResults.push(userRow());
    const repositories = new ApplicationRepositories(db, new FixedClock());

    await expect(repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: 'traveler',
      firstName: 'Ali',
      lastName: null,
      languageCode: 'ru'
    }, new Date('2026-08-04T12:00:00Z'))).resolves.toMatchObject({ id: 1, telegramUserId: 100 });

    expect(db.calls[0]?.query).toContain('ON CONFLICT(telegram_user_id) DO UPDATE');
    expect(db.calls[0]?.parameters).toMatchObject({ ':telegramUserId': 100, ':telegramChatId': 200 });
  });

  it('получает lock одной атомарной командой и освобождает только своего owner', async () => {
    const db = new FakeDatabase();
    db.getResults.push({ key: 'sync:hot-tickets:TAS:UZS' });
    const repositories = new ApplicationRepositories(db, new FixedClock());

    await expect(repositories.acquire('sync:hot-tickets:TAS:UZS', 300)).resolves.toBe(true);
    await repositories.release('sync:hot-tickets:TAS:UZS');

    expect(db.calls[0]?.query).toContain('ON CONFLICT(key) DO UPDATE');
    expect(db.calls[0]?.query).toContain('WHERE sync_locks.expires_at <= :now');
    expect(db.calls[1]?.query).toContain('AND owner = :owner');
  });

  it('вставляет notification history с защитой от конфликта', async () => {
    const db = new FakeDatabase();
    const repositories = new ApplicationRepositories(db, new FixedClock());

    await repositories.addNotification({
      userId: 1,
      subscriptionId: 2,
      ticketId: 3,
      notifiedPrice: 1_850_000,
      notificationType: 'new_ticket',
      telegramMessageId: 1000,
      sentAt: new Date('2026-08-04T12:00:00Z')
    });

    expect(db.calls[0]?.query).toContain('ON CONFLICT(user_id, subscription_id, ticket_id, notified_price) DO NOTHING');
  });
});
