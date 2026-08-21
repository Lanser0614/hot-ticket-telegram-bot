import type { StoredTicket, TicketSort, User } from './models.js';
import type {
  Clock,
  RoutePriceRepository,
  TicketRepository,
  TrackedLinkFactory,
  UserRepository
} from './ports.js';
import type { SubscriptionService, CreateSubscriptionInput } from './subscriptions.js';
import { calculateDealScore, type DealScore } from '../domain/deal-score.js';
import { normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate, dateInTimeZone } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { getLocalizedLocationName, isUzbekistanOrigin } from '../domain/locations.js';
import { assertMoney } from '../domain/money.js';
import { createRouteKey, type RouteDailyPoint } from '../domain/route-price.js';
import type { Subscription } from '../domain/subscription.js';
import type { TripClass } from '../domain/travel-preferences.js';

export type MiniAppDealSort = 'best' | 'cheapest' | 'recent' | 'departing_soon';

export interface MiniAppDealQuery {
  readonly destinationCode: string | null;
  readonly departureDateFrom: string | null;
  readonly departureDateTo: string | null;
  readonly maxPrice: number | null;
  readonly directOnly: boolean;
  readonly baggageRequired: boolean;
  readonly sort: MiniAppDealSort;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface MiniAppTicketView {
  readonly id: number;
  readonly originCode: string;
  readonly originName: string;
  readonly destinationCode: string;
  readonly destinationName: string;
  readonly departureDate: string;
  readonly returnDate: string | null;
  readonly price: number;
  readonly currencyCode: string;
  readonly airlineName: string | null;
  readonly isDirect: boolean;
  readonly tripClass: TripClass;
  readonly hasBaggage: boolean;
  readonly lastSeenAt: string;
  readonly dealScore: DealScore;
  readonly openUrl: string;
}

interface DecodedCursor {
  readonly offset: number;
}

function decodeCursor(value: string | null): DecodedCursor {
  if (value === null) return { offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const offset = (parsed as Readonly<Record<string, unknown>>).offset;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      throw new Error();
    }
    return { offset };
  } catch {
    throw new ValidationError('Некорректный cursor');
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function repositorySort(sort: MiniAppDealSort): TicketSort {
  if (sort === 'recent') return 'recently_added';
  if (sort === 'departing_soon') return 'departure_date_asc';
  return 'price_asc';
}

function userLanguage(languageCode: string | null): 'ru' | 'uz' {
  return languageCode?.toLocaleLowerCase('en-US').startsWith('uz') === true ? 'uz' : 'ru';
}

function scoreOrder(left: MiniAppTicketView, right: MiniAppTicketView): number {
  return (right.dealScore.percentile ?? -1) - (left.dealScore.percentile ?? -1)
    || left.price - right.price
    || left.id - right.id;
}

export class MiniAppService {
  public constructor(
    private readonly users: UserRepository,
    private readonly tickets: TicketRepository,
    private readonly routePrices: RoutePriceRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly links: TrackedLinkFactory,
    private readonly clock: Clock
  ) {}

  public async requireUser(telegramUserId: number): Promise<User> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start в боте');
    return user;
  }

  public async listDeals(
    telegramUserId: number,
    input: MiniAppDealQuery
  ): Promise<{ readonly items: readonly MiniAppTicketView[]; readonly nextCursor: string | null }> {
    const user = await this.requireUser(telegramUserId);
    const { offset } = decodeCursor(input.cursor);
    const departureDateFrom = input.departureDateFrom === null
      ? dateInTimeZone(this.clock.now(), 'Asia/Tashkent')
      : assertIsoDate(input.departureDateFrom);
    const destinationCode = input.destinationCode === null
      ? null
      : normalizeIataCode(input.destinationCode);
    const candidateLimit = input.sort === 'best'
      ? Math.min(500, Math.max(100, offset + input.limit + 1))
      : input.limit + 1;
    const rows = await this.tickets.listActive({
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      departureDateFrom,
      departureDateTo: input.departureDateTo === null
        ? null
        : assertIsoDate(input.departureDateTo),
      destinationCode,
      maxPrice: input.maxPrice === null ? null : assertMoney(input.maxPrice),
      directOnly: input.directOnly,
      tripClass: user.preferredTripClass,
      baggageRequired: input.baggageRequired || user.baggageRequired,
      sort: repositorySort(input.sort),
      limit: candidateLimit,
      offset: input.sort === 'best' ? 0 : offset
    });
    const decorated = await Promise.all(rows.map((ticket) => (
      this.ticketView(ticket, user.id, 'miniapp_deals', 30, userLanguage(user.languageCode))
    )));
    if (input.sort === 'best') decorated.sort(scoreOrder);
    const page = input.sort === 'best'
      ? decorated.slice(offset, offset + input.limit + 1)
      : decorated;
    const hasMore = page.length > input.limit;
    return {
      items: page.slice(0, input.limit),
      nextCursor: hasMore ? encodeCursor(offset + input.limit) : null
    };
  }

  public async getTicket(telegramUserId: number, ticketId: number): Promise<MiniAppTicketView> {
    const user = await this.requireUser(telegramUserId);
    const ticket = await this.tickets.findTicketById(ticketId);
    if (ticket === null || !ticket.isActive) throw new ValidationError('Билет не найден');
    return this.ticketView(ticket, user.id, 'miniapp_card', 30, userLanguage(user.languageCode));
  }

  public async getHistory(
    telegramUserId: number,
    originCode: string,
    destinationCode: string,
    days: number
  ): Promise<readonly RouteDailyPoint[]> {
    const user = await this.requireUser(telegramUserId);
    const allowedDays = days === 7 || days === 30 || days === 90 ? days : 30;
    const routeKey = createRouteKey(
      normalizeIataCode(originCode),
      normalizeIataCode(destinationCode),
      user.preferredTripClass
    );
    return this.routePrices.getDailySeries(routeKey, allowedDays, this.clock.now());
  }

  public async listDestinations(telegramUserId: number): Promise<readonly {
    code: string;
    name: string;
  }[]> {
    const user = await this.requireUser(telegramUserId);
    const codes = await this.tickets.listActiveDestinations({
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      departureDateFrom: dateInTimeZone(this.clock.now(), 'Asia/Tashkent'),
      tripClass: user.preferredTripClass,
      baggageRequired: user.baggageRequired
    });
    const language = userLanguage(user.languageCode);
    return codes.map((code) => ({ code, name: getLocalizedLocationName(code, language) ?? code }));
  }

  public async listSubscriptions(telegramUserId: number): Promise<readonly Subscription[]> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.listForUser(user.id);
  }

