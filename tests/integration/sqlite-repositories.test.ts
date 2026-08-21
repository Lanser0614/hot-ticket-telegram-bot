import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../src/application/ports.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { createRouteKey } from '../../src/domain/route-price.js';
import { SqliteAdminRepository } from '../../src/infrastructure/sqlite/admin-repository.js';
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
    returnDate: null,
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
      roundTripOnly: false,
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
    await database.run(`
      INSERT INTO sync_sources (
        origin_code, currency_code, is_enabled, created_at, updated_at
      ) VALUES ('ALA', 'USD', 1, 1, 1)
    `);
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

  it('сохраняет, обновляет и очищает кэш направлений', async () => {
    const { database, repositories } = createRepositories();
    const now = new FixedClock().now();
    const query = {
      originCode: 'TAS',
      currencyCode: 'UZS',
      departureDateFrom: '2026-08-04',
      tripClass: 'economy' as const,
      baggageRequired: false
    };

    await expect(repositories.getCachedActiveDestinations(query)).resolves.toBeNull();
    await repositories.saveActiveDestinationsCache(query, ['BHK', 'IST'], now);
    await expect(repositories.getCachedActiveDestinations(query))
      .resolves.toEqual(['BHK', 'IST']);
    await expect(new SqliteAdminRepository(database).listCachedDestinations())
      .resolves.toEqual(['BHK', 'IST']);

    await repositories.saveActiveDestinationsCache(query, ['DXB'], now);
    await expect(repositories.getCachedActiveDestinations(query)).resolves.toEqual(['DXB']);

    const nextDay = { ...query, departureDateFrom: '2026-08-05' };
    await repositories.saveActiveDestinationsCache(nextDay, [], now);
    await repositories.pruneActiveDestinationsCache(query, nextDay.departureDateFrom);

    await expect(repositories.getCachedActiveDestinations(query)).resolves.toBeNull();
    await expect(repositories.getCachedActiveDestinations(nextDay)).resolves.toEqual([]);
    database.close();
  });

  it('агрегирует почасовые наблюдения в дневную историю маршрута', async () => {
    const { database, repositories } = createRepositories();
    const routeKey = createRouteKey('TAS', 'IST', 'economy');
    const observedAt = new Date('2026-08-04T12:00:00Z');
    const base = {
      routeKey,
      originCode: 'TAS',
      destinationCode: 'IST',
      tripClass: 'economy' as const,
      isDirect: true,
      hasBaggage: false,
      departureDate: '2026-09-15',
      daysAhead: 42,
      currencyCode: 'UZS',
      observedAt
    };
    await repositories.recordObservation({ ...base, price: 1_900_000 });
    await repositories.recordObservation({ ...base, price: 1_700_000 });
    await repositories.recordObservation({
      ...base,
      price: 2_100_000,
      departureDate: '2026-09-16'
    });
    await repositories.rebuildDailyAggregate(routeKey, '2026-08-04', observedAt);

    await expect(repositories.getDailySeries(routeKey, 30, observedAt)).resolves.toEqual([{
      day: '2026-08-04',
      minPrice: 1_700_000,
      averagePrice: 1_900_000,
      medianPrice: 1_900_000,
      maxPrice: 2_100_000,
      sampleCount: 2
    }]);
    expect(await database.get('SELECT count(*) AS count FROM route_price_observations'))
      .toEqual({ count: 2 });
    database.close();
  });

  it('сохраняет snapshot перехода и находит недавний дубль', async () => {
    const { database, repositories } = createRepositories();
    const observedAt = new FixedClock().now();
    const user = await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: null,
      firstName: null,
      lastName: null,
      languageCode: null
    }, observedAt);
    const stored = (await repositories.upsert(ticket(), observedAt)).stored;

    const clickId = await repositories.addClick({
      ticket: stored,
      userId: user.id,
      source: 'miniapp_card',
      subscriptionId: null,
      userAgentKind: 'human',
      clickedAt: observedAt
    });

    expect(clickId).toBe(1);
    await expect(repositories.hasRecentClick(
      user.id,
      stored.id,
      new Date(observedAt.getTime() - 60_000)
    )).resolves.toBe(true);
    expect(await database.get(`
      SELECT source, origin_code, destination_code, price, user_agent_kind
      FROM link_clicks WHERE id = 1
    `)).toEqual({
      source: 'miniapp_card',
      origin_code: 'TAS',
      destination_code: 'IST',
      price: 1_850_000,
      user_agent_kind: 'human'
    });
    database.close();
  });

  it('строит полную статистику админки по пользователям, ценам и кликам', async () => {
    const { database, repositories } = createRepositories();
    const now = new Date();
    const user = await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: 'traveler',
      firstName: 'Ali',
      lastName: null,
      languageCode: 'ru'
    }, now);
    const stored = (await repositories.upsert(ticket(), now)).stored;
    await repositories.create({
      userId: user.id,
      originCode: 'TAS',
      destinationCode: 'IST',
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-01',
      departureDateTo: '2026-09-30',
      maxPrice: 2_000_000,
      directOnly: true,
      roundTripOnly: false,
      baggageRequired: false
    }, now);
    await repositories.addClick({
      ticket: stored,
      userId: user.id,
      source: 'miniapp_card',
      subscriptionId: null,
      userAgentKind: 'human',
      clickedAt: now
    });
    await repositories.addClick({
      ticket: stored,
      userId: user.id,
      source: 'miniapp_card',
      subscriptionId: null,
      userAgentKind: 'telegram_preview',
      clickedAt: now
    });
    const routeKey = createRouteKey('TAS', 'IST', 'economy');
    await repositories.recordObservation({
      routeKey,
      originCode: 'TAS',
      destinationCode: 'IST',
      tripClass: 'economy',
      isDirect: true,
      hasBaggage: false,
      departureDate: '2026-09-15',
      daysAhead: 25,
      currencyCode: 'UZS',
      price: 1_850_000,
      observedAt: now
    });
    const day = now.toISOString().slice(0, 10);
    await repositories.rebuildDailyAggregate(routeKey, day, now);

    const stats = await new SqliteAdminRepository(database).getStats();

    expect(stats).toMatchObject({
      totalTickets: 1,
      users: 1,
      activeSubscriptions: 1,
      userStats: {
        active: 1,
        new7Days: 1,
        new30Days: 1,
        withActiveSubscriptions: 1
      },
      priceStats: {
        currentMinPrice: 1_850_000,
        currentAveragePrice: 1_850_000,
        currentMaxPrice: 1_850_000
      },
      clickStats: {
        clicks24Hours: 1,
        clicks7Days: 1,
        clicks30Days: 1,
        uniqueUsers30Days: 1,
        bySource30Days: [{ source: 'miniapp_card', count: 1 }]
      }
    });
    expect(stats.userStats.recent[0]).toMatchObject({
      username: 'traveler',
      activeSubscriptions: 1,
      clicks30Days: 1
    });
    expect(stats.priceStats.trend30Days).toEqual([{
      day,
      minPrice: 1_850_000,
      averageMinPrice: 1_850_000,
      maxPrice: 1_850_000,
      sampleCount: 1
    }]);
    expect(stats.priceStats.routes30Days[0]).toMatchObject({
      originCode: 'TAS',
      destinationCode: 'IST',
      sampleCount: 1,
      observedDays: 1
    });
    expect(stats.clickStats.daily30Days).toHaveLength(30);
    expect(stats.clickStats.daily30Days.reduce((sum, point) => sum + point.clicks, 0)).toBe(1);
    expect(stats.clickStats.topRoutes30Days).toEqual([{
      originCode: 'TAS',
      destinationCode: 'IST',
      clicks: 1,
      uniqueUsers: 1,
      averagePrice: 1_850_000
    }]);
    database.close();
  });
});
