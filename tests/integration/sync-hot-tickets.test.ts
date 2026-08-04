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
    price,
    currencyCode: 'UZS',
    airlineCode: 'HY',
    airlineName: null,
    isDirect: false,
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
    baggageRequired: false,
    isActive: true
  });
  store.setSyncSources([source]);
  const service = new SyncTicketsService({
    provider,
    ticketRepository: store,
    priceHistoryRepository: store,
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
  it('сохраняет новый билет и отправляет new_ticket без начальной price history', async () => {
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
    expect(fixture.store.priceHistoryRecords).toHaveLength(0);
    expect(fixture.notifier.sent.map((item) => item.type)).toEqual(['new_ticket']);
    expect(fixture.store.notificationRecords).toHaveLength(1);
    expect(fixture.store.syncRunRecords.at(-1)?.status).toBe('success');
  });

  it('не создаёт дубликаты при повторном sync', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);

    await fixture.service.execute(source);
    await fixture.service.execute(source);

    expect(fixture.store.getTickets()).toHaveLength(1);
    expect(fixture.store.priceHistoryRecords).toHaveLength(0);
    expect(fixture.notifier.sent).toHaveLength(1);
    expect(fixture.store.notificationRecords).toHaveLength(1);
  });

  it('пишет историю и отправляет price_drop при снижении цены', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_850_000)]);
    await fixture.service.execute(source);

    fixture.provider.tickets.set('TAS|UZS', [createTicket(1_650_000)]);
    await fixture.service.execute(source);

    expect(fixture.store.priceHistoryRecords.map((item) => item.price)).toEqual([1_650_000]);
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

    expect(fixture.store.priceHistoryRecords.map((item) => item.price)).toEqual([1_950_000]);
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

  it('деактивирует билет, не встречавшийся шесть часов', async () => {
    const fixture = createFixture();
    fixture.provider.tickets.set('TAS|UZS', [createTicket()]);
    await fixture.service.execute(source);

    fixture.clock.advance(7 * 60 * 60 * 1_000);
    fixture.provider.tickets.set('TAS|UZS', []);
    await fixture.service.execute(source);

    expect(fixture.store.getTickets()[0]?.isActive).toBe(false);
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
