import type { StoredTicket, TicketSort } from './models.js';
import type { Clock, TicketRepository, UserRepository } from './ports.js';
import { normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate, dateInTimeZone } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { assertMoney } from '../domain/money.js';

export interface TicketListingOptions {
  destinationCode?: string;
  departureDateFrom?: string;
  departureDateTo?: string;
  maxPrice?: number;
  directOnly?: boolean;
  sort?: TicketSort;
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
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start');
    const departureDateFrom = options.departureDateFrom === undefined
      ? dateInTimeZone(this.clock.now(), 'Asia/Tashkent')
      : assertIsoDate(options.departureDateFrom);

    return this.tickets.listActive({
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      departureDateFrom,
      departureDateTo: options.departureDateTo === undefined ? null : assertIsoDate(options.departureDateTo),
      destinationCode: options.destinationCode === undefined ? null : normalizeIataCode(options.destinationCode),
      maxPrice: options.maxPrice === undefined ? null : assertMoney(options.maxPrice),
      directOnly: options.directOnly ?? false,
      tripClass: user.preferredTripClass,
      baggageRequired: user.baggageRequired,
      sort: options.sort ?? 'price_asc',
      limit: 5,
      offset: 0
    });
  }
}
