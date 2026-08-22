import type {
  Clock,
  LockRepository,
  NotificationHistoryRepository,
  PriceHistoryRepository,
  RoutePriceRepository,
  SessionRepository,
  SubscriptionRepository,
  SyncRunRepository,
  SyncSourceRepository,
  TicketRepository,
  UserRepository
} from '../../application/ports.js';
import type {
  DestinationQuery,
  StoredTicket,
  SyncResult,
  SyncRunStatus,
  SyncSource,
  SyncSourceKey,
  TelegramProfileInput,
  TicketQuery,
  User,
  UserSession
} from '../../application/models.js';
import type { Subscription } from '../../domain/subscription.js';
import { matchesSubscription } from '../../domain/subscription.js';
import type { TicketEventType } from '../../domain/ticket-events.js';
import type { Ticket } from '../../domain/ticket.js';
import type { TripClass } from '../../domain/travel-preferences.js';
import type { RouteDailyPoint, RoutePriceObservation } from '../../domain/route-price.js';
import { dateInTimeZone } from '../../domain/dates.js';
import { UZBEKISTAN_ORIGIN_CODES } from '../../domain/locations.js';

interface PriceHistoryRecord {
  ticketId: number;
  price: number;
  observedAt: Date;
}

interface NotificationRecord {
  userId: number;
  subscriptionId: number;
  ticketId: number;
  notifiedPrice: number;
  notificationType: TicketEventType;
  telegramMessageId: number;
  sentAt: Date;
}

