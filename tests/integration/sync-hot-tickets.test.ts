import { describe, expect, it } from 'vitest';

import type {
  Clock,
  HotTicketsProvider,
  Logger,
  TicketNotifier
} from '../../src/application/ports.js';
import { SyncHotTicketsJob } from '../../src/application/sync-hot-tickets-job.js';
import { SyncTicketsService } from '../../src/application/sync-tickets.js';
import type { NotificationInput, SyncSource } from '../../src/application/models.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { MemoryStore } from '../../src/infrastructure/memory/store.js';

class MutableClock implements Clock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class FakeProvider implements HotTicketsProvider {
  public calls = 0;
  public readonly tickets = new Map<string, Ticket[]>();
  public readonly errors = new Map<string, Error>();

  public getHotTickets(input: { originCode: string; currencyCode: string }): Promise<Ticket[]> {
    this.calls += 1;
    const key = `${input.originCode}|${input.currencyCode}`;
    const error = this.errors.get(key);
    if (error !== undefined) return Promise.reject(error);
    return Promise.resolve(this.tickets.get(key) ?? []);
  }
}

class FakeNotifier implements TicketNotifier {
  public readonly sent: NotificationInput[] = [];
  public failure: Error | null = null;

  public send(input: NotificationInput): Promise<{ telegramMessageId: number }> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.sent.push(input);
    return Promise.resolve({ telegramMessageId: 1_000 + this.sent.length });
  }
}

class RecordingLogger implements Logger {
  public readonly errors: Array<{ event: string; context?: Readonly<Record<string, unknown>> }> = [];

  public info(): void {}

  public warn(): void {}

  public error(event: string, context?: Readonly<Record<string, unknown>>): void {
    this.errors.push(context === undefined ? { event } : { event, context });
  }
}

const source: SyncSource = {
  id: 1,
  originCode: 'TAS',
  currencyCode: 'UZS',
  isEnabled: true
};

function createTicket(price = 1_850_000): Ticket {
  return {
    externalKey: 'ticket-key',
    originCode: 'TAS',
    destinationCode: 'IST',
    departureDate: '2026-09-15',
    departureAt: '2026-09-15T16:50:00',
    returnDate: null,
    price,
    currencyCode: 'UZS',
    airlineCode: 'HY',
    airlineName: null,
    isDirect: false,
    tripClass: 'economy',
    hasBaggage: false,
    ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
    rawTicketLink: '/TAS1509IST1?token=1',
    rawPayload: {}
  };
}

function createFixture(): {
  clock: MutableClock;
  store: MemoryStore;
  provider: FakeProvider;
  notifier: FakeNotifier;
  logger: RecordingLogger;
  service: SyncTicketsService;
} {
  const clock = new MutableClock(new Date('2026-08-04T12:00:00Z'));
  const store = new MemoryStore(clock);
  const provider = new FakeProvider();
  const notifier = new FakeNotifier();
  const logger = new RecordingLogger();
  const user = store.seedUser({ telegramUserId: 100, telegramChatId: 200 });
  store.seedSubscription({
    userId: user.id,
    originCode: 'TAS',
    destinationCode: 'IST',
    currencyCode: 'UZS',
    departureDateFrom: '2026-09-10',
    departureDateTo: '2026-09-20',
    maxPrice: 2_000_000,
    directOnly: false,
    roundTripOnly: false,
    baggageRequired: false,
    tripClass: 'economy',
    isActive: true
  });
  store.setSyncSources([source]);
  const service = new SyncTicketsService({
    provider,
    ticketRepository: store,
    priceHistoryRepository: store,
    routePriceRepository: store,
    subscriptionRepository: store,
    notificationHistoryRepository: store,
    userRepository: store,
    notifier,
    lockRepository: store,
    syncRunRepository: store,
    clock,
    logger
  });
  return { clock, store, provider, notifier, logger, service };
}

