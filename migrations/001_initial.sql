CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  telegram_chat_id INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  language_code TEXT,
  default_origin_code TEXT NOT NULL DEFAULT 'TAS',
  preferred_currency_code TEXT NOT NULL DEFAULT 'UZS',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT NOT NULL UNIQUE,
  origin_code TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  departure_at TEXT,
  price INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  airline_code TEXT,
  airline_name TEXT,
  is_direct INTEGER NOT NULL DEFAULT 0 CHECK (is_direct IN (0, 1)),
  has_baggage INTEGER NOT NULL DEFAULT 0 CHECK (has_baggage IN (0, 1)),
  ticket_link TEXT NOT NULL,
  raw_ticket_link TEXT,
  raw_payload TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tickets_origin ON tickets(origin_code);
CREATE INDEX idx_tickets_destination ON tickets(destination_code);
CREATE INDEX idx_tickets_departure_date ON tickets(departure_date);
CREATE INDEX idx_tickets_price ON tickets(price);
CREATE INDEX idx_tickets_origin_currency ON tickets(origin_code, currency_code);
CREATE INDEX idx_tickets_active ON tickets(is_active, departure_date);

CREATE TABLE ticket_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  observed_at INTEGER NOT NULL
);
CREATE INDEX idx_ticket_price_history_ticket
  ON ticket_price_history(ticket_id, observed_at);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  origin_code TEXT NOT NULL,
  destination_code TEXT,
  currency_code TEXT NOT NULL,
  departure_date_from TEXT NOT NULL,
  departure_date_to TEXT NOT NULL,
  max_price INTEGER,
  direct_only INTEGER NOT NULL DEFAULT 0 CHECK (direct_only IN (0, 1)),
  baggage_required INTEGER NOT NULL DEFAULT 0 CHECK (baggage_required IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_subscriptions_user_active ON subscriptions(user_id, is_active);
CREATE INDEX idx_subscriptions_matching
  ON subscriptions(origin_code, currency_code, is_active);

CREATE TABLE notification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  notified_price INTEGER NOT NULL,
  notification_type TEXT NOT NULL,
  telegram_message_id INTEGER,
  sent_at INTEGER NOT NULL,
  CONSTRAINT uq_notification_history_delivery
    UNIQUE (user_id, subscription_id, ticket_id, notified_price)
);

CREATE TABLE user_sessions (
  user_id INTEGER PRIMARY KEY,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE sync_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_code TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT uq_sync_sources_origin_currency UNIQUE (origin_code, currency_code)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_code TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  notification_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_sync_runs_source_started
  ON sync_runs(origin_code, currency_code, started_at);

CREATE TABLE sync_locks (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
