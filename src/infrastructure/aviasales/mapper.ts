import type { Logger } from '../../application/ports.js';
import { normalizeCurrencyCode, normalizeIataCode } from '../../domain/codes.js';
import { assertIsoDate } from '../../domain/dates.js';
import { assertMoney } from '../../domain/money.js';
import {
  createExternalKey,
  extractTicketSearchCode,
  normalizeTicketLink,
  type Ticket
} from '../../domain/ticket.js';
import type { TripClass } from '../../domain/travel-preferences.js';
import {
  isRecord,
  requireBoolean,
  requireNumber,
  requireRecord,
  requireString
} from './guards.js';

export class AviasalesResponseError extends Error {
  public override readonly name = 'AviasalesResponseError';
}

function parseDepartureAt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = requireString(value, 'depart_date_time');
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(raw);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new TypeError('Поле depart_date_time имеет неверный формат');
  }
  assertIsoDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) throw new TypeError('Поле depart_date_time имеет неверное время');
  return `${match[1]}T${match[2]}:${match[3]}:00`;
}

function parseOptionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  const raw = requireString(value, field).trim();
  if (raw.length === 0) return null;
  return assertIsoDate(raw);
}

function parseOptionalAirline(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, 'airline').trim().toUpperCase();
}

function mapTripClass(value: unknown): TripClass {
  const tripClass = requireNumber(value, 'trip_class');
  if (tripClass === 1) return 'economy';
  if (tripClass === 2) return 'business';
  throw new TypeError('Поле trip_class содержит неизвестный класс');
}

function mapDirection(direction: unknown): Ticket {
  const rawDirection = requireRecord(direction, 'direction');
  const ticketContainer = requireRecord(rawDirection.ticket, 'ticket');
  const price = requireRecord(ticketContainer.price, 'ticket.price');

  const originCode = normalizeIataCode(requireString(price.origin, 'origin'));
  const destinationCode = normalizeIataCode(requireString(rawDirection.destination_iata, 'destination_iata'));
  const departureDate = assertIsoDate(requireString(price.depart_date, 'depart_date'));
  const currencyCode = normalizeCurrencyCode(requireString(price.currency, 'currency'));
  const ticketPrice = assertMoney(requireNumber(price.value, 'value'));
  const numberOfChanges = requireNumber(price.number_of_changes, 'number_of_changes');
  if (!Number.isSafeInteger(numberOfChanges) || numberOfChanges < 0) {
    throw new TypeError('Поле number_of_changes должно быть неотрицательным integer');
  }

  const rawTicketLink = requireString(price.ticket_link, 'ticket_link');
  const ticketLink = normalizeTicketLink(rawTicketLink);
  const ticketSearchCode = extractTicketSearchCode(ticketLink);
  const tripClass = mapTripClass(price.trip_class);

  return {
    externalKey: createExternalKey({
      originCode,
      destinationCode,
      departureDate,
      ticketSearchCode,
      currencyCode,
      tripClass
    }),
    originCode,
    destinationCode,
    departureDate,
    departureAt: parseDepartureAt(price.depart_date_time),
    returnDate: parseOptionalDate(price.return_date, 'return_date'),
    price: ticketPrice,
    currencyCode,
    airlineCode: parseOptionalAirline(price.airline),
    airlineName: null,
    isDirect: numberOfChanges === 0,
    tripClass,
    hasBaggage: requireBoolean(price.with_baggage, 'with_baggage'),
    ticketLink,
    rawTicketLink,
    rawPayload: rawDirection
  };
}

export function mapHotOffersResponse(value: unknown, logger: Logger): Ticket[] {
  if (!isRecord(value) || !Array.isArray(value.directions)) {
    throw new AviasalesResponseError('Ответ Aviasales не содержит массив directions');
  }

  const tickets: Ticket[] = [];
  value.directions.forEach((direction, index) => {
    try {
      tickets.push(mapDirection(direction));
    } catch (error: unknown) {
      logger.warn('aviasales_offer_mapping_failed', {
        index,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка mapper'
      });
    }
  });
  return tickets;
}
