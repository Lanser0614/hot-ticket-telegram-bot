import type { Subscription } from '../domain/subscription.js';
import type { TicketEventType } from '../domain/ticket-events.js';
import type { Ticket } from '../domain/ticket.js';
import type { TripClass } from '../domain/travel-preferences.js';
import type { RouteDailyPoint, RoutePriceObservation } from '../domain/route-price.js';
import type { ClickSource, UserAgentKind } from '../domain/click-tracking.js';
import type {
  DestinationQuery,
  NotificationInput,
  NotificationQueueItem,
  StoredTicket,
  SyncResult,
  SyncSource,
  SyncSourceKey,
  TelegramCallbackAnswer,
  TelegramMessageInput,
  TelegramProfileInput,
  TicketQuery,
  User,
  UserSession
} from './models.js';

export interface UserRepository {
  upsertTelegramProfile(input: TelegramProfileInput, now: Date): Promise<User>;
  findById(userId: number): Promise<User | null>;
  findByTelegramUserId(telegramUserId: number): Promise<User | null>;
  updatePhone(userId: number, phoneNumber: string, now: Date): Promise<void>;
  completeOnboarding(
    userId: number,
    languageCode: string,
    defaultOriginCode: string,
    now: Date
  ): Promise<void>;
  updateDefaultOrigin(userId: number, defaultOriginCode: string, now: Date): Promise<void>;
  updateLanguage(userId: number, languageCode: string, now: Date): Promise<void>;
  updateTicketPreferences(
    userId: number,
    tripClass: TripClass,
    baggageRequired: boolean,
    now: Date
  ): Promise<void>;
  updateNotificationPreferences(
    userId: number,
    input: {
      instantNotificationsEnabled: boolean;
      morningDigestEnabled: boolean;
      quietHoursEnabled: boolean;
      quietStartMinute: number;
      quietEndMinute: number;
    },
    now: Date
  ): Promise<void>;
}

export interface TicketRepository {
  findTicketById(ticketId: number): Promise<StoredTicket | null>;
  findByExternalKey(externalKey: string): Promise<StoredTicket | null>;
  upsert(ticket: Ticket, observedAt: Date): Promise<{ stored: StoredTicket; previous: StoredTicket | null }>;
  deactivateUnseen(
    source: SyncSourceKey,
    seenExternalKeys: readonly string[],
    now: Date
  ): Promise<number>;
  listActive(query: TicketQuery): Promise<readonly StoredTicket[]>;
  listActiveDestinations(query: DestinationQuery): Promise<readonly string[]>;
  getCachedActiveDestinations(query: DestinationQuery): Promise<readonly string[] | null>;
  saveActiveDestinationsCache(
    query: DestinationQuery,
    destinations: readonly string[],
    updatedAt: Date
  ): Promise<void>;
  pruneActiveDestinationsCache(
    source: SyncSourceKey,
    departureDateFrom: string
  ): Promise<void>;
}

export interface TrackedLinkFactory {
  create(input: {
    ticket: StoredTicket;
    source: ClickSource;
    userId: number | null;
    subscriptionId: number | null;
  }): string;
}

export interface ClickRepository {
  hasRecentClick(
    userId: number,
    ticketId: number,
    since: Date,
    context?: { source: ClickSource; subscriptionId: number | null }
  ): Promise<boolean>;
  addClick(input: {
    ticket: StoredTicket;
    userId: number | null;
    source: ClickSource;
    subscriptionId: number | null;
    userAgentKind: UserAgentKind;
    benchmarkPrice?: number | null;
    estimatedSavings?: number | null;
    clickedAt: Date;
  }): Promise<number>;
  getTrackedSavings(userId: number, currencyCode: string, since: Date): Promise<number>;
}

export interface PriceHistoryRepository {
  addPrice(ticketId: number, price: number, observedAt: Date): Promise<void>;
}

export interface RoutePriceRepository {
  recordObservation(input: RoutePriceObservation): Promise<void>;
  rebuildDailyAggregate(routeKey: string, day: string, updatedAt: Date): Promise<void>;
  getDailySeries(routeKey: string, days: number, now: Date): Promise<readonly RouteDailyPoint[]>;
  pruneObservations(olderThan: Date): Promise<number>;
}

