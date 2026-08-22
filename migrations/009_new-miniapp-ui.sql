ALTER TABLE subscriptions ADD COLUMN trip_class TEXT NOT NULL DEFAULT 'economy'
  CHECK (trip_class IN ('economy', 'business'));

UPDATE subscriptions
SET trip_class = COALESCE((
  SELECT preferred_trip_class FROM users WHERE users.id = subscriptions.user_id
), 'economy'),
baggage_required = COALESCE((
  SELECT baggage_required FROM users WHERE users.id = subscriptions.user_id
), baggage_required);

ALTER TABLE users ADD COLUMN instant_notifications_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (instant_notifications_enabled IN (0, 1));
ALTER TABLE users ADD COLUMN morning_digest_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (morning_digest_enabled IN (0, 1));
ALTER TABLE users ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (quiet_hours_enabled IN (0, 1));
ALTER TABLE users ADD COLUMN quiet_start_minute INTEGER NOT NULL DEFAULT 1380
  CHECK (quiet_start_minute BETWEEN 0 AND 1439);
ALTER TABLE users ADD COLUMN quiet_end_minute INTEGER NOT NULL DEFAULT 480
  CHECK (quiet_end_minute BETWEEN 0 AND 1439);

CREATE INDEX idx_subscriptions_exact_matching
  ON subscriptions(origin_code, destination_code, currency_code, trip_class, is_active);
