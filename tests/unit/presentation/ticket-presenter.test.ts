import { describe, expect, it } from 'vitest';

import type { StoredTicket } from '../../../src/application/models.js';
import { presentTicket } from '../../../src/presentation/ticket-presenter.js';

function storedTicket(overrides: Partial<StoredTicket>): StoredTicket {
  const now = new Date('2026-08-06T00:00:00Z');
  return {
    id: 1,
    externalKey: 'key',
    originCode: 'TAS',
    destinationCode: 'DXB',
    departureDate: '2026-08-09',
    departureAt: null,
    returnDate: null,
    price: 3_300_103,
    currencyCode: 'UZS',
    airlineCode: 'C6',
    airlineName: null,
    isDirect: true,
    tripClass: 'economy',
    hasBaggage: false,
    ticketLink: 'https://www.aviasales.uz/search/TAS0908DXB1',
    rawTicketLink: null,
    rawPayload: {},
    firstSeenAt: now,
    lastSeenAt: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('presentTicket', () => {
  it('показывает туда-обратно с датой возврата', () => {
    const text = presentTicket(storedTicket({ returnDate: '2026-08-13' }));

    expect(text).toContain('🔁 Тип: туда-обратно');
    expect(text).toContain('📅 Вылет: 9 августа 2026');
    expect(text).toContain('📅 Обратно: 13 августа 2026');
  });

  it('показывает в одну сторону без строки возврата', () => {
    const text = presentTicket(storedTicket({ returnDate: null }));

    expect(text).toContain('🔁 Тип: в одну сторону');
    expect(text).not.toContain('Обратно');
  });
});
