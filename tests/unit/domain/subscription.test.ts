import { describe, expect, it } from 'vitest';

import {
  matchesSubscription,
  validateSubscription,
  type Subscription
} from '../../../src/domain/subscription.js';
import type { Ticket } from '../../../src/domain/ticket.js';

const ticket: Ticket = {
  externalKey: 'key',
  originCode: 'TAS',
  destinationCode: 'IST',
  departureDate: '2026-09-15',
  departureAt: '2026-09-15T16:50:00',
  returnDate: null,
  price: 1_850_000,
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

const subscription: Subscription = {
  id: 1,
  userId: 10,
  originCode: 'TAS',
  destinationCode: 'IST',
  currencyCode: 'UZS',
  departureDateFrom: '2026-09-10',
  departureDateTo: '2026-09-20',
  maxPrice: 2_000_000,
  directOnly: false,
  roundTripOnly: false,
  baggageRequired: false,
  isActive: true
};

describe('matchesSubscription', () => {
  it('принимает билет, совпадающий со всеми фильтрами', () => {
    expect(matchesSubscription(ticket, subscription)).toBe(true);
  });

  it('поддерживает любое направление и отсутствие максимальной цены', () => {
    expect(matchesSubscription(ticket, {
      ...subscription,
      destinationCode: null,
      maxPrice: null
    })).toBe(true);
  });

  it.each<Partial<Subscription>>([
    { originCode: 'SKD' },
    { destinationCode: 'DXB' },
    { currencyCode: 'USD' },
    { departureDateFrom: '2026-09-16' },
    { departureDateTo: '2026-09-14' },
    { maxPrice: 1_849_999 },
    { directOnly: true },
    { roundTripOnly: true },
    { isActive: false }
  ])('отклоняет несовпадение %j', (override) => {
    expect(matchesSubscription(ticket, { ...subscription, ...override })).toBe(false);
  });

  it('принимает round-trip билет для подписки только туда-обратно', () => {
    expect(matchesSubscription(
      { ...ticket, returnDate: '2026-09-20' },
      { ...subscription, roundTripOnly: true }
    )).toBe(true);
  });

  it('игнорирует legacy baggage_required подписки', () => {
    expect(matchesSubscription(ticket, { ...subscription, baggageRequired: true })).toBe(true);
  });

  it('проверяет границы диапазона включительно', () => {
    expect(matchesSubscription({ ...ticket, departureDate: '2026-09-10' }, subscription)).toBe(true);
    expect(matchesSubscription({ ...ticket, departureDate: '2026-09-20' }, subscription)).toBe(true);
  });

  it('нормализует и валидирует подписку', () => {
    expect(validateSubscription({
      ...subscription,
      originCode: 'tas',
      destinationCode: 'ist',
      currencyCode: 'uzs'
    })).toMatchObject({ originCode: 'TAS', destinationCode: 'IST', currencyCode: 'UZS' });
  });
});
