import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NotificationDeliveryService } from '../../src/application/notification-delivery.js';
import type {
  Clock,
  Logger,
  TelegramGateway,
  TicketNotifier
} from '../../src/application/ports.js';
import type {
  NotificationInput,
  TelegramCallbackAnswer,
  TelegramMessageInput
} from '../../src/application/models.js';
import { ReferralService, parseReferralStartPayload } from '../../src/application/referrals.js';
import { MiniAppService } from '../../src/application/miniapp.js';
import { SubscriptionService } from '../../src/application/subscriptions.js';
import { SignedTrackedLinkFactory } from '../../src/application/tracked-links.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { openSqliteDatabase, type SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { applyMigrations } from '../../src/infrastructure/sqlite/migrations.js';
import { ApplicationRepositories } from '../../src/infrastructure/sqlite/repositories.js';

class MutableClock implements Clock {
  public constructor(private current: Date) {}
  public now(): Date { return new Date(this.current); }
  public set(value: Date): void { this.current = new Date(value); }
}

class SilentLogger implements Logger {
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class FakeTelegram implements TicketNotifier, TelegramGateway {
  public readonly notifications: NotificationInput[] = [];
  public readonly messages: TelegramMessageInput[] = [];
  public failure: Error | null = null;

  public send(input: NotificationInput): Promise<{ telegramMessageId: number }> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.notifications.push(input);
    return Promise.resolve({ telegramMessageId: this.notifications.length });
  }

