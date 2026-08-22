import { normalizeCurrencyCode, normalizeIataCode } from './codes.js';
import { assertIsoDate, isDateInRange } from './dates.js';
import { ValidationError } from './errors.js';
import { assertMoney } from './money.js';
import type { Ticket } from './ticket.js';
import type { TripClass } from './travel-preferences.js';

export interface Subscription {
  id: number;
  userId: number;
  originCode: string;
  destinationCode: string | null;
  currencyCode: string;
  departureDateFrom: string;
  departureDateTo: string;
  maxPrice: number | null;
  directOnly: boolean;
  roundTripOnly: boolean;
  baggageRequired: boolean;
  tripClass: TripClass;
  isActive: boolean;
}

export type SubscriptionDraft = Omit<Subscription, 'id' | 'isActive'>;

function assertPositiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`Некорректный идентификатор ${field}`);
  }
  return value;
}

export function validateSubscriptionDraft(value: SubscriptionDraft): SubscriptionDraft {
  const departureDateFrom = assertIsoDate(value.departureDateFrom);
  const departureDateTo = assertIsoDate(value.departureDateTo);
  if (departureDateFrom > departureDateTo) {
    throw new ValidationError('Начальная дата позже конечной');
  }

  return {
    ...value,
    userId: assertPositiveId(value.userId, 'пользователя'),
    originCode: normalizeIataCode(value.originCode),
    destinationCode: value.destinationCode === null
      ? null
      : normalizeIataCode(value.destinationCode),
    currencyCode: normalizeCurrencyCode(value.currencyCode),
    departureDateFrom,
    departureDateTo,
    maxPrice: value.maxPrice === null ? null : assertMoney(value.maxPrice)
  };
}

export function validateSubscription(value: Subscription): Subscription {
  return {
    ...validateSubscriptionDraft(value),
    id: assertPositiveId(value.id, 'подписки'),
    isActive: value.isActive
  };
}

export function matchesSubscription(ticket: Ticket, subscription: Subscription): boolean {
  return subscription.isActive
    && ticket.originCode === subscription.originCode
    && ticket.currencyCode === subscription.currencyCode
    && (subscription.destinationCode === null || ticket.destinationCode === subscription.destinationCode)
    && isDateInRange(
      ticket.departureDate,
      subscription.departureDateFrom,
      subscription.departureDateTo
    )
    && (subscription.maxPrice === null || ticket.price <= subscription.maxPrice)
    && (!subscription.directOnly || ticket.isDirect)
    && (!subscription.roundTripOnly || ticket.returnDate !== null)
    && (!subscription.baggageRequired || ticket.hasBaggage)
    && ticket.tripClass === subscription.tripClass;
}
