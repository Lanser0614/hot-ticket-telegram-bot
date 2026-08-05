ALTER TABLE users ADD COLUMN preferred_trip_class TEXT NOT NULL DEFAULT 'economy'
  CHECK (preferred_trip_class IN ('economy', 'business'));

ALTER TABLE users ADD COLUMN baggage_required INTEGER NOT NULL DEFAULT 0
  CHECK (baggage_required IN (0, 1));

ALTER TABLE tickets ADD COLUMN trip_class TEXT NOT NULL DEFAULT 'economy'
  CHECK (trip_class IN ('economy', 'business'));

UPDATE users
SET default_origin_code = 'TAS', preferred_currency_code = 'UZS';

UPDATE subscriptions
SET origin_code = 'TAS', currency_code = 'UZS', baggage_required = 0;

UPDATE sync_sources SET is_enabled = 0;

INSERT INTO sync_sources (
  origin_code, currency_code, is_enabled, created_at, updated_at
) VALUES ('TAS', 'UZS', 1, unixepoch(), unixepoch())
ON CONFLICT(origin_code, currency_code) DO UPDATE SET
  is_enabled = 1,
  updated_at = excluded.updated_at;

CREATE INDEX idx_tickets_catalog_filters
  ON tickets(origin_code, currency_code, is_active, trip_class, departure_date, price, id);
