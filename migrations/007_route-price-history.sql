CREATE TABLE route_price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key TEXT NOT NULL,
  origin_code TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  trip_class TEXT NOT NULL CHECK (trip_class IN ('economy', 'business')),
  is_direct INTEGER NOT NULL CHECK (is_direct IN (0, 1)),
  has_baggage INTEGER NOT NULL CHECK (has_baggage IN (0, 1)),
  departure_date TEXT NOT NULL,
  days_ahead INTEGER NOT NULL,
  price INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  observed_hour INTEGER NOT NULL,
  CONSTRAINT uq_route_observation UNIQUE (
    route_key,
    departure_date,
    is_direct,
    has_baggage,
    observed_hour
  )
);

CREATE INDEX idx_route_observations_route_time
  ON route_price_observations(route_key, observed_at);
CREATE INDEX idx_route_observations_cleanup
  ON route_price_observations(observed_at);

CREATE TABLE route_price_daily (
  route_key TEXT NOT NULL,
  day TEXT NOT NULL,
  origin_code TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  trip_class TEXT NOT NULL CHECK (trip_class IN ('economy', 'business')),
  min_price INTEGER NOT NULL,
  avg_price INTEGER NOT NULL,
  median_price INTEGER NOT NULL,
  max_price INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (route_key, day)
);

CREATE INDEX idx_route_price_daily_route
  ON route_price_daily(route_key, day);
