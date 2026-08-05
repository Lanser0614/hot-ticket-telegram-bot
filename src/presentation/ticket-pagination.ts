import type { TicketPage } from '../application/tickets.js';
import { normalizeIataCode } from '../domain/codes.js';
import { ValidationError } from '../domain/errors.js';
import type { TripClass } from '../domain/travel-preferences.js';
import { TICKET_PAGE_SIZE } from '../domain/travel-preferences.js';

const MAX_TICKET_OFFSET = 10_000;
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

export function allDestinationsKeyboard(filter: TicketFilter): unknown {
  return {
    inline_keyboard: [[{
      text: '🌍 Все направления из Ташкента',
      callback_data: encodeTicketCursor({
        destinationCode: null,
        offset: 0,
        ...filter
      })
    }]]
  };
}

export function ticketNavigationKeyboard(
  page: TicketPage,
  filter: TicketFilter
): unknown {
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (page.hasPrevious) {
    buttons.push({
      text: '⬅️ Назад',
      callback_data: encodeTicketCursor({
        destinationCode: page.destinationCode,
        offset: Math.max(0, page.offset - TICKET_PAGE_SIZE),
        ...filter
      })
    });
  }
  if (page.hasNext) {
    buttons.push({
      text: '➡️ Показать ещё',
      callback_data: encodeTicketCursor({
        destinationCode: page.destinationCode,
        offset: page.offset + TICKET_PAGE_SIZE,
        ...filter
      })
    });
  }
  return { inline_keyboard: buttons.length === 0 ? [] : [buttons] };
}