  public sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.messages.push(input);
    return Promise.resolve({ messageId: 100 + this.messages.length });
  }

  public answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void> {
    void input;
    return Promise.resolve();
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createDatabase(): { database: SqliteDatabase; repositories: ApplicationRepositories } {
  const root = mkdtempSync(join(tmpdir(), 'hot-ticket-backend-'));
  roots.push(root);
  const database = openSqliteDatabase(join(root, 'database.sqlite'));
  applyMigrations(database, resolve('migrations'));
  return {
    database,
    repositories: new ApplicationRepositories(database, new MutableClock(new Date()))
  };
}

function ticket(key: string, price: number): Ticket {
  return {
    externalKey: key,
    originCode: 'TAS',
    destinationCode: 'IST',
    departureDate: '2026-09-15',
    departureAt: null,
    returnDate: null,
    price,
    currencyCode: 'UZS',
    airlineCode: null,
    airlineName: null,
    isDirect: true,
    tripClass: 'economy',
    hasBaggage: true,
    ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
    rawTicketLink: null,
    rawPayload: {}
  };
}

async function notificationFixture(now: Date) {
  const root = mkdtempSync(join(tmpdir(), 'hot-ticket-notifications-'));
  roots.push(root);
  const database = openSqliteDatabase(join(root, 'database.sqlite'));
  applyMigrations(database, resolve('migrations'));
  const clock = new MutableClock(now);
  const repositories = new ApplicationRepositories(database, clock);
  const user = await repositories.upsertTelegramProfile({
    telegramUserId: 100,
    telegramChatId: 200,
    username: null,
    firstName: 'Ali',
    lastName: null,
    languageCode: 'ru'
  }, clock.now());
  const subscription = await repositories.create({
    userId: user.id,
    originCode: 'TAS',
    destinationCode: 'IST',
    currencyCode: 'UZS',
    departureDateFrom: '2026-09-01',
    departureDateTo: '2026-09-30',
    maxPrice: null,
    directOnly: false,
    roundTripOnly: false,
    baggageRequired: false,
    tripClass: 'economy'
  }, clock.now());
  const telegram = new FakeTelegram();
  const service = new NotificationDeliveryService({
    queue: repositories,
    history: repositories,
    users: repositories,
    subscriptions: repositories,
    tickets: repositories,
    notifier: telegram,
    telegram,
    clock,
    logger: new SilentLogger()
  });
  return { database, repositories, clock, user, subscription, telegram, service };
}

describe('referrals and tracked savings repositories', () => {
  it('фиксирует first-touch только новому пользователю и игнорирует self-referral', async () => {
    const { database, repositories } = createDatabase();
    const clock = new MutableClock(new Date('2026-08-21T10:00:00Z'));
    const referrer = await repositories.upsertTelegramProfile({
      telegramUserId: 100, telegramChatId: 200, username: null,
      firstName: 'Ali', lastName: null, languageCode: 'ru'
    }, clock.now());
    const referred = await repositories.upsertTelegramProfile({
      telegramUserId: 101, telegramChatId: 201, username: null,
      firstName: 'Vali', lastName: null, languageCode: 'ru'
    }, clock.now());
    const service = new ReferralService(repositories, 'HotTicketBot', clock);
    const shareUrl = await service.createShareUrl(referrer.id, 42);
    const payload = parseReferralStartPayload(new URL(shareUrl ?? '').searchParams.get('start'));

    expect(payload).toMatchObject({ ticketId: 42 });
    await expect(service.attributeNewUser(referred.id, payload!)).resolves.toBe(true);
    await expect(service.attributeNewUser(referred.id, payload!)).resolves.toBe(false);
    await expect(service.attributeNewUser(referrer.id, payload!)).resolves.toBe(false);
    await expect(service.countForUser(referrer.id)).resolves.toBe(1);
    database.close();
  });

  it('суммирует максимальную экономию по уникальному билету только за 90-дневное окно', async () => {
    const { database, repositories } = createDatabase();
    const now = new Date('2026-08-21T10:00:00Z');
    const stored = (await repositories.upsert(ticket('saving-ticket', 1_500_000), now)).stored;
    const base = {
      ticket: stored,
      userId: 1,
      source: 'miniapp_watchlist' as const,
      subscriptionId: 1,
      userAgentKind: 'human' as const,
      benchmarkPrice: 2_000_000
    };
    await repositories.addClick({ ...base, estimatedSavings: 500_000, clickedAt: now });
    await repositories.addClick({ ...base, estimatedSavings: 600_000, clickedAt: now });
    await repositories.addClick({
      ...base,
      source: 'miniapp_card',
      estimatedSavings: 900_000,
      clickedAt: now
    });
    await expect(repositories.getTrackedSavings(
      1,
      'UZS',
      new Date(now.getTime() - 90 * 86_400_000)
    )).resolves.toBe(600_000);
    database.close();
  });

  it('возвращает contextual watchlist link, реферальный share и реальную метрику профиля', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hot-ticket-miniapp-backend-'));
    roots.push(root);
    const database = openSqliteDatabase(join(root, 'database.sqlite'));
    applyMigrations(database, resolve('migrations'));
    const clock = new MutableClock(new Date('2026-08-21T10:00:00Z'));
    const repositories = new ApplicationRepositories(database, clock);
    const user = await repositories.upsertTelegramProfile({
      telegramUserId: 100, telegramChatId: 200, username: null,
      firstName: 'Ali', lastName: null, languageCode: 'ru'
    }, clock.now());
    const stored = (await repositories.upsert(ticket('watchlist', 1_500_000), clock.now())).stored;
    const subscription = await repositories.create({
      userId: user.id,
      originCode: 'TAS',
      destinationCode: 'IST',
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-01',
      departureDateTo: '2026-09-30',
      maxPrice: 1_400_000,
      directOnly: false,
      roundTripOnly: false,
      baggageRequired: false,
      tripClass: 'economy'
    }, clock.now());
    await repositories.addClick({
      ticket: stored,
      userId: user.id,
      source: 'miniapp_watchlist',
      subscriptionId: subscription.id,
      userAgentKind: 'human',
      benchmarkPrice: 2_000_000,
      estimatedSavings: 500_000,
      clickedAt: clock.now()
    });
    const referrals = new ReferralService(repositories, 'HotTicketBot', clock);
    const miniApp = new MiniAppService(
      repositories,
      repositories,
      repositories,
      new SubscriptionService(repositories, repositories, clock),
      new SignedTrackedLinkFactory({
        publicBaseUrl: 'https://tickets.example.com',
        signingSecret: 'a'.repeat(32)
      }),
      clock,
      repositories,
      referrals
    );

    const subscriptions = await miniApp.listSubscriptions(100);
    expect(subscriptions[0]?.currentTicket?.openUrl).toContain('s=miniapp_watchlist');
    expect(subscriptions[0]?.currentTicket?.openUrl).toContain(`b=${String(subscription.id)}`);
    expect(subscriptions[0]?.currentTicket?.shareUrl).toContain('t.me/HotTicketBot');
    const profile = await miniApp.getProfile(100);
    expect(profile).toMatchObject({
      trackedSavings: { amount: 500_000, currency: 'UZS', periodDays: 90 },
      referralCount: 0
    });
    expect(profile.referralShareUrl).toContain('t.me/HotTicketBot');
    database.close();
  });
});

