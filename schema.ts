import { boolean, index, integer, json, table, text, unique } from 'sdk/db';

export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramUserId: integer('telegram_user_id').notNull().unique(),
  telegramChatId: integer('telegram_chat_id').notNull(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phoneNumber: text('phone_number'),
  languageCode: text('language_code'),
  defaultOriginCode: text('default_origin_code').notNull().default('TAS'),
  preferredCurrencyCode: text('preferred_currency_code').notNull().default('UZS'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const tickets = table('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalKey: text('external_key').notNull().unique(),
  originCode: text('origin_code').notNull(),
  destinationCode: text('destination_code').notNull(),
  departureDate: text('departure_date').notNull(),
  departureAt: text('departure_at'),
  price: integer('price').notNull(),
  currencyCode: text('currency_code').notNull(),
  airlineCode: text('airline_code'),
  airlineName: text('airline_name'),
  isDirect: boolean('is_direct').notNull().default(false),
  hasBaggage: boolean('has_baggage').notNull().default(false),
  ticketLink: text('ticket_link').notNull(),
  rawTicketLink: text('raw_ticket_link'),
  rawPayload: json('raw_payload').notNull(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  originIndex: index('idx_tickets_origin').on(columns.originCode),
  destinationIndex: index('idx_tickets_destination').on(columns.destinationCode),
  departureDateIndex: index('idx_tickets_departure_date').on(columns.departureDate),
  priceIndex: index('idx_tickets_price').on(columns.price),
  originCurrencyIndex: index('idx_tickets_origin_currency').on(
    columns.originCode,
    columns.currencyCode
  ),
  activeIndex: index('idx_tickets_active').on(columns.isActive, columns.departureDate)
}));

export const ticketPriceHistory = table('ticket_price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull(),
  price: integer('price').notNull(),
  observedAt: integer('observed_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  ticketIndex: index('idx_ticket_price_history_ticket').on(columns.ticketId, columns.observedAt)
}));

export const subscriptions = table('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  originCode: text('origin_code').notNull(),
  destinationCode: text('destination_code'),
  currencyCode: text('currency_code').notNull(),
  departureDateFrom: text('departure_date_from').notNull(),
  departureDateTo: text('departure_date_to').notNull(),
  maxPrice: integer('max_price'),
  directOnly: boolean('direct_only').notNull().default(false),
  baggageRequired: boolean('baggage_required').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  userActiveIndex: index('idx_subscriptions_user_active').on(columns.userId, columns.isActive),
  matchingIndex: index('idx_subscriptions_matching').on(
    columns.originCode,
    columns.currencyCode,
    columns.isActive
  )
}));

export const notificationHistory = table('notification_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  subscriptionId: integer('subscription_id').notNull(),
  ticketId: integer('ticket_id').notNull(),
  notifiedPrice: integer('notified_price').notNull(),
  notificationType: text('notification_type').notNull(),
  telegramMessageId: integer('telegram_message_id'),
  sentAt: integer('sent_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  notificationUnique: unique('uq_notification_history_delivery').on(
    columns.userId,
    columns.subscriptionId,
    columns.ticketId,
    columns.notifiedPrice
  )
}));

export const userSessions = table('user_sessions', {
  userId: integer('user_id').primaryKey(),
  flow: text('flow').notNull(),
  step: text('step').notNull(),
  payload: json('payload').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  expiresIndex: index('idx_user_sessions_expires').on(columns.expiresAt)
}));

export const syncSources = table('sync_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  originCode: text('origin_code').notNull(),
  currencyCode: text('currency_code').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (columns) => ({
  sourceUnique: unique('uq_sync_sources_origin_currency').on(
    columns.originCode,
    columns.currencyCode
  )
}));

export const syncRuns = table('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  originCode: text('origin_code').notNull(),
  currencyCode: text('currency_code').notNull(),
  status: text('status').notNull(),
  fetchedCount: integer('fetched_count').notNull().default(0),
  insertedCount: integer('inserted_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  notificationCount: integer('notification_count').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' })
}, (columns) => ({
  sourceStartedIndex: index('idx_sync_runs_source_started').on(
    columns.originCode,
    columns.currencyCode,
    columns.startedAt
  )
}));

export const syncLocks = table('sync_locks', {
  key: text('key').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

