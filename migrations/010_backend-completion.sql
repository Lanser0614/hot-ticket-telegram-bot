ALTER TABLE link_clicks RENAME TO link_clicks_legacy;

ALTER TABLE notification_history ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'instant'
  CHECK (delivery_kind IN ('instant', 'digest'));

CREATE TABLE link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER,
  source TEXT NOT NULL CHECK (source IN (
    'bot_search',
    'bot_notification',
    'bot_share',
    'miniapp_deals',
    'miniapp_card',
    'miniapp_watchlist'
  )),
  origin_code TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  subscription_id INTEGER,
  benchmark_price INTEGER,
  estimated_savings INTEGER,
  user_agent_kind TEXT NOT NULL CHECK (user_agent_kind IN (
    'human',
    'telegram_preview',
    'bot'
  )),
  clicked_at INTEGER NOT NULL
);

INSERT INTO link_clicks (
  id, ticket_id, user_id, source, origin_code, destination_code,
  departure_date, price, currency_code, subscription_id,
  benchmark_price, estimated_savings, user_agent_kind, clicked_at
)
SELECT
  id, ticket_id, user_id, source, origin_code, destination_code,
  departure_date, price, currency_code, subscription_id,
  NULL, NULL, user_agent_kind, clicked_at
FROM link_clicks_legacy;

DROP TABLE link_clicks_legacy;

CREATE INDEX idx_link_clicks_ticket
  ON link_clicks(ticket_id, clicked_at);
CREATE INDEX idx_link_clicks_user
  ON link_clicks(user_id, clicked_at);
CREATE INDEX idx_link_clicks_route
  ON link_clicks(origin_code, destination_code, clicked_at);
CREATE INDEX idx_link_clicks_dedup
  ON link_clicks(user_id, ticket_id, clicked_at);
CREATE INDEX idx_link_clicks_savings
  ON link_clicks(user_id, currency_code, clicked_at, estimated_savings);

CREATE TABLE notification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  ticket_id INTEGER NOT NULL,
  ticket_price INTEGER NOT NULL,
  notification_type TEXT NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'instant_or_digest' CHECK (delivery_mode IN (
    'instant_or_digest', 'digest_only'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'discarded', 'failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  sent_at INTEGER,
  telegram_message_id INTEGER,
  last_error TEXT,
  CONSTRAINT uq_notification_queue_candidate UNIQUE (
    user_id, subscription_id, ticket_id, ticket_price, notification_type
  )
);
CREATE INDEX idx_notification_queue_pending
  ON notification_queue(status, next_attempt_at, queued_at);
CREATE INDEX idx_notification_queue_user_subscription
  ON notification_queue(user_id, subscription_id, status, ticket_price);

CREATE TABLE digest_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  CONSTRAINT uq_digest_delivery_day UNIQUE (user_id, local_day)
);

CREATE TABLE referral_codes (
  user_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE referrals (
  referred_user_id INTEGER PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL,
  referral_code TEXT NOT NULL,
  shared_ticket_id INTEGER,
  attributed_at INTEGER NOT NULL,
  CHECK (referred_user_id <> referrer_user_id)
);
CREATE INDEX idx_referrals_referrer
  ON referrals(referrer_user_id, attributed_at);

CREATE TABLE pending_shared_tickets (
  user_id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
