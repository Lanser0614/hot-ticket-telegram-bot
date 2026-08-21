ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1
  CHECK (onboarding_completed IN (0, 1));
