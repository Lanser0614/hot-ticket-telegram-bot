# Hot Ticket Bot Design

## Goal

Build an MVP Telegram bot that periodically imports hot flight offers from the Aviasales Hot Offers API, stores current offers and price history, lets Telegram users browse and filter tickets, manages ticket subscriptions, and sends deduplicated notifications for new tickets and price drops.

The production runtime is Telegram Serverless. Application code is authored in strict TypeScript and compiled to the plain JavaScript modules accepted by Telegram Serverless.

## Scope

The MVP includes:

- Telegram registration through `/start` and automatic profile updates from Telegram data.
- Optional phone collection with contact ownership validation.
- User settings for a three-character origin code and a three-character currency code.
- Ticket browsing, sorting, filtering, and Aviasales links.
- Subscription creation, listing, and deactivation, with at most 20 active subscriptions per user.
- Aviasales synchronization for the initial `TAS` and `UZS` source.
- Ticket upsert, price history, expiry, subscription matching, notifications, and notification deduplication.
- Unit and integration tests for the business rules from the supplied requirements.

The public HTTP or cron trigger is intentionally deferred. The synchronization use case will expose a stable callable interface so an HTTP endpoint, Telegram Cloud CLI invocation, or another external trigger can be added without modifying synchronization business logic.

The MVP does not include city or country dictionaries, IATA-to-name mapping, multiple travel classes, round trips, payments, an admin UI, or binary file processing.

## Platform Constraints

Telegram Serverless deploys only `schema.js`, flat `handlers/*.js`, and `lib/**/*.js`. The runtime is an isolated V8 environment with no filesystem, no runtime `node_modules`, and no network access except `fetch` from Telegram's `sdk`. Project modules use Telegram's bare module names rather than relative import paths.

The built-in database is SQLite-backed and accessed asynchronously through the `sdk/db` query builder. Foreign keys are unavailable, so relations use integer identifier columns and application services enforce ownership and integrity.

The Bot API is accessed through `api` from `sdk`; no Telegram bot token is read by application code. Aviasales is accessed through `fetch` from `sdk`. External JSON is always accepted as `unknown` and validated before use.

## Build Layout

The repository keeps editable TypeScript and generated Telegram modules separate:

```text
src/
├── domain/
├── application/
├── infrastructure/
├── platform/
└── handlers/
schema.ts
tests/
scripts/
telegram-dist/
├── handlers/
├── lib/
└── schema.js
```

`src/domain` contains pure models, validation, matching, price-drop detection, link normalization, and external-key creation. `src/application` contains use cases and repository/provider interfaces. `src/infrastructure` contains Aviasales mapping and platform-independent repository logic. `src/platform` binds application interfaces to Telegram's `sdk`. `src/handlers` contains thin Telegram update entry points.

The local compiler produces deployable JavaScript in `telegram-dist`. A packaging step rewrites project imports to Telegram bare module names and ensures that only supported files are deployed. Tests run against TypeScript sources and in-memory fakes; platform adapters receive dedicated contract tests with mocked `sdk` boundaries.

No production runtime dependency may be imported except `sdk`, `sdk/db`, `sdk/api`, `sdk/fetch`, `schema`, and modules produced under `lib/` or `handlers/`.

## Domain Model and Database

The database contains the required tables:

- `users` stores Telegram identity, chat identity, optional contact data, default origin and preferred currency.
- `tickets` stores normalized current offers, the stable external key, normalized and raw links, raw API payload, first/last seen timestamps, and activity state.
- `ticket_price_history` stores a row only when a ticket price changes.
- `subscriptions` stores route, date, price, direct-flight, baggage, and activity filters.
- `notification_history` records successfully sent notifications and enforces uniqueness for user, subscription, ticket, and notified price.
- `user_sessions` stores conversational flow state with a 30-minute expiry.
- `sync_sources` stores enabled origin/currency pairs and starts with `TAS` plus `UZS`.
- `sync_runs` records synchronization status and counters.
- `sync_locks` provides a database-backed five-minute lease per origin/currency pair.

Dates and timestamps are represented by `Date` values in application code and timestamp integers in Telegram SQLite. Departure dates are normalized to `YYYY-MM-DD` strings because matching is date-based rather than timezone-instant-based. Currency amounts are non-negative safe integers in the smallest available whole unit returned by Aviasales; the MVP does not perform currency conversion.

All Telegram IDs are stored as integers only if the runtime preserves JavaScript safe-integer precision for the value. Validation rejects unsafe integers rather than silently rounding them.

## Aviasales Integration

The provider accepts exactly:

```ts
interface HotTicketsProvider {
  getHotTickets(input: {
    originCode: string;
    currencyCode: string;
  }): Promise<Ticket[]>;
}
```

The URL builder validates the two required codes, normalizes their case, and applies the defaults specified in the requirements. It never issues a request with a missing or invalid origin or currency.

