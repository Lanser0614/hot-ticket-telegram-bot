CREATE TABLE link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER,
  source TEXT NOT NULL CHECK (source IN (
    'bot_search',
    'bot_notification',
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
  user_agent_kind TEXT NOT NULL CHECK (user_agent_kind IN (
    'human',
    'telegram_preview',
    'bot'
  )),
  clicked_at INTEGER NOT NULL
);

CREATE INDEX idx_link_clicks_ticket
  ON link_clicks(ticket_id, clicked_at);
CREATE INDEX idx_link_clicks_user
  ON link_clicks(user_id, clicked_at);
CREATE INDEX idx_link_clicks_route
  ON link_clicks(origin_code, destination_code, clicked_at);
CREATE INDEX idx_link_clicks_dedup
  ON link_clicks(user_id, ticket_id, clicked_at);
