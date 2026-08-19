import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../src/application/ports.js';
import { TicketService } from '../../../src/application/tickets.js';
import type { Ticket } from '../../../src/domain/ticket.js';
import { MemoryStore } from '../../../src/infrastructure/memory/store.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-05T12:00:00Z');
  }
}

function ticket(index: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    externalKey: `ticket-${index}`,
    originCode: 'TAS',
    destinationCode: index % 2 === 0 ? 'IST' : 'DXB',
    departureDate: '2026-09-15',
    departureAt: null,
    returnDate: null,
    price: 1_000_000,
    currencyCode: 'UZS',
    airlineCode: null,
    airlineName: null,
    isDirect: false,
    tripClass: 'business',
    hasBaggage: true,
    ticketLink: `https://www.aviasales.uz/search/TAS1509IST${index}`,
    rawTicketLink: null,
    rawPayload: {},
    ...overrides
  };
}

async function fixture(): Promise<{
  store: MemoryStore;
  service: TicketService;
}> {
  const clock = new FixedClock();
  const store = new MemoryStore(clock);
  const user = store.seedUser({ telegramUserId: 100, telegramChatId: 200 });
  await store.updateTicketPreferences(user.id, 'business', true, clock.now());
  return { store, service: new TicketService(store, store, clock) };
}

describe('TicketService pagination', () => {
  it('использует TAS/UZS, текущие фильтры и страницы по десять', async () => {
    const { store, service } = await fixture();
    for (let index = 1; index <= 11; index += 1) {
      await store.upsert(ticket(index), new Date('2026-08-05T12:00:00Z'));
    }
    await store.upsert(ticket(20, { tripClass: 'economy' }), new Date('2026-08-05T12:00:00Z'));
    await store.upsert(ticket(21, { hasBaggage: false }), new Date('2026-08-05T12:00:00Z'));

    const first = await service.listPageForTelegramUser(100, {});
    const second = await service.listPageForTelegramUser(100, { offset: 10 });

    expect(first.tickets).toHaveLength(10);
    expect(first.tickets.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(first).toMatchObject({ offset: 0, hasPrevious: false, hasNext: true });
    expect(second.tickets.map((item) => item.id)).toEqual([11]);
    expect(second).toMatchObject({ offset: 10, hasPrevious: true, hasNext: false });
  });

  it('фильтрует выбранное направление', async () => {
    const { store, service } = await fixture();
    await store.upsert(ticket(1, { destinationCode: 'DXB' }), new Date('2026-08-05T12:00:00Z'));
    await store.upsert(ticket(2, { destinationCode: 'IST' }), new Date('2026-08-05T12:00:00Z'));

    const page = await service.listPageForTelegramUser(100, { destinationCode: 'ist' });
    expect(page.destinationCode).toBe('IST');
    expect(page.tickets.map((item) => item.destinationCode)).toEqual(['IST']);
  });

  it.each([-1, 1.5, 10_001])('отклоняет offset %s', async (offset) => {
    const { service } = await fixture();
    await expect(service.listPageForTelegramUser(100, { offset }))
      .rejects.toThrow('Некорректная страница');
  });

  it('загружает направления из базы при cache miss и сохраняет результат', async () => {
    const { store, service } = await fixture();
    await store.upsert(ticket(1, { destinationCode: 'IST' }), new Date('2026-08-05T12:00:00Z'));

    const first = await service.listAvailableDestinations(100, 'international');
    const second = await service.listAvailableDestinations(100, 'international');

    expect(first).toEqual([{ code: 'IST', name: 'Стамбул' }]);
    expect(second).toEqual(first);
    expect(store.activeDestinationQueryCount).toBe(1);
  });

  it('использует общий кэш для локальной и международной вкладок', async () => {
    const { store, service } = await fixture();
    const query = {
      originCode: 'TAS',
      currencyCode: 'UZS',
      departureDateFrom: '2026-08-05',
      tripClass: 'business' as const,
      baggageRequired: true
    };
    await store.saveActiveDestinationsCache(query, ['BHK', 'IST'], new Date('2026-08-05T12:00:00Z'));

    await expect(service.listAvailableDestinations(100, 'domestic'))
      .resolves.toEqual([{ code: 'BHK', name: 'Бухара' }]);
    await expect(service.listAvailableDestinations(100, 'international'))
      .resolves.toEqual([{ code: 'IST', name: 'Стамбул' }]);
    expect(store.activeDestinationQueryCount).toBe(0);
  });
});
