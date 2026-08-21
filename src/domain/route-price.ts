import { normalizeIataCode } from './codes.js';
import { assertIsoDate, dateInTimeZone } from './dates.js';
import { assertMoney } from './money.js';
import { sha256 } from './sha256.js';
import type { TripClass } from './travel-preferences.js';

const MILLISECONDS_PER_DAY = 86_400_000;

export interface RoutePriceObservation {
  readonly routeKey: string;
  readonly originCode: string;
  readonly destinationCode: string;
  readonly tripClass: TripClass;
  readonly isDirect: boolean;
  readonly hasBaggage: boolean;
  readonly departureDate: string;
  readonly daysAhead: number;
  readonly price: number;
  readonly currencyCode: string;
  readonly observedAt: Date;
}

export interface RouteDailyPoint {
  readonly day: string;
  readonly minPrice: number;
  readonly averagePrice: number;
  readonly medianPrice: number;
  readonly maxPrice: number;
  readonly sampleCount: number;
}

export function createRouteKey(
  originCode: string,
  destinationCode: string,
  tripClass: TripClass
): string {
  return sha256([
    normalizeIataCode(originCode),
    normalizeIataCode(destinationCode),
    tripClass
  ].join('|'));
}

export function calculateDaysAhead(departureDate: string, observedAt: Date): number {
  const departure = Date.parse(`${assertIsoDate(departureDate)}T00:00:00Z`);
  const observedDay = dateInTimeZone(observedAt, 'Asia/Tashkent');
  const observed = Date.parse(`${observedDay}T00:00:00Z`);
  return Math.max(0, Math.floor((departure - observed) / MILLISECONDS_PER_DAY));
}

export function validateObservation(input: RoutePriceObservation): RoutePriceObservation {
  normalizeIataCode(input.originCode);
  normalizeIataCode(input.destinationCode);
  assertIsoDate(input.departureDate);
  assertMoney(input.price);
  if (!Number.isSafeInteger(input.daysAhead) || input.daysAhead < 0) {
    throw new TypeError('Некорректная глубина бронирования');
  }
  return input;
}