  public async createSubscription(
    telegramUserId: number,
    input: CreateSubscriptionInput
  ): Promise<Subscription> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.createForUser(user.id, input);
  }

  public async deactivateSubscription(
    telegramUserId: number,
    subscriptionId: number
  ): Promise<boolean> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.deactivateForUser(user.id, subscriptionId);
  }

  public async getProfile(telegramUserId: number): Promise<User> {
    return this.requireUser(telegramUserId);
  }

  public async completeOnboarding(
    telegramUserId: number,
    languageCode: 'ru' | 'uz',
    defaultOriginCode: string
  ): Promise<User> {
    const user = await this.requireUser(telegramUserId);
    const originCode = normalizeIataCode(defaultOriginCode);
    if (!isUzbekistanOrigin(originCode)) {
      throw new ValidationError('Город вылета должен находиться в Узбекистане');
    }
    const now = this.clock.now();
    await this.users.completeOnboarding(user.id, languageCode, originCode, now);
    return {
      ...user,
      languageCode,
      defaultOriginCode: originCode,
      onboardingCompleted: true,
      updatedAt: now
    };
  }

  public async updateProfile(
    telegramUserId: number,
    tripClass: TripClass,
    baggageRequired: boolean,
    defaultOriginCode: string,
    languageCode: 'ru' | 'uz'
  ): Promise<User> {
    const user = await this.requireUser(telegramUserId);
    const originCode = normalizeIataCode(defaultOriginCode);
    if (!isUzbekistanOrigin(originCode)) {
      throw new ValidationError('Город вылета должен находиться в Узбекистане');
    }
    await this.users.updateTicketPreferences(user.id, tripClass, baggageRequired, this.clock.now());
    await this.users.updateDefaultOrigin(user.id, originCode, this.clock.now());
    await this.users.updateLanguage(user.id, languageCode, this.clock.now());
    return {
      ...user,
      preferredTripClass: tripClass,
      baggageRequired,
      defaultOriginCode: originCode,
      languageCode
    };
  }

  private async ticketView(
    ticket: StoredTicket,
    userId: number,
    source: 'miniapp_deals' | 'miniapp_card',
    historyDays: number,
    language: 'ru' | 'uz'
  ): Promise<MiniAppTicketView> {
    const routeKey = createRouteKey(ticket.originCode, ticket.destinationCode, ticket.tripClass);
    const history = await this.routePrices.getDailySeries(routeKey, historyDays, this.clock.now());
    return {
      id: ticket.id,
      originCode: ticket.originCode,
      originName: getLocalizedLocationName(ticket.originCode, language) ?? ticket.originCode,
      destinationCode: ticket.destinationCode,
      destinationName: getLocalizedLocationName(ticket.destinationCode, language) ?? ticket.destinationCode,
      departureDate: ticket.departureDate,
      returnDate: ticket.returnDate,
      price: ticket.price,
      currencyCode: ticket.currencyCode,
      airlineName: ticket.airlineName,
      isDirect: ticket.isDirect,
      tripClass: ticket.tripClass,
      hasBaggage: ticket.hasBaggage,
      lastSeenAt: ticket.lastSeenAt.toISOString(),
      dealScore: calculateDealScore(ticket.price, history),
      openUrl: this.links.create({
        ticket,
        source,
        userId,
        subscriptionId: null
      })
    };
  }
}
