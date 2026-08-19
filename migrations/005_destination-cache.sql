CREATE TABLE destination_cache (
  origin_code TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  departure_date_from TEXT NOT NULL,
  trip_class TEXT NOT NULL CHECK (trip_class IN ('economy', 'business')),
  baggage_required INTEGER NOT NULL CHECK (baggage_required IN (0, 1)),
  destination_codes TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (
    origin_code,
    currency_code,
    departure_date_from,
    trip_class,
    baggage_required
  )
);

CREATE INDEX idx_destination_cache_source
  ON destination_cache(origin_code, currency_code);
