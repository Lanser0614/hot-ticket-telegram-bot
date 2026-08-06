ALTER TABLE subscriptions ADD COLUMN round_trip_only INTEGER NOT NULL DEFAULT 0
  CHECK (round_trip_only IN (0, 1));