The HTTP client uses a 10-second timeout and at most three attempts. It retries network failures, timeouts, and HTTP `429`, `500`, `502`, `503`, and `504`. It does not retry other 4xx responses, malformed JSON, or structurally invalid responses.

Before the response mapper is finalized, a real response from the API is saved as a test fixture. The mapper accepts `unknown`, locates the actual offer array from that fixture, validates each offer independently, logs rejected offers, and continues processing valid offers. Fields absent from the real response are represented as `null` or `false` only when that interpretation is supported by the API payload; the implementation will not invent fields.

Ticket links are trimmed and stripped of query parameters. The search code is extracted from the normalized `/search/<code>` path. The external key is SHA-256 over origin, destination, departure date, search code, and currency; price is excluded.

## Synchronization Flow

The application exposes `syncHotTickets(input)` as a trigger-independent use case. For each enabled source it:

1. Validates origin and currency.
2. Acquires the database lease `sync:hot-tickets:{origin}:{currency}` for five minutes.
3. Creates a `running` sync record.
4. Fetches and maps Aviasales offers.
5. Inserts new tickets or updates existing tickets by external key.
6. Updates `last_seen_at` and writes price history only when price changes.
7. Marks tickets unseen for six hours as inactive.
8. Matches new tickets and price drops against active subscriptions.
9. Sends Telegram notifications and writes notification history only after successful delivery.
10. Completes the sync record as `success` or `failed` and releases the lease in a `finally` path.

The lease acquisition is an atomic database operation. A competing invocation records or returns a `skipped` result. Ticket upserts and unique notification inserts provide a second idempotency layer if a caller retries after an uncertain response.

The trigger adapter is not part of the initial implementation milestone. Its eventual contract is to authenticate the caller, invoke the use case, and serialize the returned counters without containing synchronization logic.

## Telegram Interaction

Telegram entry points remain thin. `handlers/message.js` routes commands, text input, and contacts. `handlers/callback_query.js` routes inline keyboard actions. Shared routing and use cases live under deployed `lib/` modules.

`/start` upserts the user by Telegram user ID, refreshes chat and profile fields, and displays the main menu. Contact handling requires `message.contact.user_id === message.from.id`.

Multi-step settings and subscription creation use `user_sessions`. Each transition validates the current flow and step, updates a JSON payload, refreshes expiry, and provides cancel behavior. Expired sessions are ignored and removed opportunistically.

Ticket listing defaults to active future tickets for the user's origin and currency, ordered by ascending price and limited to five. Callback data contains compact identifiers and actions rather than trusted business data; every callback reloads the resource and verifies ownership.

All displayed routes remain raw codes such as `TAS → IST`. The ticket button uses the normalized Aviasales URL and the message warns that the offer can change after navigation.

## Error Handling and Security

Validation errors result in concise Russian user messages and do not expose stack traces. Unexpected failures are logged with operation identifiers and safe context, while secrets, authorization headers, contact phone values, and full raw Telegram updates are not logged.

Repository methods verify subscription ownership before reading or modifying user-controlled resources. Database operations insert parent records before dependent records because foreign keys are unavailable. Unique constraints handle concurrent registration, ticket upserts, and notification deduplication.

The future public synchronization endpoint must be HTTPS, accept only `POST`, compare a bearer secret, and return no internal error details. These requirements remain part of the design even though the trigger implementation is deferred.

## Testing Strategy

Vitest runs in strict TypeScript mode. Pure unit tests cover URL normalization, search-code extraction, external-key stability, code validation, URL construction, monetary and date validation, subscription matching, price-drop detection, retry classification, and notification deduplication.

Aviasales mapper tests use the captured real fixture plus malformed variants. A single invalid offer must not reject a valid response containing other offers.

Integration tests use in-memory repositories and fake Telegram/Aviasales ports to cover user upsert, contact ownership, new and repeated synchronization, price history, notification delivery, duplicate suppression, inactive subscriptions, expired tickets, source locks, and failed sends. Platform contract tests verify that Telegram `sdk` adapters translate between application interfaces and asynchronous SDK calls.

The release gate runs formatting checks, ESLint, `tsc --noEmit`, Vitest, the Telegram packaging step, and a static scan proving that deploy output contains only supported JavaScript modules and allowed runtime imports.

## Delivery Order

Implementation proceeds in independently testable vertical slices:

1. Tooling, strict TypeScript configuration, test harness, and deploy packaging.
2. Pure domain validation, ticket identity, dates, money, and subscription matching.
3. Telegram `schema.ts` and repository contracts.
4. Aviasales URL/client/fixture/mapper.
5. Ticket persistence, price history, leases, and synchronization orchestration.
6. User registration, settings, sessions, and ticket browsing.
7. Subscription flows, matching, Telegram notifications, and deduplication.
8. Telegram Serverless adapters, deploy verification, and README.
9. External cron trigger adapter after its hosting mechanism is selected.

Each slice adds tests before implementation and must pass the full local verification suite before the next slice begins.
