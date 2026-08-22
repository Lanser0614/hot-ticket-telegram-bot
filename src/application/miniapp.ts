import type { StoredTicket, TicketSort, TrackedSavings, User } from './models.js';
import type {
  Clock,
  ClickRepository,
  RoutePriceRepository,
  TicketRepository,
  TrackedLinkFactory,
  UserRepository
} from './ports.js';
import type {
  SubscriptionService,
  CreateSubscriptionInput,
  UpdateSubscriptionInput
} from './subscriptions.js';
import { calculateDealScore, type DealScore } from '../domain/deal-score.js';
import { normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate, dateInTimeZone } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { getLocalizedLocationName, isUzbekistanOrigin } from '../domain/locations.js';
import { assertMoney } from '../domain/money.js';
import { createRouteKey, type RouteDailyPoint } from '../domain/route-price.js';
import type { Subscription } from '../domain/subscription.js';
import type { TripClass } from '../domain/travel-preferences.js';
import type { ReferralService } from './referrals.js';

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
  readonly shareUrl: string | null;
}

export interface MiniAppSubscriptionView extends Subscription {
  readonly currentTicket: MiniAppTicketView | null;
}

export interface MiniAppProfileView extends User {
  readonly trackedSavings: TrackedSavings;
  readonly referralCount: number;
  readonly referralShareUrl: string | null;
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
    private readonly clock: Clock,
    private readonly clicks?: ClickRepository,
    private readonly referrals?: ReferralService
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