describe('SyncTicketsService', () => {
  it('сохраняет новый билет, историю цены и отправляет new_ticket', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);

    await expect(fixture.service.execute(source)).resolves.toMatchObject({
      status: 'success',
      fetched: 1,
      inserted: 1,
      updated: 0,
      notificationsSent: 1
    });
    expect(fixture.store.getTickets()).toHaveLength(1);
    expect(fixture.store.priceHistoryRecords).toHaveLength(1);
    expect(fixture.store.routePriceObservations).toHaveLength(1);
    expect(fixture.notifier.sent.map((item) => item.type)).toEqual(['new_ticket']);
    expect(fixture.store.notificationRecords).toHaveLength(1);
    expect(fixture.store.syncRunRecords.at(-1)?.status).toBe('success');
  });

  it('учитывает мгновенные уведомления, тихие часы и лимит 3 сообщения в день', async () => {
    const disabled = createFixture();
    const disabledUser = await disabled.store.findByTelegramUserId(100);
    await disabled.store.updateNotificationPreferences(disabledUser?.id ?? 0, {
      instantNotificationsEnabled: false,
      morningDigestEnabled: false,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480
    }, disabled.clock.now());
    disabled.provider.tickets.set('TAS|UZS', [createTicket()]);
    await disabled.service.execute(source);
    expect(disabled.notifier.sent).toHaveLength(0);

    const limited = createFixture();
    limited.provider.tickets.set('TAS|UZS', Array.from({ length: 4 }, (_, index) => ({
      ...createTicket(1_850_000 - index * 10_000),
      externalKey: `ticket-${index}`,
      ticketLink: `https://www.aviasales.uz/search/TAS1509IST${index + 1}`
    })));
    await limited.service.execute(source);
    expect(limited.notifier.sent).toHaveLength(3);

    const quiet = createFixture();
    const quietUser = await quiet.store.findByTelegramUserId(100);
    await quiet.store.updateNotificationPreferences(quietUser?.id ?? 0, {
      instantNotificationsEnabled: true,
      morningDigestEnabled: false,
      quietHoursEnabled: true,
      quietStartMinute: 1000,
      quietEndMinute: 1100
    }, quiet.clock.now());
    quiet.provider.tickets.set('TAS|UZS', [createTicket()]);
    await quiet.service.execute(source);
    expect(quiet.notifier.sent).toHaveLength(0);
  });

  it('обновляет кэш направлений для всех вариантов фильтров', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [
      createTicket(),
      {
        ...createTicket(),
        externalKey: 'business-with-baggage',
        destinationCode: 'DXB',
        tripClass: 'business',
        hasBaggage: true
      }
    ]);

    await fixture.service.execute(source);

    const base = {
      originCode: 'TAS',
      currencyCode: 'UZS',
      departureDateFrom: '2026-08-04'
    };
    await expect(fixture.store.getCachedActiveDestinations({
      ...base,
      tripClass: 'economy',
      baggageRequired: false
    })).resolves.toEqual(['IST']);
    await expect(fixture.store.getCachedActiveDestinations({
      ...base,
      tripClass: 'economy',
      baggageRequired: true
    })).resolves.toEqual([]);
    await expect(fixture.store.getCachedActiveDestinations({
      ...base,
      tripClass: 'business',
      baggageRequired: false
    })).resolves.toEqual(['DXB']);
    await expect(fixture.store.getCachedActiveDestinations({
      ...base,
      tripClass: 'business',
      baggageRequired: true
    })).resolves.toEqual(['DXB']);
  });

  it('не создаёт дубликаты при повторном sync', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);

    await fixture.service.execute(source);
    await fixture.service.execute(source);

    expect(fixture.store.getTickets()).toHaveLength(1);
    expect(fixture.store.priceHistoryRecords).toHaveLength(1);
    expect(fixture.store.routePriceObservations).toHaveLength(1);
    expect(fixture.notifier.sent).toHaveLength(1);
    expect(fixture.store.notificationRecords).toHaveLength(1);
  });

  it('пишет историю и отправляет price_drop при снижении цены', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_850_000)]);
    await fixture.service.execute(source);

    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_650_000)]);
    await fixture.service.execute(source);

    expect(fixture.store.priceHistoryRecords.map((item) => item.price)).toEqual([1_850_000, 1_650_000]);
    expect(fixture.notifier.sent.map((item) => item.type)).toEqual(['new_ticket', 'price_drop']);
    expect(fixture.store.notificationRecords.map((item) => item.notifiedPrice))
      .toEqual([1_850_000, 1_650_000]);
  });

  it('пишет историю без уведомления при повышении цены', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_850_000)]);
    await fixture.service.execute(source);

    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_950_000)]);
    await fixture.service.execute(source);

    expect(fixture.store.priceHistoryRecords.map((item) => item.price)).toEqual([1_850_000, 1_950_000]);
    expect(fixture.notifier.sent).toHaveLength(1);
  });

  it('возвращает skipped и не вызывает provider при занятом lock', async () => {
    const fixture = createFixture();
    await fixture.store.acquire('sync:hot-tickets:TAS:UZS', 300);

    await expect(fixture.service.execute(source)).resolves.toMatchObject({ status: 'skipped' });
    expect(fixture.provider.calls).toBe(0);
  });

  it('освобождает lock и помечает run failed при ошибке provider', async () => {
    const fixture = createFixture();
    fixture.provider.errors.set('TAS|UZS', new Error('provider failed'));

    await expect(fixture.service.execute(source)).rejects.toThrow('provider failed');
    expect(fixture.store.syncRunRecords.at(-1)?.status).toBe('failed');

    fixture.provider.errors.delete('TAS|UZS');
    fixture.provider.tickets.set('TAS|UZS', []);
    await expect(fixture.service.execute(source)).resolves.toMatchObject({ status: 'success' });
  });

  it('не пишет notification history при ошибке Telegram', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);
    fixture.notifier.failure = new Error('telegram failed');

    await expect(fixture.service.execute(source)).rejects.toThrow('telegram failed');
    expect(fixture.store.notificationRecords).toHaveLength(0);
  });

  it('игнорирует неактивную подписку', async () => {
    const fixture = createFixture();
    fixture.store.setSubscriptionsActive(false);
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);

    await fixture.service.execute(source);
    expect(fixture.notifier.sent).toHaveLength(0);
  });

  it('не меняет класс существующей подписки при изменении профиля', async () => {
    const fixture = createFixture();
    const user = await fixture.store.findByTelegramUserId(100);
    await fixture.store.updateTicketPreferences(user?.id ?? 0, 'business', false, fixture.clock.now());
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);

    await fixture.service.execute(source);

    expect(fixture.notifier.sent).toHaveLength(1);
    expect(fixture.store.notificationRecords).toHaveLength(1);
  });

  it('хранит класс и багаж на уровне подписки, а не профиля', async () => {
    const withoutBaggage = createFixture();
    const firstUser = await withoutBaggage.store.findByTelegramUserId(100);
    await withoutBaggage.store.updateTicketPreferences(
      firstUser?.id ?? 0,
      'business',
      true,
      withoutBaggage.clock.now()
    );
    withoutBaggage.provider.tickets.set('TAS|UZS', [{
      ...createTicket(),
      tripClass: 'business',
      hasBaggage: false
    }]);
    await withoutBaggage.service.execute(source);
    expect(withoutBaggage.notifier.sent).toHaveLength(0);

    const withBaggage = createFixture();
    const secondUser = await withBaggage.store.findByTelegramUserId(100);
    await withBaggage.store.updateTicketPreferences(
      secondUser?.id ?? 0,
      'business',
      true,
      withBaggage.clock.now()
    );
    withBaggage.provider.tickets.set('TAS|UZS', [{
      ...createTicket(),
      tripClass: 'business',
      hasBaggage: true
    }]);
    await withBaggage.service.execute(source);
    expect(withBaggage.notifier.sent).toHaveLength(0);
  });

  it('сразу деактивирует билет, отсутствующий в успешном response', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);
    await fixture.service.execute(source);

    fixture.provider.tickets.set('TAS|UZS', []);
    await fixture.service.execute(source);

    expect(fixture.store.getTickets()[0]?.isActive).toBe(false);
  });

  it('не деактивирует сохранённый билет при ошибке provider', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);
    await fixture.service.execute(source);

    fixture.provider.errors.set('TAS|UZS', new Error('provider failed'));
    await expect(fixture.service.execute(source)).rejects.toThrow('provider failed');

    expect(fixture.store.getTickets()[0]?.isActive).toBe(true);
  });
});

describe('SyncHotTicketsJob', () => {
  it('ошибка одной пары не останавливает остальные', async () => {
    const fixture = createFixture();
    fixture.store.setSyncSources([
      { id: 2, originCode: 'ALA', currencyCode: 'KZT', isEnabled: true },
      source
    ]);
    fixture.provider.errors.set('ALA|KZT', new Error('ALA failed'));
    fixture.provider.tickets.set('TAS|UZS', []);
    const job = new SyncHotTicketsJob(fixture.store, fixture.service, fixture.logger);

    await expect(job.execute()).resolves.toEqual({ processedSources: 1 });
    expect(fixture.provider.calls).toBe(2);
    expect(fixture.logger.errors[0]?.event).toBe('ticket_sync_source_failed');
  });
});
