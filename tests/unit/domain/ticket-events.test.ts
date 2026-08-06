import { describe, expect, it } from 'vitest';

import { detectTicketEvent, notificationKey } from '../../../src/domain/ticket-events.js';
import type { Ticket } from '../../../src/domain/ticket.js';

const ticket: Ticket = {
  externalKey: 'key',
  originCode: 'TAS',
  destinationCode: 'IST',
  departureDate: '2026-09-15',
  departureAt: null,
  returnDate: null,
  price: 1_850_000,
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

describe('detectTicketEvent', () => {
  it('определяет новый билет', () => {
    expect(detectTicketEvent(null, ticket)).toBe('new_ticket');
  });

  it('определяет снижение цены', () => {
    expect(detectTicketEvent({ ...ticket, price: 2_000_000 }, ticket)).toBe('price_drop');
  });

  it('не создаёт событие при прежней или выросшей цене', () => {
    expect(detectTicketEvent({ ...ticket }, ticket)).toBeNull();
    expect(detectTicketEvent({ ...ticket, price: 1_700_000 }, ticket)).toBeNull();
  });
});

describe('notificationKey', () => {
  it('строит ключ из пользователя, подписки, билета и цены', () => {
    expect(notificationKey({
      userId: 10,
      subscriptionId: 20,
      ticketId: 30,
      notifiedPrice: 1_850_000
    })).toBe('10|20|30|1850000');
  });
});
