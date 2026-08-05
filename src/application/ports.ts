import type { Subscription } from '../domain/subscription.js';
import type { TicketEventType } from '../domain/ticket-events.js';
import type { Ticket } from '../domain/ticket.js';
import type { TripClass } from '../domain/travel-preferences.js';
import type {
  NotificationInput,
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
  updateTicketPreferences(
    userId: number,
    tripClass: TripClass,
    baggageRequired: boolean,
    now: Date
  ): Promise<void>;
}

export interface TicketRepository {
  findByExternalKey(externalKey: string): Promise<StoredTicket | null>;
  upsert(ticket: Ticket, observedAt: Date): Promise<{ stored: StoredTicket; previous: StoredTicket | null }>;
  deactivateUnseenBefore(source: SyncSourceKey, threshold: Date): Promise<number>;
  listActive(query: TicketQuery): Promise<readonly StoredTicket[]>;
}

export interface PriceHistoryRepository {
  addPrice(ticketId: number, price: number, observedAt: Date): Promise<void>;
}

export interface SubscriptionRepository {
  findMatching(ticket: Ticket): Promise<readonly Subscription[]>;
  listByUser(userId: number): Promise<readonly Subscription[]>;
  countActiveByUser(userId: number): Promise<number>;
  create(input: Omit<Subscription, 'id' | 'isActive'>, now: Date): Promise<Subscription>;
  deactivateOwned(userId: number, subscriptionId: number, now: Date): Promise<boolean>;
}

export interface SessionRepository {
  findByUserId(userId: number): Promise<UserSession | null>;
  save(session: UserSession): Promise<void>;
  deleteByUserId(userId: number): Promise<void>;
}

export interface NotificationHistoryRepository {
  exists(userId: number, subscriptionId: number, ticketId: number, price: number): Promise<boolean>;
  addNotification(input: {
    userId: number;
    subscriptionId: number;
    ticketId: number;
    notifiedPrice: number;
    notificationType: TicketEventType;
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