export interface SubscriptionRepository {
  findMatching(ticket: Ticket): Promise<readonly Subscription[]>;
  findSubscriptionById(subscriptionId: number): Promise<Subscription | null>;
  listByUser(userId: number): Promise<readonly Subscription[]>;
  countActiveByUser(userId: number): Promise<number>;
  create(input: Omit<Subscription, 'id' | 'isActive'>, now: Date): Promise<Subscription>;
  updateOwned(
    userId: number,
    subscriptionId: number,
    input: Omit<Subscription, 'id' | 'userId' | 'originCode' | 'currencyCode' | 'isActive'>,
    now: Date
  ): Promise<Subscription | null>;
  deactivateOwned(userId: number, subscriptionId: number, now: Date): Promise<boolean>;
}

export interface NotificationQueueRepository {
  enqueue(input: {
    userId: number;
    subscriptionId: number;
    ticketId: number;
    ticketPrice: number;
    notificationType: TicketEventType;
    queuedAt: Date;
  }): Promise<void>;
  listDue(now: Date, limit: number): Promise<readonly NotificationQueueItem[]>;
  discardPendingForSubscriptionExcept(
    userId: number,
    subscriptionId: number,
    keepQueueId: number
  ): Promise<void>;
  markSent(queueId: number, telegramMessageId: number, sentAt: Date): Promise<void>;
  markDiscarded(queueId: number, reason: string): Promise<void>;
  markDigestOnly(queueId: number): Promise<void>;
  markRetry(
    queueId: number,
    errorMessage: string,
    nextAttemptAt: Date,
    terminal: boolean
  ): Promise<void>;
  hasDigestDelivery(userId: number, localDay: string): Promise<boolean>;
  addDigestDelivery(
    userId: number,
    localDay: string,
    telegramMessageId: number,
    sentAt: Date
  ): Promise<void>;
}

export interface ReferralRepository {
  findCodeByUserId(userId: number): Promise<string | null>;
  findUserIdByCode(code: string): Promise<number | null>;
  createCode(userId: number, code: string, createdAt: Date): Promise<boolean>;
  attribute(input: {
    referredUserId: number;
    referrerUserId: number;
    referralCode: string;
    sharedTicketId: number | null;
    attributedAt: Date;
  }): Promise<boolean>;
  countReferrals(userId: number): Promise<number>;
  savePendingSharedTicket(userId: number, ticketId: number, createdAt: Date): Promise<void>;
  takePendingSharedTicket(userId: number): Promise<number | null>;
}

export interface SessionRepository {
  findByUserId(userId: number): Promise<UserSession | null>;
  save(session: UserSession): Promise<void>;
  deleteByUserId(userId: number): Promise<void>;
}

export interface NotificationHistoryRepository {
  exists(userId: number, subscriptionId: number, ticketId: number, price: number): Promise<boolean>;
  countSentSince(userId: number, since: Date): Promise<number>;
  addNotification(input: {
    userId: number;
    subscriptionId: number;
    ticketId: number;
    notifiedPrice: number;
    notificationType: TicketEventType;
    deliveryKind?: 'instant' | 'digest';
    telegramMessageId: number;
    sentAt: Date;
  }): Promise<void>;
}

export interface SyncSourceRepository {
  findEnabled(): Promise<readonly SyncSource[]>;
  ensureInitialSource(now: Date): Promise<void>;
}

export interface SyncRunRepository {
  start(source: SyncSourceKey, startedAt: Date): Promise<number>;
  complete(runId: number, result: SyncResult, finishedAt: Date): Promise<void>;
  fail(runId: number, errorMessage: string, finishedAt: Date): Promise<void>;
}

export interface LockRepository {
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface HotTicketsProvider {
  getHotTickets(input: { originCode: string; currencyCode: string }): Promise<Ticket[]>;
}

export interface TicketNotifier {
  send(input: NotificationInput): Promise<{ telegramMessageId: number }>;
}

export interface TelegramGateway {
  sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }>;
  answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(event: string, context?: Readonly<Record<string, unknown>>): void;
  warn(event: string, context?: Readonly<Record<string, unknown>>): void;
  error(event: string, context?: Readonly<Record<string, unknown>>): void;
}