describe('notification delivery queue', () => {
  it('соблюдает лимит 3 сообщения в локальные сутки', async () => {
    const fixture = await notificationFixture(new Date('2026-08-21T07:00:00Z'));
    for (let index = 0; index < 4; index += 1) {
      const stored = (await fixture.repositories.upsert(
        ticket(`limit-${index}`, 1_500_000 + index * 10_000),
        fixture.clock.now()
      )).stored;
      await fixture.repositories.enqueue({
        userId: fixture.user.id,
        subscriptionId: fixture.subscription.id,
        ticketId: stored.id,
        ticketPrice: stored.price,
        notificationType: 'new_ticket',
        queuedAt: fixture.clock.now()
      });
    }
    await fixture.service.execute();
    expect(fixture.telegram.notifications).toHaveLength(3);
    await expect(fixture.database.get(`
      SELECT count(*) AS count FROM notification_queue WHERE status = 'discarded'
    `)).resolves.toEqual({ count: 1 });
    fixture.database.close();
  });

  it('во время quiet hours сохраняет лучший билет подписки и отправляет после окончания', async () => {
    const fixture = await notificationFixture(new Date('2026-08-21T20:00:00Z'));
    await fixture.repositories.updateNotificationPreferences(fixture.user.id, {
      instantNotificationsEnabled: true,
      morningDigestEnabled: false,
      quietHoursEnabled: true,
      quietStartMinute: 1380,
      quietEndMinute: 480
    }, fixture.clock.now());
    for (const [key, price] of [['expensive', 1_900_000], ['best', 1_500_000]] as const) {
      const stored = (await fixture.repositories.upsert(ticket(key, price), fixture.clock.now())).stored;
      await fixture.repositories.enqueue({
        userId: fixture.user.id,
        subscriptionId: fixture.subscription.id,
        ticketId: stored.id,
        ticketPrice: stored.price,
        notificationType: 'new_ticket',
        queuedAt: fixture.clock.now()
      });
    }
    await fixture.service.execute();
    expect(fixture.telegram.notifications).toHaveLength(0);
    fixture.clock.set(new Date('2026-08-22T03:10:00Z'));
    await fixture.service.execute();
    expect(fixture.telegram.notifications.map((item) => item.ticket.price)).toEqual([1_500_000]);
    fixture.database.close();
  });

  it('отправляет один дайджест после 09:00 и не дублирует его', async () => {
    const fixture = await notificationFixture(new Date('2026-08-22T04:05:00Z'));
    await fixture.repositories.updateNotificationPreferences(fixture.user.id, {
      instantNotificationsEnabled: false,
      morningDigestEnabled: true,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480
    }, fixture.clock.now());
    const stored = (await fixture.repositories.upsert(ticket('digest', 1_500_000), fixture.clock.now())).stored;
    await fixture.repositories.enqueue({
      userId: fixture.user.id,
      subscriptionId: fixture.subscription.id,
      ticketId: stored.id,
      ticketPrice: stored.price,
      notificationType: 'new_ticket',
      queuedAt: new Date('2026-08-22T03:00:00Z')
    });
    await fixture.service.execute();
    await fixture.service.execute();
    expect(fixture.telegram.messages).toHaveLength(1);
    await expect(fixture.database.get('SELECT count(*) AS count FROM digest_deliveries'))
      .resolves.toEqual({ count: 1 });
    await fixture.repositories.updateNotificationPreferences(fixture.user.id, {
      instantNotificationsEnabled: true,
      morningDigestEnabled: true,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480
    }, fixture.clock.now());
    const instant = (await fixture.repositories.upsert(
      ticket('after-digest', 1_400_000),
      fixture.clock.now()
    )).stored;
    await fixture.repositories.enqueue({
      userId: fixture.user.id,
      subscriptionId: fixture.subscription.id,
      ticketId: instant.id,
      ticketPrice: instant.price,
      notificationType: 'new_ticket',
      queuedAt: fixture.clock.now()
    });
    await fixture.service.execute();
    expect(fixture.telegram.notifications).toHaveLength(1);
    fixture.database.close();
  });

  it('не превращает превышение лимита в мгновенное сообщение после полуночи', async () => {
    const fixture = await notificationFixture(new Date('2026-08-21T10:00:00Z'));
    await fixture.repositories.updateNotificationPreferences(fixture.user.id, {
      instantNotificationsEnabled: true,
      morningDigestEnabled: true,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480
    }, fixture.clock.now());
    for (let index = 0; index < 3; index += 1) {
      const sentTicket = (await fixture.repositories.upsert(
        ticket(`already-sent-${index}`, 1_800_000 + index),
        fixture.clock.now()
      )).stored;
      await fixture.repositories.addNotification({
        userId: fixture.user.id,
        subscriptionId: fixture.subscription.id,
        ticketId: sentTicket.id,
        notifiedPrice: sentTicket.price,
        notificationType: 'new_ticket',
        telegramMessageId: index + 1,
        sentAt: fixture.clock.now()
      });
    }
    const overflow = (await fixture.repositories.upsert(
      ticket('overflow', 1_500_000),
      fixture.clock.now()
    )).stored;
    await fixture.repositories.enqueue({
      userId: fixture.user.id,
      subscriptionId: fixture.subscription.id,
      ticketId: overflow.id,
      ticketPrice: overflow.price,
      notificationType: 'new_ticket',
      queuedAt: fixture.clock.now()
    });
    await fixture.service.execute();
    fixture.clock.set(new Date('2026-08-21T20:00:00Z'));
    await fixture.service.execute();
    expect(fixture.telegram.notifications).toHaveLength(0);
    fixture.clock.set(new Date('2026-08-22T04:05:00Z'));
    await fixture.service.execute();
    expect(fixture.telegram.messages).toHaveLength(1);
    fixture.database.close();
  });

  it('не пишет history при ошибке Telegram и успешно повторяет отправку', async () => {
    const fixture = await notificationFixture(new Date('2026-08-21T07:00:00Z'));
    const stored = (await fixture.repositories.upsert(ticket('retry', 1_500_000), fixture.clock.now())).stored;
    await fixture.repositories.enqueue({
      userId: fixture.user.id,
      subscriptionId: fixture.subscription.id,
      ticketId: stored.id,
      ticketPrice: stored.price,
      notificationType: 'new_ticket',
      queuedAt: fixture.clock.now()
    });
    fixture.telegram.failure = new Error('temporary');
    await fixture.service.execute();
    await expect(fixture.database.get('SELECT count(*) AS count FROM notification_history'))
      .resolves.toEqual({ count: 0 });
    fixture.telegram.failure = null;
    fixture.clock.set(new Date('2026-08-21T07:11:00Z'));
    await fixture.service.execute();
    expect(fixture.telegram.notifications).toHaveLength(1);
    fixture.database.close();
  });
});
