import type {
  AvailableDestination,
  DestinationScope,
  TicketPage
} from '../application/tickets.js';
import { normalizeIataCode } from '../domain/codes.js';
import { ValidationError } from '../domain/errors.js';
import { getLocalizedLocationName } from '../domain/locations.js';
import type { TripClass } from '../domain/travel-preferences.js';
import { TICKET_PAGE_SIZE } from '../domain/travel-preferences.js';
import type { AppLanguage } from './language.js';
import { message } from './language.js';

const MAX_TICKET_OFFSET = 10_000;
export const CITY_PAGE_SIZE = 12;
const CATALOG_PATTERN = /^catalog:(home|dom|intl)(?::(0|[1-9]\d*))?$/u;
const CALLBACK_PATTERN = /^tickets:(ALL|[A-Z0-9]{3}):(0|[1-9]\d*):([EB])([01])$/u;

export interface TicketCursor {
  readonly destinationCode: string | null;
  readonly offset: number;
  readonly tripClass: TripClass;
  readonly baggageRequired: boolean;
}

interface TicketFilter {
  readonly tripClass: TripClass;
  readonly baggageRequired: boolean;
}

function assertOffset(value: number): number {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_TICKET_OFFSET
    || value % TICKET_PAGE_SIZE !== 0
  ) {
    throw new ValidationError('Некорректная страница');
  }
  return value;
}

export function encodeTicketCursor(cursor: TicketCursor): string {
  const destination = cursor.destinationCode === null
    ? 'ALL'
    : normalizeIataCode(cursor.destinationCode);
  const classCode = cursor.tripClass === 'economy' ? 'E' : 'B';
  const baggageCode = cursor.baggageRequired ? '1' : '0';
  return `tickets:${destination}:${assertOffset(cursor.offset)}:${classCode}${baggageCode}`;
}

export function parseTicketCursor(data: string): TicketCursor | null {
  const match = CALLBACK_PATTERN.exec(data);
  if (match === null) return null;
  const destination = match[1];
  const rawOffset = match[2];
  const classCode = match[3];
  const baggageCode = match[4];
  if (
    destination === undefined
    || rawOffset === undefined
    || classCode === undefined
    || baggageCode === undefined
  ) return null;
  const offset = Number(rawOffset);
  try {
    assertOffset(offset);
  } catch {
    return null;
  }
  return {
    destinationCode: destination === 'ALL' ? null : destination,
    offset,
    tripClass: classCode === 'E' ? 'economy' : 'business',
    baggageRequired: baggageCode === '1'
  };
}

export function allDestinationsKeyboard(filter: TicketFilter, language: AppLanguage = 'ru'): unknown {
  return {
    inline_keyboard: [[{
      text: message(language, 'allDestinations'),
      callback_data: encodeTicketCursor({
        destinationCode: null,
        offset: 0,
        ...filter
      })
    }]]
  };
}

export type CatalogCommand =
  | { readonly kind: 'home' }
  | { readonly kind: 'scope'; readonly scope: DestinationScope; readonly offset: number };

function scopeKey(scope: DestinationScope): string {
  return scope === 'domestic' ? 'dom' : 'intl';
}

export function parseCatalogCommand(data: string): CatalogCommand | null {
  const match = CATALOG_PATTERN.exec(data);
  if (match === null) return null;
  const key = match[1];
  if (key === 'home') return { kind: 'home' };
  const offset = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % CITY_PAGE_SIZE !== 0) return null;
  return { kind: 'scope', scope: key === 'dom' ? 'domestic' : 'international', offset };
}

export function catalogTabsKeyboard(filter: TicketFilter, language: AppLanguage = 'ru'): unknown {
  return {
    inline_keyboard: [
      [
        { text: message(language, 'localFlights'), callback_data: 'catalog:dom:0' },
        { text: message(language, 'internationalFlights'), callback_data: 'catalog:intl:0' }
      ],
      [{
        text: message(language, 'allDestinations'),
        callback_data: encodeTicketCursor({ destinationCode: null, offset: 0, ...filter })
      }]
    ]
  };
}

export function catalogCitiesKeyboard(
  scope: DestinationScope,
  cities: readonly AvailableDestination[],
  offset: number,
  filter: TicketFilter,
  language: AppLanguage = 'ru'
): unknown {
  const pageCities = cities.slice(offset, offset + CITY_PAGE_SIZE);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let index = 0; index < pageCities.length; index += 2) {
    rows.push(pageCities.slice(index, index + 2).map((city) => ({
      text: `${getLocalizedLocationName(city.code, language) ?? city.name} (${city.code})`,
      callback_data: encodeTicketCursor({ destinationCode: city.code, offset: 0, ...filter })
    })));
  }
  const key = scopeKey(scope);
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (offset > 0) {
    nav.push({ text: message(language, 'back'), callback_data: `catalog:${key}:${offset - CITY_PAGE_SIZE}` });
  }
  if (offset + CITY_PAGE_SIZE < cities.length) {
    nav.push({ text: message(language, 'moreCities'), callback_data: `catalog:${key}:${offset + CITY_PAGE_SIZE}` });
  }
  if (nav.length > 0) rows.push(nav);
  rows.push([{ text: message(language, 'categories'), callback_data: 'catalog:home' }]);
  return { inline_keyboard: rows };
}

export function ticketNavigationKeyboard(
  page: TicketPage,
  filter: TicketFilter,
  language: AppLanguage = 'ru'
): unknown {
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (page.hasPrevious) {
    buttons.push({
      text: message(language, 'back'),
      callback_data: encodeTicketCursor({
        destinationCode: page.destinationCode,
        offset: Math.max(0, page.offset - TICKET_PAGE_SIZE),
        ...filter
      })
    });
  }
  if (page.hasNext && page.offset + TICKET_PAGE_SIZE <= MAX_TICKET_OFFSET) {
    buttons.push({
      text: message(language, 'showMore'),
      callback_data: encodeTicketCursor({
        destinationCode: page.destinationCode,
        offset: page.offset + TICKET_PAGE_SIZE,
        ...filter
      })
    });
  }
  return { inline_keyboard: buttons.length === 0 ? [] : [buttons] };
}
