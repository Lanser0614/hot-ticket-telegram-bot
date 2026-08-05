import type { StoredTicket, TicketSort } from './models.js';
import type { Clock, TicketRepository, UserRepository } from './ports.js';
import { normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate, dateInTimeZone } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { assertMoney } from '../domain/money.js';
import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_ORIGIN_CODE,
  TICKET_PAGE_SIZE
} from '../domain/travel-preferences.js';

export const MAX_TICKET_OFFSET = 10_000;

export interface TicketListingOptions {
  destinationCode?: string;
  departureDateFrom?: string;
  departureDateTo?: string;
  maxPrice?: number;
  directOnly?: boolean;
  sort?: TicketSort;
  offset?: number;
}

export interface TicketPage {
  readonly tickets: readonly StoredTicket[];
  readonly destinationCode: string | null;
  readonly offset: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

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
      originCode: DEFAULT_ORIGIN_CODE,
      currencyCode: DEFAULT_CURRENCY_CODE,
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
