import type { Subscription } from '../domain/subscription.js';
import type { TicketEventType } from '../domain/ticket-events.js';
import type { Ticket } from '../domain/ticket.js';

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

export interface SyncSource {
  id: number;
  originCode: string;
  currencyCode: string;
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
  sort: TicketSort;
  limit: number;
  offset: number;
}

export interface NotificationInput {
  user: User;
  subscription: Subscription;
  ticket: StoredTicket;
  type: TicketEventType;
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