  public async getTicket(
    telegramUserId: number,
    ticketId: number,
    subscriptionId: number | null = null
  ): Promise<MiniAppTicketView> {
    const user = await this.requireUser(telegramUserId);
    const ticket = await this.tickets.findTicketById(ticketId);
    if (ticket === null || !ticket.isActive) throw new ValidationError('Билет не найден');
    if (subscriptionId !== null) {
      const subscription = (await this.subscriptions.listForUser(user.id))
        .find((item) => item.id === subscriptionId) ?? null;
      if (subscription === null || !this.matchesWatchlistContext(ticket, subscription)) {
        throw new ValidationError('Билет не соответствует отслеживанию');
      }
    }
    return this.ticketView(
      ticket,
      user.id,
      subscriptionId === null ? 'miniapp_card' : 'miniapp_watchlist',
      30,
      userLanguage(user.languageCode),
      subscriptionId
    );
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

  public async listSubscriptions(telegramUserId: number): Promise<readonly MiniAppSubscriptionView[]> {
    const user = await this.requireUser(telegramUserId);
    const subscriptions = await this.subscriptions.listForUser(user.id);
    return Promise.all(subscriptions.map(async (subscription) => {
      if (!subscription.isActive) return { ...subscription, currentTicket: null };
      const candidates = await this.tickets.listActive({
        originCode: subscription.originCode,
        currencyCode: subscription.currencyCode,
        departureDateFrom: subscription.departureDateFrom,
        departureDateTo: subscription.departureDateTo,
        destinationCode: subscription.destinationCode,
        maxPrice: null,
        directOnly: subscription.directOnly,
        tripClass: subscription.tripClass,
        baggageRequired: subscription.baggageRequired,
        sort: 'price_asc',
        limit: 100,
        offset: 0
      });
      const current = candidates.find((ticket) => this.matchesWatchlistContext(ticket, subscription)) ?? null;
      return {
        ...subscription,
        currentTicket: current === null ? null : await this.ticketView(
          current,
          user.id,
          'miniapp_watchlist',
          30,
          userLanguage(user.languageCode),
          subscription.id
        )
      };
    }));
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

  public async updateSubscription(
    telegramUserId: number,
    subscriptionId: number,
    input: UpdateSubscriptionInput
  ): Promise<Subscription | null> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.updateForUser(user.id, subscriptionId, input);
  }

  public async getProfile(telegramUserId: number): Promise<MiniAppProfileView> {
    const user = await this.requireUser(telegramUserId);
    const since = new Date(this.clock.now().getTime() - 90 * 86_400_000);
    const [amount, referralCount, referralShareUrl] = await Promise.all([
      this.clicks?.getTrackedSavings(user.id, 'UZS', since) ?? Promise.resolve(0),
      this.referrals?.countForUser(user.id) ?? Promise.resolve(0),
      this.referrals?.createShareUrl(user.id, null) ?? Promise.resolve(null)
    ]);
    return {
      ...user,
      trackedSavings: { amount, currency: 'UZS', periodDays: 90 },
      referralCount,
      referralShareUrl
    };
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

  public async updateProfile(telegramUserId: number, input: {
    readonly preferredTripClass?: TripClass | undefined;
    readonly baggageRequired?: boolean | undefined;
    readonly defaultOriginCode?: string | undefined;
    readonly languageCode?: 'ru' | 'uz' | undefined;
    readonly instantNotificationsEnabled?: boolean | undefined;
    readonly morningDigestEnabled?: boolean | undefined;
    readonly quietHoursEnabled?: boolean | undefined;
    readonly quietStartMinute?: number | undefined;
    readonly quietEndMinute?: number | undefined;
  }): Promise<User> {
    const user = await this.requireUser(telegramUserId);
    const originCode = input.defaultOriginCode === undefined
      ? user.defaultOriginCode
      : normalizeIataCode(input.defaultOriginCode);
    if (!isUzbekistanOrigin(originCode)) {
      throw new ValidationError('Город вылета должен находиться в Узбекистане');
    }
    const tripClass = input.preferredTripClass ?? user.preferredTripClass;
    const baggageRequired = input.baggageRequired ?? user.baggageRequired;
    const languageCode = input.languageCode ?? user.languageCode;
    if (languageCode !== 'ru' && languageCode !== 'uz') {
      throw new ValidationError('Поддерживаются только русский и узбекский языки');
    }
    const minute = (value: number | undefined, fallback: number): number => {
      const result = value ?? fallback;
      if (!Number.isSafeInteger(result) || result < 0 || result > 1439) {
        throw new ValidationError('Некорректное время тишины');
      }
      return result;
    };
    const now = this.clock.now();
    if (tripClass !== user.preferredTripClass || baggageRequired !== user.baggageRequired) {
      await this.users.updateTicketPreferences(user.id, tripClass, baggageRequired, now);
    }
    if (originCode !== user.defaultOriginCode) {
      await this.users.updateDefaultOrigin(user.id, originCode, now);
    }
    if (languageCode !== user.languageCode) {
      await this.users.updateLanguage(user.id, languageCode, now);
    }
    const notificationPreferences = {
      instantNotificationsEnabled: input.instantNotificationsEnabled ?? user.instantNotificationsEnabled,
      morningDigestEnabled: input.morningDigestEnabled ?? user.morningDigestEnabled,
      quietHoursEnabled: input.quietHoursEnabled ?? user.quietHoursEnabled,
      quietStartMinute: minute(input.quietStartMinute, user.quietStartMinute),
      quietEndMinute: minute(input.quietEndMinute, user.quietEndMinute)
    };
    await this.users.updateNotificationPreferences(user.id, notificationPreferences, now);
    return {
      ...user,
      preferredTripClass: tripClass,
      baggageRequired,
      defaultOriginCode: originCode,
      languageCode,
      ...notificationPreferences,
      updatedAt: now
    };
  }

  private async ticketView(
    ticket: StoredTicket,
    userId: number,
    source: 'miniapp_deals' | 'miniapp_card' | 'miniapp_watchlist',
    historyDays: number,
    language: 'ru' | 'uz',
    subscriptionId: number | null = null
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
        subscriptionId
      }),
      shareUrl: await this.referrals?.createShareUrl(userId, ticket.id) ?? null
    };
  }

  private matchesWatchlistContext(ticket: StoredTicket, subscription: Subscription): boolean {
    return subscription.isActive
      && ticket.originCode === subscription.originCode
      && ticket.currencyCode === subscription.currencyCode
      && (subscription.destinationCode === null || ticket.destinationCode === subscription.destinationCode)
      && ticket.departureDate >= subscription.departureDateFrom
      && ticket.departureDate <= subscription.departureDateTo
      && (!subscription.directOnly || ticket.isDirect)
      && (!subscription.roundTripOnly || ticket.returnDate !== null)
      && (!subscription.baggageRequired || ticket.hasBaggage)
      && ticket.tripClass === subscription.tripClass;
  }
}
