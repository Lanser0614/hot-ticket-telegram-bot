import type { StoredTicket } from './models.js';
import type { Clock, TicketRepository, UserRepository } from './ports.js';
import { normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate, dateInTimeZone } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import {
  getLocationCountryCode,
  getLocationName
} from '../domain/locations.js';
import { assertMoney } from '../domain/money.js';
import {
  TICKET_PAGE_SIZE
} from '../domain/travel-preferences.js';

export const MAX_TICKET_OFFSET = 10_000;

export interface TicketListingOptions {
  destinationCode?: string;
  departureDateFrom?: string;
  departureDateTo?: string;
  maxPrice?: number;
  directOnly?: boolean;
  offset?: number;
}

export interface TicketPage {
  readonly tickets: readonly StoredTicket[];
  readonly destinationCode: string | null;
  readonly offset: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export type DestinationScope = 'domestic' | 'international';

export interface AvailableDestination {
  readonly code: string;
  readonly name: string;
}

const DOMESTIC_COUNTRY_CODE = 'UZ';

export class TicketService {
  public constructor(
    private readonly users: UserRepository,
    private readonly tickets: TicketRepository,
    private readonly clock: Clock
  ) {}

  public async listForTelegramUser(
    telegramUserId: number,
    options: TicketListingOptions
  ): Promise<readonly StoredTicket[]> {
    return (await this.listPageForTelegramUser(telegramUserId, options)).tickets;
  }

  public async listAvailableDestinations(
    telegramUserId: number,
    scope: DestinationScope
  ): Promise<readonly AvailableDestination[]> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start');
    const departureDateFrom = dateInTimeZone(this.clock.now(), 'Asia/Tashkent');
    const query = {
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      departureDateFrom,
      tripClass: user.preferredTripClass,
      baggageRequired: user.baggageRequired
    };
    let codes = await this.tickets.getCachedActiveDestinations(query);
    if (codes === null) {
      codes = await this.tickets.listActiveDestinations(query);
      await this.tickets.saveActiveDestinationsCache(query, codes, this.clock.now());
    }
    const destinations: AvailableDestination[] = [];
    for (const code of codes) {
      const isDomestic = getLocationCountryCode(code) === DOMESTIC_COUNTRY_CODE;
      if (scope === 'domestic' ? !isDomestic : isDomestic) continue;
      destinations.push({ code, name: getLocationName(code) ?? code });
    }
    destinations.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    return destinations;
  }

  public async listPageForTelegramUser(
    telegramUserId: number,
    options: TicketListingOptions
  ): Promise<TicketPage> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start');
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_TICKET_OFFSET) {
      throw new ValidationError('Некорректная страница');
    }
    const departureDateFrom = options.departureDateFrom === undefined
      ? dateInTimeZone(this.clock.now(), 'Asia/Tashkent')
      : assertIsoDate(options.departureDateFrom);
    const destinationCode = options.destinationCode === undefined
      ? null
      : normalizeIataCode(options.destinationCode);

    const rows = await this.tickets.listActive({
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      departureDateFrom,
      departureDateTo: options.departureDateTo === undefined ? null : assertIsoDate(options.departureDateTo),
      destinationCode,
      maxPrice: options.maxPrice === undefined ? null : assertMoney(options.maxPrice),
      directOnly: options.directOnly ?? false,
      tripClass: user.preferredTripClass,
      baggageRequired: user.baggageRequired,
      sort: 'price_asc',
      limit: TICKET_PAGE_SIZE + 1,
      offset
    });
    return {
      tickets: rows.slice(0, TICKET_PAGE_SIZE),
      destinationCode,
      offset,
      hasPrevious: offset > 0,
      hasNext: rows.length > TICKET_PAGE_SIZE
    };
  }
}
