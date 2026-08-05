import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { openSqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { applyMigrations } from '../../src/infrastructure/sqlite/migrations.js';
import { ApplicationRepositories } from '../../src/infrastructure/sqlite/repositories.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-04T12:00:00Z');
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function createRepositories() {
  const root = mkdtempSync(join(tmpdir(), 'hot-ticket-repositories-'));
  roots.push(root);
  const database = openSqliteDatabase(join(root, 'database.sqlite'));
  applyMigrations(database, resolve('migrations'));
  return { database, repositories: new ApplicationRepositories(database, new FixedClock()) };
}

function ticket(price = 1_850_000, overrides: Partial<Ticket> = {}): Ticket {
  return {
    externalKey: 'external-key',
    originCode: 'TAS',
    destinationCode: 'IST',
    departureDate: '2026-09-15',
    departureAt: '2026-09-15T16:50:00',
    price,
    currencyCode: 'UZS',
    airlineCode: 'HY',
    airlineName: null,
    isDirect: true,
    tripClass: 'economy',
    hasBaggage: false,
    ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
    rawTicketLink: '/TAS1509IST1?token=1',
    rawPayload: { source: 'fixture' },
    ...overrides
  };
}

describe('ApplicationRepositories on SQLite', () => {
  it('сохраняет пользователей и обновляет билет без дубликата', async () => {
    const { database, repositories } = createRepositories();
    const now = new FixedClock().now();
    const user = await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: 'traveler',
      firstName: 'Ali',
      lastName: null,
      languageCode: 'ru'
    }, now);
    await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 201,
      username: 'traveler',
      firstName: 'Ali',
      lastName: null,
      languageCode: 'ru'
    }, now);
    const inserted = await repositories.upsert(ticket(), now);
    const updated = await repositories.upsert(ticket(1_700_000), now);

    expect(user.id).toBe(1);
    expect(user).toMatchObject({ preferredTripClass: 'economy', baggageRequired: false });
    expect((await repositories.findByTelegramUserId(100))?.telegramChatId).toBe(201);
    expect(inserted.previous).toBeNull();
    expect(updated.previous?.price).toBe(1_850_000);
    expect(updated.stored.price).toBe(1_700_000);
    expect(updated.stored.tripClass).toBe('economy');
    expect(await database.get('SELECT count(*) AS count FROM tickets')).toEqual({ count: 1 });
    database.close();
  });

  it('поддерживает subscriptions, notification dedup, source и lock', async () => {
    const { database, repositories } = createRepositories();
    const now = new FixedClock().now();
    const user = await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: null,
      firstName: null,
      lastName: null,
      languageCode: null
    }, now);
    const stored = (await repositories.upsert(ticket(), now)).stored;
    const subscription = await repositories.create({
      userId: user.id,
      originCode: 'TAS',
      destinationCode: 'IST',
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-01',
      departureDateTo: '2026-09-30',
      maxPrice: 2_000_000,
      directOnly: true,
      baggageRequired: false
    }, now);
    expect(await repositories.findMatching(stored)).toHaveLength(1);

    await repositories.addNotification({
      userId: user.id,
      subscriptionId: subscription.id,
      ticketId: stored.id,
      notifiedPrice: stored.price,
      notificationType: 'new_ticket',
      telegramMessageId: 10,
      sentAt: now
    });
    await repositories.addNotification({
      userId: user.id,
      subscriptionId: subscription.id,
      ticketId: stored.id,
      notifiedPrice: stored.price,
      notificationType: 'new_ticket',
      telegramMessageId: 11,
      sentAt: now
    });
    expect(await database.get('SELECT count(*) AS count FROM notification_history'))
      .toEqual({ count: 1 });

    await repositories.ensureInitialSource(now);
    await repositories.ensureInitialSource(now);
    expect(await repositories.findEnabled()).toEqual([{
      id: 1,
      originCode: 'TAS',
      currencyCode: 'UZS',
      isEnabled: true
    }]);
    expect(await repositories.acquire('sync:hot-tickets:TAS:UZS', 300)).toBe(true);
    expect(await repositories.acquire('sync:hot-tickets:TAS:UZS', 300)).toBe(false);
    await repositories.release('sync:hot-tickets:TAS:UZS');
    database.close();
  });

  it('возвращает стабильные страницы без пропусков', async () => {
    const { database, repositories } = createRepositories();
    const now = new FixedClock().now();
    for (let index = 1; index <= 23; index += 1) {
      await repositories.upsert(ticket(1_000_000, {
        externalKey: `ticket-${index}`,
        ticketLink: `https://www.aviasales.uz/search/TAS1509IST${index}`
      }), now);
    }

    const baseQuery = {
      originCode: 'TAS',
      currencyCode: 'UZS',
      departureDateFrom: '2026-08-05',
      departureDateTo: null,
      destinationCode: null,
      maxPrice: null,
      directOnly: false,
      tripClass: 'economy' as const,
      baggageRequired: false,
      sort: 'price_asc' as const,
      limit: 10
    };
    const pages = await Promise.all([0, 10, 20].map(async (offset) => (
      repositories.listActive({ ...baseQuery, offset })
    )));
    const ids = pages.flatMap((page) => page.map((item) => item.id));

    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
    expect(ids).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
    database.close();
  });
});