interface SyncRunRecord {
  id: number;
  originCode: string;
  currencyCode: string;
  status: SyncRunStatus;
  fetched: number;
  inserted: number;
  updated: number;
  notificationsSent: number;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

interface SeedUserInput {
  telegramUserId: number;
  telegramChatId: number;
}

interface DestinationCacheRecord {
  destinations: readonly string[];
  updatedAt: Date;
}

interface RouteObservationRecord extends RoutePriceObservation {
  readonly observedHour: number;
}

function destinationCacheKey(query: DestinationQuery): string {
  return [
    query.originCode,
    query.currencyCode,
    query.departureDateFrom,
    query.tripClass,
    query.baggageRequired ? '1' : '0'
  ].join('|');
}

export class MemoryStore implements
  UserRepository,
  TicketRepository,
  PriceHistoryRepository,
  RoutePriceRepository,
  SubscriptionRepository,
  SessionRepository,
  NotificationHistoryRepository,
  SyncSourceRepository,
  SyncRunRepository,
  LockRepository {
  private readonly users: User[] = [];
  private readonly tickets: StoredTicket[] = [];
  private readonly subscriptions: Subscription[] = [];
  private readonly sessions = new Map<number, UserSession>();
  private readonly destinationCache = new Map<string, DestinationCacheRecord>();
  private syncSources: SyncSource[] = [];
  private readonly locks = new Map<string, Date>();
  private readonly referralCodes = new Map<number, string>();
  private readonly referrals = new Map<number, { referrerUserId: number; code: string }>();
  private readonly pendingSharedTickets = new Map<number, number>();
  private nextUserId = 1;
  private nextTicketId = 1;
  private nextSubscriptionId = 1;
  private nextSyncSourceId = 1;
  private nextSyncRunId = 1;

  public readonly priceHistoryRecords: PriceHistoryRecord[] = [];
  public readonly routePriceObservations: RouteObservationRecord[] = [];
  private readonly routePriceDaily = new Map<string, RouteDailyPoint>();
  public readonly notificationRecords: NotificationRecord[] = [];
  public readonly syncRunRecords: SyncRunRecord[] = [];
  public activeDestinationQueryCount = 0;

  public constructor(private readonly clock: Clock) {}

  public seedUser(input: SeedUserInput): User {
    const now = this.clock.now();
    const user: User = {
      id: this.nextUserId++,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      username: null,
      firstName: null,
      lastName: null,
      phoneNumber: null,
      languageCode: null,
      defaultOriginCode: 'TAS',
      preferredCurrencyCode: 'UZS',
      preferredTripClass: 'economy',
      baggageRequired: false,
      instantNotificationsEnabled: true,
      morningDigestEnabled: false,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480,
      onboardingCompleted: true,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    this.users.push(user);
    return { ...user };
  }

  public seedSubscription(input: Omit<Subscription, 'id'>): Subscription {
    const subscription = { ...input, id: this.nextSubscriptionId++ };
    this.subscriptions.push(subscription);
    return { ...subscription };
  }

  public setSubscriptionsActive(isActive: boolean): void {
    for (const subscription of this.subscriptions) subscription.isActive = isActive;
  }

  public setSyncSources(sources: readonly SyncSource[]): void {
    this.syncSources = sources.map((item) => ({ ...item }));
    const maxId = Math.max(0, ...sources.map((item) => item.id));
    this.nextSyncSourceId = maxId + 1;
  }

  public getTickets(): readonly StoredTicket[] {
    return this.tickets.map((ticket) => ({ ...ticket }));
  }

  public upsertTelegramProfile(input: TelegramProfileInput, now: Date): Promise<User> {
    const existing = this.users.find((item) => item.telegramUserId === input.telegramUserId);
    if (existing !== undefined) {
      Object.assign(existing, input, {
        languageCode: existing.onboardingCompleted ? existing.languageCode : input.languageCode,
        updatedAt: now
      });
      return Promise.resolve({ ...existing });
    }
    const user: User = {
      id: this.nextUserId++,
      ...input,
      phoneNumber: null,
      defaultOriginCode: 'TAS',
      preferredCurrencyCode: 'UZS',
      preferredTripClass: 'economy',
      baggageRequired: false,
      instantNotificationsEnabled: true,
      morningDigestEnabled: false,
      quietHoursEnabled: false,
      quietStartMinute: 1380,
      quietEndMinute: 480,
      onboardingCompleted: false,
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    this.users.push(user);
    return Promise.resolve({ ...user });
  }

  public findById(userId: number): Promise<User | null> {
    const user = this.users.find((item) => item.id === userId);
    return Promise.resolve(user === undefined ? null : { ...user });
  }

  public findByTelegramUserId(telegramUserId: number): Promise<User | null> {
    const user = this.users.find((item) => item.telegramUserId === telegramUserId);
    return Promise.resolve(user === undefined ? null : { ...user });
  }

  public updatePhone(userId: number, phoneNumber: string, now: Date): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, { phoneNumber, updatedAt: now });
    return Promise.resolve();
  }

  public completeOnboarding(
    userId: number,
    languageCode: string,
    defaultOriginCode: string,
    now: Date
  ): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, {
      languageCode,
      defaultOriginCode,
      onboardingCompleted: true,
      updatedAt: now
    });
    return Promise.resolve();
  }

  public updateDefaultOrigin(
    userId: number,
    defaultOriginCode: string,
    now: Date
  ): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, { defaultOriginCode, updatedAt: now });
    return Promise.resolve();
  }

  public updateLanguage(userId: number, languageCode: string, now: Date): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, { languageCode, updatedAt: now });
    return Promise.resolve();
  }

  public updateTicketPreferences(
    userId: number,
    preferredTripClass: TripClass,
    baggageRequired: boolean,
    now: Date
  ): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, {
      preferredTripClass,
      baggageRequired,
      updatedAt: now
    });
    return Promise.resolve();
  }

  public updateNotificationPreferences(
    userId: number,
    input: {
      instantNotificationsEnabled: boolean;
      morningDigestEnabled: boolean;
      quietHoursEnabled: boolean;
      quietStartMinute: number;
      quietEndMinute: number;
    },
    now: Date
  ): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user !== undefined) Object.assign(user, input, { updatedAt: now });
    return Promise.resolve();
  }

  public findByExternalKey(externalKey: string): Promise<StoredTicket | null> {
    const ticket = this.tickets.find((item) => item.externalKey === externalKey);
    return Promise.resolve(ticket === undefined ? null : { ...ticket });
  }

  public findTicketById(ticketId: number): Promise<StoredTicket | null> {
    const ticket = this.tickets.find((item) => item.id === ticketId);
    return Promise.resolve(ticket === undefined ? null : { ...ticket });
  }

  public upsert(
    ticket: Ticket,
    observedAt: Date
  ): Promise<{ stored: StoredTicket; previous: StoredTicket | null }> {
    const existing = this.tickets.find((item) => item.externalKey === ticket.externalKey);
    if (existing !== undefined) {
      const previous = { ...existing };
      Object.assign(existing, ticket, {
        lastSeenAt: observedAt,
        isActive: true,
        updatedAt: observedAt
      });
      return Promise.resolve({ stored: { ...existing }, previous });
    }

    const stored: StoredTicket = {
      ...ticket,
      id: this.nextTicketId++,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      isActive: true,
      createdAt: observedAt,
      updatedAt: observedAt
    };
    this.tickets.push(stored);
    return Promise.resolve({ stored: { ...stored }, previous: null });
  }

  public deactivateUnseen(
    source: SyncSourceKey,
    seenExternalKeys: readonly string[],
    now: Date
  ): Promise<number> {
    const seen = new Set(seenExternalKeys);
    let changed = 0;
    for (const ticket of this.tickets) {
      if (
        ticket.isActive
        && ticket.originCode === source.originCode
        && ticket.currencyCode === source.currencyCode
        && !seen.has(ticket.externalKey)
      ) {
        ticket.isActive = false;
        ticket.updatedAt = now;
        changed += 1;
      }
    }
    return Promise.resolve(changed);
  }

  public listActive(query: TicketQuery): Promise<readonly StoredTicket[]> {
    const items = this.tickets.filter((ticket) => (
      ticket.isActive
      && ticket.originCode === query.originCode
      && ticket.currencyCode === query.currencyCode
      && ticket.departureDate >= query.departureDateFrom
      && (query.departureDateTo === null || ticket.departureDate <= query.departureDateTo)
      && (query.destinationCode === null || ticket.destinationCode === query.destinationCode)
      && (query.maxPrice === null || ticket.price <= query.maxPrice)
      && (!query.directOnly || ticket.isDirect)
      && ticket.tripClass === query.tripClass
      && (!query.baggageRequired || ticket.hasBaggage)
    ));
    items.sort((left, right) => {
      if (query.sort === 'departure_date_asc') {
        return left.departureDate.localeCompare(right.departureDate)
          || left.price - right.price
          || left.id - right.id;
      }
      if (query.sort === 'recently_added') {
        return right.firstSeenAt.getTime() - left.firstSeenAt.getTime()
          || left.id - right.id;
      }
      return left.price - right.price
        || left.departureDate.localeCompare(right.departureDate)
        || left.id - right.id;
    });
    return Promise.resolve(items.slice(query.offset, query.offset + query.limit).map((item) => ({ ...item })));
  }

  public listActiveDestinations(query: DestinationQuery): Promise<readonly string[]> {
    this.activeDestinationQueryCount += 1;
    const codes = new Set<string>();
    for (const ticket of this.tickets) {
      if (
        ticket.isActive
        && ticket.originCode === query.originCode
        && ticket.currencyCode === query.currencyCode
        && ticket.departureDate >= query.departureDateFrom
        && ticket.tripClass === query.tripClass
        && (!query.baggageRequired || ticket.hasBaggage)
      ) codes.add(ticket.destinationCode);
    }
    return Promise.resolve([...codes].sort());
  }

  public getCachedActiveDestinations(
    query: DestinationQuery
  ): Promise<readonly string[] | null> {
    const record = this.destinationCache.get(destinationCacheKey(query));
    return Promise.resolve(record === undefined ? null : [...record.destinations]);
  }

  public saveActiveDestinationsCache(
    query: DestinationQuery,
    destinations: readonly string[],
    updatedAt: Date
  ): Promise<void> {
    this.destinationCache.set(destinationCacheKey(query), {
      destinations: [...destinations],
      updatedAt: new Date(updatedAt)
    });
    return Promise.resolve();
  }

  public pruneActiveDestinationsCache(
    source: SyncSourceKey,
    departureDateFrom: string
  ): Promise<void> {
    const prefix = `${source.originCode}|${source.currencyCode}|`;
    for (const key of this.destinationCache.keys()) {
      if (key.startsWith(prefix) && !key.startsWith(`${prefix}${departureDateFrom}|`)) {
        this.destinationCache.delete(key);
      }
    }
    return Promise.resolve();
  }

  public addPrice(ticketId: number, price: number, observedAt: Date): Promise<void> {
    this.priceHistoryRecords.push({ ticketId, price, observedAt });
    return Promise.resolve();
  }

  public recordObservation(input: RoutePriceObservation): Promise<void> {
    const observedHour = Math.floor(input.observedAt.getTime() / 3_600_000);
    const existingIndex = this.routePriceObservations.findIndex((item) => (
      item.routeKey === input.routeKey
      && item.departureDate === input.departureDate
      && item.isDirect === input.isDirect
      && item.hasBaggage === input.hasBaggage
      && item.observedHour === observedHour
    ));
    const observation = { ...input, observedAt: new Date(input.observedAt), observedHour };
    if (existingIndex === -1) {
      this.routePriceObservations.push(observation);
      return Promise.resolve();
    }
    const existing = this.routePriceObservations[existingIndex];
    if (existing !== undefined) {
      this.routePriceObservations[existingIndex] = {
        ...observation,
        price: Math.min(existing.price, observation.price),
        observedAt: existing.observedAt > observation.observedAt
          ? new Date(existing.observedAt)
          : new Date(observation.observedAt)
      };
    }
    return Promise.resolve();
  }

  public rebuildDailyAggregate(routeKey: string, day: string, updatedAt: Date): Promise<void> {
    void updatedAt;
    const prices = this.routePriceObservations
      .filter((item) => (
        item.routeKey === routeKey
        && dateInTimeZone(item.observedAt, 'Asia/Tashkent') === day
      ))
      .map((item) => item.price)
      .sort((left, right) => left - right);
    if (prices.length === 0) return Promise.resolve();
    const middle = Math.floor(prices.length / 2);
    const right = prices[middle] ?? 0;
    const medianPrice = prices.length % 2 === 1
      ? right
      : Math.round(((prices[middle - 1] ?? right) + right) / 2);
    this.routePriceDaily.set(`${routeKey}|${day}`, {
      day,
      minPrice: prices[0] ?? 0,
      averagePrice: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
      medianPrice,
      maxPrice: prices.at(-1) ?? 0,
      sampleCount: prices.length
    });
    return Promise.resolve();
  }

  public getDailySeries(routeKey: string, days: number, now: Date): Promise<readonly RouteDailyPoint[]> {
    const from = new Date(now.getTime() - Math.max(0, days - 1) * 86_400_000);
    const fromDay = dateInTimeZone(from, 'Asia/Tashkent');
    return Promise.resolve([...this.routePriceDaily.entries()]
      .filter(([key, point]) => key.startsWith(`${routeKey}|`) && point.day >= fromDay)
      .map(([, point]) => ({ ...point }))
      .sort((left, right) => left.day.localeCompare(right.day)));
  }

  public pruneObservations(olderThan: Date): Promise<number> {
    let deleted = 0;
    for (let index = this.routePriceObservations.length - 1; index >= 0; index -= 1) {
      const observation = this.routePriceObservations[index];
      if (observation !== undefined && observation.observedAt < olderThan) {
        this.routePriceObservations.splice(index, 1);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  public findMatching(ticket: Ticket): Promise<readonly Subscription[]> {
    return Promise.resolve(this.subscriptions
      .filter((subscription) => matchesSubscription(ticket, subscription))
      .map((subscription) => ({ ...subscription })));
  }

  public findSubscriptionById(subscriptionId: number): Promise<Subscription | null> {
    const subscription = this.subscriptions.find((item) => item.id === subscriptionId);
    return Promise.resolve(subscription === undefined ? null : { ...subscription });
  }

  public listByUser(userId: number): Promise<readonly Subscription[]> {
    return Promise.resolve(this.subscriptions
      .filter((item) => item.userId === userId)
      .map((item) => ({ ...item })));
  }

  public countActiveByUser(userId: number): Promise<number> {
    return Promise.resolve(this.subscriptions.filter((item) => item.userId === userId && item.isActive).length);
  }

  public create(
    input: Omit<Subscription, 'id' | 'isActive'>,
    now: Date
  ): Promise<Subscription> {
    void now;
    return Promise.resolve(this.seedSubscription({ ...input, isActive: true }));
  }

  public deactivateOwned(userId: number, subscriptionId: number, now: Date): Promise<boolean> {
    void now;
    const subscription = this.subscriptions.find((item) => (
      item.id === subscriptionId && item.userId === userId && item.isActive
    ));
    if (subscription === undefined) return Promise.resolve(false);
    subscription.isActive = false;
    return Promise.resolve(true);
  }

  public updateOwned(
    userId: number,
    subscriptionId: number,
    input: Omit<Subscription, 'id' | 'userId' | 'originCode' | 'currencyCode' | 'isActive'>,
    now: Date
  ): Promise<Subscription | null> {
    const subscription = this.subscriptions.find((item) => (
      item.id === subscriptionId && item.userId === userId && item.isActive
    ));
    if (subscription === undefined) return Promise.resolve(null);
    Object.assign(subscription, input);
    void now;
    return Promise.resolve({ ...subscription });
  }

  public findByUserId(userId: number): Promise<UserSession | null> {
    const session = this.sessions.get(userId);
    return Promise.resolve(session === undefined ? null : { ...session });
  }

  public save(session: UserSession): Promise<void> {
    this.sessions.set(session.userId, { ...session });
    return Promise.resolve();
  }

  public deleteByUserId(userId: number): Promise<void> {
    this.sessions.delete(userId);
    return Promise.resolve();
  }

  public exists(userId: number, subscriptionId: number, ticketId: number, price: number): Promise<boolean> {
    return Promise.resolve(this.notificationRecords.some((item) => (
      item.userId === userId
      && item.subscriptionId === subscriptionId
      && item.ticketId === ticketId
      && item.notifiedPrice === price
    )));
  }

  public countSentSince(userId: number, since: Date): Promise<number> {
    return Promise.resolve(this.notificationRecords.filter((item) => (
      item.userId === userId && item.sentAt >= since
    )).length);
  }

  public addNotification(input: NotificationRecord): Promise<void> {
    if (!this.notificationRecords.some((item) => (
      item.userId === input.userId
      && item.subscriptionId === input.subscriptionId
      && item.ticketId === input.ticketId
      && item.notifiedPrice === input.notifiedPrice
    ))) {
      this.notificationRecords.push({ ...input });
    }
    return Promise.resolve();
  }

  public findEnabled(): Promise<readonly SyncSource[]> {
    return Promise.resolve(this.syncSources.filter((item) => item.isEnabled).map((item) => ({ ...item })));
  }

  public ensureInitialSource(now: Date): Promise<void> {
    for (const source of this.syncSources) {
      source.isEnabled = false;
    }
    for (const originCode of UZBEKISTAN_ORIGIN_CODES) {
      const existing = this.syncSources.find((item) => (
        item.originCode === originCode && item.currencyCode === 'UZS'
      ));
      if (existing !== undefined) {
        existing.isEnabled = true;
      } else {
        this.syncSources.push({
          id: this.nextSyncSourceId++,
          originCode,
          currencyCode: 'UZS',
          isEnabled: true
        });
      }
    }
    void now;
    return Promise.resolve();
  }

  public start(source: SyncSourceKey, startedAt: Date): Promise<number> {
    const id = this.nextSyncRunId++;
    this.syncRunRecords.push({
      id,
      originCode: source.originCode,
      currencyCode: source.currencyCode,
      status: 'running',
      fetched: 0,
      inserted: 0,
      updated: 0,
      notificationsSent: 0,
      errorMessage: null,
      startedAt,
      finishedAt: null
    });
    return Promise.resolve(id);
  }

  public complete(runId: number, result: SyncResult, finishedAt: Date): Promise<void> {
    const run = this.syncRunRecords.find((item) => item.id === runId);
    if (run !== undefined) Object.assign(run, {
      status: result.status,
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      notificationsSent: result.notificationsSent,
      finishedAt
    });
    return Promise.resolve();
  }

  public fail(runId: number, errorMessage: string, finishedAt: Date): Promise<void> {
    const run = this.syncRunRecords.find((item) => item.id === runId);
    if (run !== undefined) Object.assign(run, { status: 'failed', errorMessage, finishedAt });
    return Promise.resolve();
  }

  public acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const now = this.clock.now();
    const existing = this.locks.get(key);
    if (existing !== undefined && existing > now) return Promise.resolve(false);
    this.locks.set(key, new Date(now.getTime() + ttlSeconds * 1_000));
    return Promise.resolve(true);
  }

  public release(key: string): Promise<void> {
    this.locks.delete(key);
    return Promise.resolve();
  }

  public findCodeByUserId(userId: number): Promise<string | null> {
    return Promise.resolve(this.referralCodes.get(userId) ?? null);
  }

  public findUserIdByCode(code: string): Promise<number | null> {
    for (const [userId, value] of this.referralCodes) {
      if (value === code) return Promise.resolve(userId);
    }
    return Promise.resolve(null);
  }

  public createCode(userId: number, code: string, createdAt: Date): Promise<boolean> {
    void createdAt;
    if (this.referralCodes.has(userId) || [...this.referralCodes.values()].includes(code)) {
      return Promise.resolve(false);
    }
    this.referralCodes.set(userId, code);
    return Promise.resolve(true);
  }

  public attribute(input: {
    referredUserId: number;
    referrerUserId: number;
    referralCode: string;
    sharedTicketId: number | null;
    attributedAt: Date;
  }): Promise<boolean> {
    void input.sharedTicketId;
    void input.attributedAt;
    if (input.referredUserId === input.referrerUserId || this.referrals.has(input.referredUserId)) {
      return Promise.resolve(false);
    }
    this.referrals.set(input.referredUserId, {
      referrerUserId: input.referrerUserId,
      code: input.referralCode
    });
    return Promise.resolve(true);
  }

  public countReferrals(userId: number): Promise<number> {
    return Promise.resolve([...this.referrals.values()]
      .filter((item) => item.referrerUserId === userId).length);
  }

  public savePendingSharedTicket(userId: number, ticketId: number, createdAt: Date): Promise<void> {
    void createdAt;
    this.pendingSharedTickets.set(userId, ticketId);
    return Promise.resolve();
  }

  public takePendingSharedTicket(userId: number): Promise<number | null> {
    const ticketId = this.pendingSharedTickets.get(userId) ?? null;
    this.pendingSharedTickets.delete(userId);
    return Promise.resolve(ticketId);
  }
}
