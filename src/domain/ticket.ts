import { normalizeCurrencyCode, normalizeIataCode } from './codes.js';
import { assertIsoDate } from './dates.js';
import { ValidationError } from './errors.js';
import { assertMoney } from './money.js';
import { sha256 } from './sha256.js';
import type { TripClass } from './travel-preferences.js';

const AVIASALES_HOSTS = new Set(['aviasales.uz', 'www.aviasales.uz']);
const SEARCH_CODE_PATTERN = /^[A-Z0-9]+$/;

export interface Ticket {
  externalKey: string;
  originCode: string;
  destinationCode: string;
  departureDate: string;
  departureAt: string | null;
  price: number;
  currencyCode: string;
  airlineCode: string | null;
  airlineName: string | null;
  isDirect: boolean;
  tripClass: TripClass;
  hasBaggage: boolean;
  ticketLink: string;
  rawTicketLink: string | null;
  rawPayload: unknown;
}

export interface ExternalKeyInput {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  ticketSearchCode: string;
  currencyCode: string;
  tripClass: TripClass;
}

function assertSearchCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!SEARCH_CODE_PATTERN.test(normalized)) {
    throw new ValidationError('Некорректный поисковый код Aviasales');
  }
  return normalized;
}

function searchCodeFromLink(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Ссылка на билет не может быть пустой');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError('Некорректная ссылка Aviasales');
    }

    if (parsed.protocol !== 'https:' || !AVIASALES_HOSTS.has(parsed.hostname)) {
      throw new ValidationError('Некорректная ссылка Aviasales');
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'search' || segments[1] === undefined) {
      throw new ValidationError('Некорректная ссылка Aviasales');
    }
    return assertSearchCode(segments[1]);
  }

  const path = trimmed.split(/[?#]/u, 1)[0]?.replace(/^\/+/, '') ?? '';
  const segments = path.split('/').filter(Boolean);
  const candidate = segments[0] === 'search' ? segments[1] : segments[0];
  if (candidate === undefined || segments.length > (segments[0] === 'search' ? 2 : 1)) {
    throw new ValidationError('Некорректная ссылка Aviasales');
  }
  return assertSearchCode(candidate);
}

export function normalizeTicketLink(value: string): string {
  return `https://www.aviasales.uz/search/${searchCodeFromLink(value)}`;
}

export function extractTicketSearchCode(value: string): string {
  return searchCodeFromLink(value);
}

export function createExternalKey(input: ExternalKeyInput): string {
  const parts = [
    normalizeIataCode(input.originCode),
    normalizeIataCode(input.destinationCode),
    assertIsoDate(input.departureDate),
    assertSearchCode(input.ticketSearchCode),
    normalizeCurrencyCode(input.currencyCode),
    input.tripClass
  ];
  return sha256(parts.join('|'));
}

export function validateTicket(ticket: Ticket): Ticket {
  normalizeIataCode(ticket.originCode);
  normalizeIataCode(ticket.destinationCode);
  assertIsoDate(ticket.departureDate);
  assertMoney(ticket.price);
  normalizeCurrencyCode(ticket.currencyCode);
  normalizeTicketLink(ticket.ticketLink);
  return ticket;
}
