import type { Subscription } from '../domain/subscription.js';
import type { TicketEventType } from '../domain/ticket-events.js';
import type { Ticket } from '../domain/ticket.js';
import type { TripClass } from '../domain/travel-preferences.js';

export interface User {
  id: number;
  telegramUserId: number;
  telegramChatId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  languageCode: string | null;
  defaultOriginCode: string;
  preferredCurrencyCode: string;
  preferredTripClass: TripClass;
  baggageRequired: boolean;
  instantNotificationsEnabled: boolean;
  morningDigestEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  onboardingCompleted: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramProfileInput {
  telegramUserId: number;
  telegramChatId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

export interface StoredTicket extends Ticket {
  id: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncSourceKey {
  originCode: string;
  currencyCode: string;
}

export interface SyncSource extends SyncSourceKey {
  id: number;
  isEnabled: boolean;
}

export type TicketSort = 'price_asc' | 'departure_date_asc' | 'recently_added';

export interface TicketQuery {
  originCode: string;
  currencyCode: string;
  departureDateFrom: string;
  departureDateTo: string | null;
  destinationCode: string | null;
  maxPrice: number | null;
  directOnly: boolean;
  tripClass: TripClass;
  baggageRequired: boolean;
  sort: TicketSort;
  limit: number;
  offset: number;
}

export interface DestinationQuery {
  originCode: string;
  currencyCode: string;
  departureDateFrom: string;
  tripClass: TripClass;
  baggageRequired: boolean;
}

export interface NotificationInput {
  user: User;
  subscription: Subscription;
  ticket: StoredTicket;
  type: TicketEventType;
}

export type NotificationQueueStatus = 'pending' | 'sent' | 'discarded' | 'failed';

export interface NotificationQueueItem {
  readonly id: number;
  readonly userId: number;
  readonly subscriptionId: number;
  readonly ticketId: number;
  readonly ticketPrice: number;
  readonly notificationType: TicketEventType;
  readonly deliveryMode: 'instant_or_digest' | 'digest_only';
  readonly status: NotificationQueueStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date;
  readonly queuedAt: Date;
}

export interface TrackedSavings {
  readonly amount: number;
  readonly currency: 'UZS';
  readonly periodDays: 90;
}

export interface TelegramMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: unknown;
  parseMode?: 'HTML';
}

export interface TelegramCallbackAnswer {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}

export interface UserSession {
  userId: number;
  flow: string;
  step: string;
  payload: Readonly<Record<string, unknown>>;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SyncRunStatus = 'running' | 'success' | 'failed' | 'skipped';

export interface SyncResult {
  status: Exclude<SyncRunStatus, 'running'>;
  origin: string;
  currency: string;
  fetched: number;
  inserted: number;
  updated: number;
  notificationsSent: number;
}
