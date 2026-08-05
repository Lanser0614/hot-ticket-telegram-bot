# Fixed Tashkent Ticket Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сделать `TAS/UZS` неизменяемой основой каталога, добавить поиск направления по русскому названию или IATA-коду, постраничный просмотр всех билетов и динамическую фильтрацию выдачи и уведомлений по классу и багажу.

**Architecture:** один глобальный sync source запрашивает Explore API только с `origin=TAS&currency=uzs` и сохраняет полный каталог с классом и багажом. Пользовательские настройки живут в `users` и применяются при чтении каталога и перед отправкой уведомления. Telegram-router управляет отдельной search-session и stateless callback-пагинацией, а domain helper изолирует работу с русским IATA-справочником.

**Tech Stack:** Node.js 24, strict TypeScript, SQLite/`better-sqlite3`, native `fetch`, Telegram Bot API long polling, Vitest, ESLint.

## Global Constraints

- Работать в текущей ветке `main`; отдельную ветку и worktree не создавать.
- Каждую shell-команду выполнять через `rtk` согласно `AGENTS.md`.
- Сохранять пользовательские незакоммиченные изменения. Не добавлять в коммиты `.codex/`, `.idea/`, `generated/`, `scripts/`, `package.json` и `package-lock.json`, если конкретный шаг явно не потребует их изменения.
- Существующие пользовательские `src/constants/iata-locations-ru.ts` и `src/domain/locations.ts` считать входными файлами этой функции: проверить и включить их в первый тематический коммит, не перегенерируя справочник.
- Origin всегда `TAS`, currency всегда `UZS`; Telegram-flow не принимает и не сохраняет их из пользовательского ввода.
- Explore API получает ровно два query-параметра: `origin=TAS` и `currency=uzs`.
- `trip_class` и `with_baggage` синхронизируются для всего каталога; фильтры пользователя не влияют на sync.
- Размер страницы — 10, repository получает 11 записей; сортировка стабильная: `price`, `departure_date`, `id`.
- Callback data должна оставаться короче Telegram-лимита 64 bytes и не хранить серверное состояние другого пользователя.
- На каждом шаге сначала запускать указанный тест и увидеть ожидаемое падение, затем писать минимальную реализацию.
- В коммит добавлять только файлы текущей задачи явным списком.

---

## Task 1: Зафиксировать каталог TAS/UZS и слой русских названий

**Files:**
- Create: `src/domain/travel-preferences.ts`
- Modify: `src/domain/locations.ts`
- Adopt: `src/constants/iata-locations-ru.ts`
- Create: `tests/unit/domain/locations.test.ts`
- Create: `tests/unit/domain/travel-preferences.test.ts`

**Interfaces:**

```ts
export const DEFAULT_ORIGIN_CODE = 'TAS';
export const DEFAULT_CURRENCY_CODE = 'UZS';
export const TICKET_PAGE_SIZE = 10;
export type TripClass = 'economy' | 'business';

export interface LocationMatch {
  readonly code: string;
  readonly label: string;
}

export type LocationResolution =
  | { readonly kind: 'resolved'; readonly code: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly LocationMatch[] }
  | { readonly kind: 'not_found' };

export function formatLocationLabel(code: string): string;
export function resolveLocation(input: string): LocationResolution;
```

- [ ] **Step 1: написать падающие тесты констант и formatter**

```ts
it('фиксирует TAS, UZS и десять билетов на странице', () => {
  expect(DEFAULT_ORIGIN_CODE).toBe('TAS');
  expect(DEFAULT_CURRENCY_CODE).toBe('UZS');
  expect(TICKET_PAGE_SIZE).toBe(10);
});

it('форматирует известный и неизвестный IATA-код', () => {
  expect(formatLocationLabel('TAS')).toBe('Ташкент (TAS)');
  expect(formatLocationLabel('ZZZ')).toBe('ZZZ');
});
```

- [ ] **Step 2: написать падающие тесты resolver**

```ts
it.each([
  ['IST', 'IST'],
  ['  ist  ', 'IST'],
  ['Стамбул', 'IST'],
  ['  стамбул  ', 'IST']
])('разрешает %s в %s', (input, code) => {
  expect(resolveLocation(input)).toEqual({ kind: 'resolved', code });
});

it('возвращает not_found без fuzzy-поиска', () => {
  expect(resolveLocation('Стамблл')).toEqual({ kind: 'not_found' });
});
```

Добавить отдельные реальные cases из `IATA_LOCATIONS_RU`: `Стамбул` должен выбрать единственный city entry `IST` среди airport entries `ISL/SAW`, а `Абердин` должен вернуть `ambiguous` с отсортированными уникальными city codes `ABR`, `ABZ`, `APG`.

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/domain/locations.test.ts tests/unit/domain/travel-preferences.test.ts`

Expected: FAIL — `travel-preferences.ts` и `resolveLocation` отсутствуют.

- [ ] **Step 4: реализовать константы и точное разрешение локации**

В `locations.ts` один раз построить индексы по нормализованному `code`, `name` и `cityName`. Нормализация должна делать `trim()`, схлопывать пробелы, приводить строку к нижнему регистру и заменять `ё` на `е`; никаких substring/fuzzy совпадений.

Алгоритм выбора:

```ts
const cityCodes = [...new Set(
  matches
    .filter((item) => item.code === item.cityCode)
    .map((item) => item.code)
)].sort();
if (cityCodes.length === 1) return { kind: 'resolved', code: cityCodes[0]! };
const codes = [...new Set(matches.map((item) => item.cityCode || item.code))].sort();
if (codes.length === 1) return { kind: 'resolved', code: codes[0]! };
return {
  kind: 'ambiguous',
  candidates: codes.map((code) => ({ code, label: formatLocationLabel(code) }))
};
```

`formatLocationLabel` нормализует код через существующий `normalizeIataCode`, но при ошибке возвращает trimmed uppercase fallback, чтобы неизвестное сохранённое значение не ломало presenter.

- [ ] **Step 5: выполнить проверки задачи**

Run: `rtk npm test -- tests/unit/domain/locations.test.ts tests/unit/domain/travel-preferences.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 6: создать коммит только runtime-артефактов справочника**

```bash
rtk git add src/constants/iata-locations-ru.ts src/domain/locations.ts src/domain/travel-preferences.ts tests/unit/domain/locations.test.ts tests/unit/domain/travel-preferences.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: add fixed travel catalog and location lookup"
```

---

## Task 2: Добавить класс перелёта и пользовательские фильтры в модель и SQLite

**Files:**
- Modify: `src/domain/ticket.ts`
- Modify: `src/application/models.ts`
- Modify: `src/application/ports.ts`
- Create: `migrations/002_fixed_tashkent_search.sql`
- Modify: `src/infrastructure/sqlite/repositories.ts`
- Modify: `src/infrastructure/memory/store.ts`
- Modify: `tests/unit/domain/ticket.test.ts`
- Modify: `tests/integration/sqlite-migrations.test.ts`
- Modify: `tests/integration/sqlite-repositories.test.ts`
- Modify: all test ticket/user factories that no longer satisfy the strict types

**Model changes:**

В существующий `Ticket` добавить точное поле `readonly tripClass: TripClass` рядом с `hasBaggage`. В существующий `User` добавить `preferredTripClass: TripClass` и `baggageRequired: boolean`, сохранив `defaultOriginCode` и `preferredCurrencyCode` только для совместимости schema. В существующий `TicketQuery` добавить обязательные `tripClass: TripClass` и `baggageRequired: boolean`.

`UserRepository.updatePreferences` заменить на:

```ts
updateTicketPreferences(
  userId: number,
  tripClass: TripClass,
  baggageRequired: boolean,
  now: Date
): Promise<void>;
```

- [ ] **Step 1: написать падающий migration test на legacy-данные**

Тест сначала применяет только `001_initial.sql`, вставляет пользователя с `ALA/USD`, подписку с `ALA/USD` и baggage `1`, два sync source (`ALA/USD` enabled и `TAS/UZS` disabled), затем применяет все migrations и проверяет:

```ts
expect(user).toMatchObject({
  default_origin_code: 'TAS',
  preferred_currency_code: 'UZS',
  preferred_trip_class: 'economy',
  baggage_required: 0
});
expect(subscription).toMatchObject({
  origin_code: 'TAS',
  currency_code: 'UZS',
  baggage_required: 0
});
expect(enabledSources).toEqual([{ origin_code: 'TAS', currency_code: 'UZS' }]);
```

Также проверить, что legacy ticket получает `trip_class='economy'`.

- [ ] **Step 2: написать падающие repository tests**

Проверить round trip пользователя с `business/true`, round trip билета с `tripClass='business'`, а также SQL-фильтры:

```ts
const tickets = await repository.listActive({
  originCode: 'TAS', currencyCode: 'UZS',
  departureDateFrom: '2026-08-05', departureDateTo: null,
  destinationCode: null, maxPrice: null, directOnly: false,
  tripClass: 'business', baggageRequired: true,
  sort: 'price_asc', limit: 11, offset: 0
});
expect(tickets.map((ticket) => ticket.externalKey)).toEqual(['business-with-bag']);
```

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/domain/ticket.test.ts tests/integration/sqlite-migrations.test.ts tests/integration/sqlite-repositories.test.ts`

Expected: FAIL — schema и strict model ещё не знают новые поля.

- [ ] **Step 4: добавить миграцию**

`002_fixed_tashkent_search.sql`:

```sql
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
```

- [ ] **Step 5: провести новые поля через adapters**

В SQLite mapping валидировать `trip_class` как union, переводить integer baggage в boolean. В `upsert` записывать и обновлять `trip_class`. В `listActive` всегда добавлять `trip_class = @tripClass` и только при `baggageRequired` добавлять `has_baggage = 1`. В memory adapter повторить ту же семантику.

`ensureInitialSource` изменить на `ON CONFLICT ... DO UPDATE SET is_enabled = 1`, чтобы существующий отключённый `TAS/UZS` восстанавливался.

- [ ] **Step 6: обновить strict test factories**

Во всех существующих user fixtures добавить `preferredTripClass: 'economy'`, `baggageRequired: false`; во всех ticket fixtures — `tripClass: 'economy'`. Не ослаблять типы до optional и не использовать type assertions для обхода ошибок.

- [ ] **Step 7: выполнить проверки задачи**

Run: `rtk npm test -- tests/unit/domain/ticket.test.ts tests/integration/sqlite-migrations.test.ts tests/integration/sqlite-repositories.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 8: создать коммит**

```bash
rtk git add migrations/002_fixed_tashkent_search.sql src/domain/ticket.ts src/application/models.ts src/application/ports.ts src/infrastructure/sqlite/repositories.ts src/infrastructure/memory/store.ts tests/unit/domain/ticket.test.ts tests/unit/domain/subscription.test.ts tests/unit/domain/ticket-events.test.ts tests/integration/sqlite-migrations.test.ts tests/integration/sqlite-repositories.test.ts tests/integration/sync-hot-tickets.test.ts tests/integration/telegram-flows.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: persist ticket class and user filters"
```

Перед коммитом проверить `rtk git diff --cached --name-only` и убрать из index любые файлы вне перечисленного scope.

---

## Task 3: Ограничить Explore API двумя параметрами и сохранить класс предложения

**Files:**
- Modify: `src/infrastructure/aviasales/url.ts`
- Modify: `src/infrastructure/aviasales/mapper.ts`
- Modify: `src/domain/ticket.ts`
- Modify: `tests/unit/aviasales/url.test.ts`
- Modify: `tests/unit/aviasales/mapper.test.ts`
- Modify: `tests/unit/domain/ticket.test.ts`
- Modify: `tests/fixtures/aviasales-hot-offers.json` only if a second class is needed for coverage

- [ ] **Step 1: написать падающий exact-query test**

```ts
it('отправляет только origin и currency', () => {
  const config = loadConfig({
    AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
  });
  const url = createHotOffersUrl({
    originCode: 'TAS', currencyCode: 'UZS'
  }, config);
  expect(url.pathname).toBe('/v1/hot_offers/list.json');
  expect(url.search).toBe('?origin=TAS&currency=uzs');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    origin: 'TAS', currency: 'uzs'
  });
  expect([...url.searchParams.keys()].sort()).toEqual(['currency', 'origin']);
});
```

- [ ] **Step 2: написать падающие mapper tests**

Проверить `trip_class: 1 -> economy`, `trip_class: 2 -> business`, `with_baggage -> hasBaggage`, а неизвестный `trip_class: 3` приводит к пропуску offer существующим guarded mapper и событию `aviasales_offer_mapping_failed` без raw payload.

- [ ] **Step 3: написать падающий external-key test**

```ts
const base = {
  originCode: 'TAS',
  destinationCode: 'IST',
  departureDate: '2026-09-01',
  ticketSearchCode: 'search-123',
  currencyCode: 'UZS'
};
expect(createExternalKey({ ...base, tripClass: 'economy' }))
  .not.toBe(createExternalKey({ ...base, tripClass: 'business' }));
```

- [ ] **Step 4: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/aviasales/url.test.ts tests/unit/aviasales/mapper.test.ts tests/unit/domain/ticket.test.ts`

Expected: FAIL — URL содержит прежние параметры, mapper/external key не различают class.

- [ ] **Step 5: реализовать минимальный URL и mapping**

```ts
const params = new URLSearchParams({
  origin: normalizeIataCode(input.originCode),
  currency: normalizeCurrencyCode(input.currencyCode).toLowerCase()
});
```

Удалить добавление `trip_class`, `with_baggage`, `direct`, `language`, `market` и иных defaults. В mapper добавить исчерпывающий helper:

```ts
function mapTripClass(value: unknown): TripClass {
  if (value === 1) return 'economy';
  if (value === 2) return 'business';
  throw new TypeError('Неизвестный trip_class');
}
```

Добавить `tripClass` в `ExternalKeyInput` и сериализуемую последовательность key. Не менять контракт `HotTicketsProvider`: source по-прежнему передаёт `originCode/currencyCode`, а единственность source гарантируется миграцией и job.

- [ ] **Step 6: выполнить проверки задачи**

Run: `rtk npm test -- tests/unit/aviasales/url.test.ts tests/unit/aviasales/mapper.test.ts tests/unit/domain/ticket.test.ts tests/integration/sync-hot-tickets.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 7: создать коммит**

```bash
rtk git add src/infrastructure/aviasales/url.ts src/infrastructure/aviasales/mapper.ts src/domain/ticket.ts tests/unit/aviasales/url.test.ts tests/unit/aviasales/mapper.test.ts tests/unit/domain/ticket.test.ts tests/fixtures/aviasales-hot-offers.json
rtk git diff --cached --check
rtk git commit -m "feat: sync complete TAS catalog"
```

Если fixture не менялся, не передавать его в `git add`.

---

## Task 4: Перенести настройки пользователя на класс и багаж

**Files:**
- Modify: `src/application/users.ts`
- Modify: `src/domain/travel-preferences.ts`
- Modify: `tests/integration/telegram-flows.test.ts`
- Modify: `tests/contract/telegram-repositories.test.ts`

**Interfaces:**

```ts
export function assertTripClass(value: string): TripClass;

export interface UserTicketPreferences {
  readonly preferredTripClass: TripClass;
  readonly baggageRequired: boolean;
}

export function matchesUserTicketPreferences(
  ticket: Pick<Ticket, 'tripClass' | 'hasBaggage'>,
  preferences: UserTicketPreferences
): boolean;

public updateTicketPreferences(
  telegramUserId: number,
  tripClass: TripClass,
  baggageRequired: boolean
): Promise<void>;
```

- [ ] **Step 1: написать падающие domain tests matching**

Таблично проверить четыре сигнатуры `E0`, `E1`, `B0`, `B1`: класс всегда должен совпадать; отсутствие багажа запрещено только при `baggageRequired=true`.

- [ ] **Step 2: написать падающий service/repository contract test**

Создать пользователя, вызвать `updateTicketPreferences(id, 'business', true)` и проверить сохранённые значения. Обновить repository contract так, чтобы публичный mutation принимал только class/baggage и не принимал origin/currency.

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/domain/travel-preferences.test.ts tests/contract/telegram-repositories.test.ts tests/integration/telegram-flows.test.ts`

Expected: FAIL — сервис всё ещё принимает origin/currency.

- [ ] **Step 4: реализовать validation и service**

`assertTripClass` принимает только union values после trim/lowercase. Router отвечает за перевод русских button labels в union; repository получает только валидный тип.

```ts
public async updateTicketPreferences(
  telegramUserId: number,
  tripClass: TripClass,
  baggageRequired: boolean
): Promise<void> {
  const user = await this.requireByTelegramUserId(telegramUserId);
  await this.users.updateTicketPreferences(
    user.id, tripClass, baggageRequired, this.clock.now()
  );
}
```

- [ ] **Step 5: выполнить проверки и создать коммит**

Run: `rtk npm test -- tests/unit/domain/travel-preferences.test.ts tests/contract/telegram-repositories.test.ts tests/integration/telegram-flows.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

```bash
rtk git add src/application/users.ts src/domain/travel-preferences.ts tests/unit/domain/travel-preferences.test.ts tests/contract/telegram-repositories.test.ts tests/integration/telegram-flows.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: manage class and baggage preferences"
```

---

## Task 5: Реализовать стабильную постраничную выдачу всего каталога

**Files:**
- Modify: `src/application/tickets.ts`
- Modify: `src/application/models.ts`
- Modify: `src/infrastructure/sqlite/repositories.ts`
- Modify: `src/infrastructure/memory/store.ts`
- Create: `tests/unit/application/tickets.test.ts`
- Modify: `tests/integration/sqlite-repositories.test.ts`

**Interfaces:**

```ts
export interface TicketListingOptions {
  destinationCode?: string;
  departureDateFrom?: string;
  departureDateTo?: string;
  maxPrice?: number;
  directOnly?: boolean;
  offset?: number;
}

export interface TicketPage {
  readonly tickets: readonly StoredTicket[];
  readonly destinationCode: string | null;
  readonly offset: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

public listPageForTelegramUser(
  telegramUserId: number,
  options: TicketListingOptions
): Promise<TicketPage>;
```

- [ ] **Step 1: написать падающие service tests**

С fake repository проверить, что сервис:

- всегда передаёт `TAS/UZS`, а не legacy-поля пользователя;
- передаёт текущие `preferredTripClass/baggageRequired`;
- запрашивает `limit: 11` и заданный `offset`;
- возвращает только первые 10 записей и `hasNext=true` при 11-й;
- возвращает `hasPrevious=offset>0`;
- отклоняет отрицательный, дробный и превышающий safe bound offset.

Зафиксировать safe bound константой `MAX_TICKET_OFFSET = 10_000` в `tickets.ts`.

- [ ] **Step 2: написать падающий integration test стабильного порядка**

Вставить 23 активных билета с одинаковыми ценами/датами и разными id, получить страницы `offset 0`, `10`, `20` и проверить 23 уникальных id без пропусков. Отдельно проверить destination filter и режим без destination.

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/application/tickets.test.ts tests/integration/sqlite-repositories.test.ts`

Expected: FAIL — сервис жёстко ограничен пятью билетами и не возвращает page metadata.

- [ ] **Step 4: реализовать service page**

```ts
const rows = await this.tickets.listActive({
  originCode: DEFAULT_ORIGIN_CODE,
  currencyCode: DEFAULT_CURRENCY_CODE,
  departureDateFrom,
  departureDateTo,
  destinationCode,
  maxPrice,
  directOnly: options.directOnly ?? false,
  tripClass: user.preferredTripClass,
  baggageRequired: user.baggageRequired,
  sort: 'price_asc',
  limit: TICKET_PAGE_SIZE + 1,
  offset
});
return {
  tickets: rows.slice(0, TICKET_PAGE_SIZE),
  destinationCode,
  offset,
  hasPrevious: offset > 0,
  hasNext: rows.length > TICKET_PAGE_SIZE
};
```

Не оставлять старый default `limit=5`. Удалить `sort` из публичных user options, чтобы pagination всегда использовала один стабильный порядок.

- [ ] **Step 5: исправить SQL order**

Для `price_asc` использовать `ORDER BY price ASC, departure_date ASC, id ASC`. Memory repository должен повторять сравнение по этим трём полям до `slice(offset, offset + limit)`.

- [ ] **Step 6: выполнить проверки и создать коммит**

Run: `rtk npm test -- tests/unit/application/tickets.test.ts tests/integration/sqlite-repositories.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

```bash
rtk git add src/application/tickets.ts src/application/models.ts src/infrastructure/sqlite/repositories.ts src/infrastructure/memory/store.ts tests/unit/application/tickets.test.ts tests/integration/sqlite-repositories.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: paginate all matching tickets"
```

---

## Task 6: Добавить компактные callback cursors и Telegram navigation

**Files:**
- Create: `src/presentation/ticket-pagination.ts`
- Modify: `src/presentation/keyboards.ts`
- Modify: `src/infrastructure/telegram/updates.ts`
- Modify: `src/application/bot-router.ts`
- Create: `tests/unit/presentation/ticket-pagination.test.ts`
- Modify: `tests/unit/telegram/updates.test.ts`

**Interfaces:**

```ts
export interface TicketCursor {
  readonly destinationCode: string | null;
  readonly offset: number;
  readonly tripClass: TripClass;
  readonly baggageRequired: boolean;
}

export function encodeTicketCursor(cursor: TicketCursor): string;
export function parseTicketCursor(data: string): TicketCursor | null;
export function ticketNavigationKeyboard(
  page: TicketPage,
  cursor: Omit<TicketCursor, 'offset'>
): unknown;
export function allDestinationsKeyboard(
  preferences: {
    readonly tripClass: TripClass;
    readonly baggageRequired: boolean;
  }
): unknown;

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  chatId: number | null;
  data?: string;
}
```

- [ ] **Step 1: написать падающие cursor tests**

```ts
it('кодирует и читает короткий callback', () => {
  const data = encodeTicketCursor({
    destinationCode: 'IST', offset: 10,
    tripClass: 'economy', baggageRequired: true
  });
  expect(data).toBe('tickets:IST:10:E1');
  expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
  expect(parseTicketCursor(data)).toEqual({
    destinationCode: 'IST', offset: 10,
    tripClass: 'economy', baggageRequired: true
  });
});
```

Добавить cases `ALL`, `B0`, malformed destination, negative/fractional/offset > 10_000 и неизвестную сигнатуру; parser должен вернуть `null`, не бросать.

- [ ] **Step 2: написать падающий update parser test**

Telegram update с `callback_query.message.chat.id` должен преобразоваться в `chatId`; inline callback без `message` — в `null`.

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/unit/presentation/ticket-pagination.test.ts tests/unit/telegram/updates.test.ts`

Expected: FAIL — cursor helper и callback chat id отсутствуют.

- [ ] **Step 4: реализовать cursor grammar и keyboards**

Grammar строго: `^tickets:(ALL|[A-Z]{3}):(0|[1-9]\d*):([EB])([01])$`. Кодировать только offsets, кратные `TICKET_PAGE_SIZE`. Keyboard строит `⬅️ Назад` с `max(0, offset-10)` и `➡️ Показать ещё` с `offset+10` по page flags.

- [ ] **Step 5: добавить callback dispatch в router**

В начале `handleCallbackQuery` распознать ticket cursor. Если `chatId === null`, ответить callback `Не удалось открыть страницу` и завершить. Загрузить пользователя только по `query.from.id`; сравнить `E/B + 0/1` с текущими настройками. При несовпадении filters вызвать page с `offset: 0`, иначе использовать cursor offset. После успешной отправки всегда вызвать `answerCallbackQuery({ callbackQueryId: query.id })`.

Внутренние parse/validation ошибки переводить в `Некорректная страница`, без stack/raw data.

- [ ] **Step 6: выполнить проверки и создать коммит**

Run: `rtk npm test -- tests/unit/presentation/ticket-pagination.test.ts tests/unit/telegram/updates.test.ts tests/integration/telegram-flows.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

```bash
rtk git add src/presentation/ticket-pagination.ts src/presentation/keyboards.ts src/infrastructure/telegram/updates.ts src/application/bot-router.ts tests/unit/presentation/ticket-pagination.test.ts tests/unit/telegram/updates.test.ts tests/integration/telegram-flows.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: add ticket page callbacks"
```

---

## Task 7: Переделать Telegram flows поиска, настроек и profile

**Files:**
- Modify: `src/application/bot-router.ts`
- Modify: `src/presentation/keyboards.ts`
- Modify: `src/presentation/ticket-presenter.ts`
- Modify: `src/presentation/subscription-presenter.ts`
- Modify: `src/infrastructure/telegram/api-client.ts`
- Modify: `tests/integration/telegram-flows.test.ts`
- Modify: `tests/unit/telegram/api-client.test.ts`

- [ ] **Step 1: написать падающие integration tests ticket search**

Проверить три сценария:

1. `🔥 Горящие билеты` и `/tickets` создают session `ticket_search/destination`, отвечают `Вылет из Ташкента (TAS). Куда летим?` и показывают `🌍 Все направления из Ташкента`.
2. Ввод `Стамбул` и `/tickets IST` открывают первую страницу только `IST`.
3. Неизвестное имя отвечает `Город не найден. Введите название или IATA-код, например Стамбул или IST.`; ambiguous ответ перечисляет короткий набор читаемых вариантов и просит точный IATA.

- [ ] **Step 2: написать падающие integration tests settings/profile**

Проверить flow:

```text
/settings -> Класс перелёта: Эконом или Бизнес?
Бизнес   -> Багаж: Не важно или Только с багажом?
Только с багажом -> Настройки обновлены.
```

Проверить, что ни один шаг не спрашивает origin/currency, а `/profile` содержит:

```text
Город вылета: Ташкент (TAS)
Валюта: UZS
Класс: Бизнес
Багаж: Только с багажом
```

- [ ] **Step 3: написать падающие presenter/notifier tests**

Ticket card, subscription card и notification должны содержать `Ташкент (TAS) → Стамбул (IST)`, класс и понятный текст багажа. Неизвестный код должен выводиться как raw uppercase, не приводить к ошибке.

- [ ] **Step 4: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/integration/telegram-flows.test.ts tests/unit/telegram/api-client.test.ts`

Expected: FAIL — flows спрашивают origin/currency и presenters показывают коды.

- [ ] **Step 5: реализовать ticket search session**

Добавить обработку `ticket_search` в `handleSessionInput`. И menu, и `/tickets` без аргумента вызывают:

```ts
await sessions.start(user.id, 'ticket_search', 'destination');
await gateway.sendMessage({
  chatId,
  text: `Вылет из ${formatLocationLabel(DEFAULT_ORIGIN_CODE)}. Куда летим?`,
  replyMarkup: allDestinationsKeyboard({
    tripClass: user.preferredTripClass,
    baggageRequired: user.baggageRequired
  })
});
```

`/tickets <value>` и session input используют один private helper `resolveDestinationOrReply`. При `resolved` session отменяется и открывается offset 0; при `not_found/ambiguous` session остаётся активной.

После карточек `sendTicketPage` отправляет отдельное сообщение `Показано N–M` с navigation keyboard. Для пустой первой страницы — `Подходящие билеты не найдены.`; для пустой callback-страницы — callback error и без ложного диапазона.

- [ ] **Step 6: реализовать settings и profile**

Settings steps: `trip_class` затем `baggage`. Допустимые labels строго `Эконом`, `Бизнес`, `Не важно`, `Только с багажом`; invalid input повторяет текущую подсказку. Сохранять оба значения только на последнем шаге через `updateTicketPreferences`.

Profile всегда использует `DEFAULT_ORIGIN_CODE`, `DEFAULT_CURRENCY_CODE`, а не legacy user fields.

- [ ] **Step 7: обновить все presenters**

Во всех пользовательских route labels вызывать `formatLocationLabel`. Добавить helpers `presentTripClass` и `presentBaggage` в `travel-preferences.ts`, чтобы Telegram router, ticket presenter и notifier использовали одинаковый русский текст.

- [ ] **Step 8: выполнить проверки и создать коммит**

Run: `rtk npm test -- tests/integration/telegram-flows.test.ts tests/unit/telegram/api-client.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

```bash
rtk git add src/application/bot-router.ts src/presentation/keyboards.ts src/presentation/ticket-presenter.ts src/presentation/subscription-presenter.ts src/infrastructure/telegram/api-client.ts src/domain/travel-preferences.ts tests/integration/telegram-flows.test.ts tests/unit/telegram/api-client.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: add destination-first Telegram catalog"
```

---

## Task 8: Упростить подписки и применять текущие настройки к уведомлениям

**Files:**
- Modify: `src/application/bot-router.ts`
- Modify: `src/application/subscriptions.ts`
- Modify: `src/application/sync-tickets.ts`
- Modify: `src/domain/subscription.ts`
- Modify: `tests/unit/domain/subscription.test.ts`
- Modify: `tests/integration/telegram-flows.test.ts`
- Modify: `tests/integration/sync-hot-tickets.test.ts`

- [ ] **Step 1: написать падающий subscription flow test**

`/new_subscription` должен начинаться с шага `destination`, принимать `Стамбул`, IATA или `ANY`, затем спрашивать существующие date/max-price/direct criteria. Созданная запись всегда имеет `originCode='TAS'`, `currencyCode='UZS'`, `baggageRequired=false`. В transcript не должно быть вопросов origin/currency/baggage.

- [ ] **Step 2: написать падающие notification tests**

Для одной активной подписки проверить:

- user `economy/false` получает economy ticket с любым baggage;
- user `business/false` не получает economy ticket;
- user `business/true` получает только business ticket с baggage;
- изменение настроек существующего пользователя влияет на ту же подписку без её пересоздания;
- неподходящий билет не создаёт notification history row.

- [ ] **Step 3: подтвердить ожидаемое падение**

Run: `rtk npm test -- tests/integration/telegram-flows.test.ts tests/integration/sync-hot-tickets.test.ts tests/unit/domain/subscription.test.ts`

Expected: FAIL — flow начинается с origin, а sync учитывает только поля subscription.

- [ ] **Step 4: изменить создание подписки**

Удалить steps `origin`, `currency`, `baggage` из router. В `SubscriptionService.createForTelegramUser` не принимать origin/currency от caller и собирать domain input так:

```ts
{
  userId: user.id,
  originCode: DEFAULT_ORIGIN_CODE,
  currencyCode: DEFAULT_CURRENCY_CODE,
  destinationCode: input.destinationCode,
  departureDateFrom: input.departureDateFrom,
  departureDateTo: input.departureDateTo,
  maxPrice: input.maxPrice,
  directOnly: input.directOnly,
  baggageRequired: false
}
```

Destination resolver должен быть общим с ticket search и не дублировать правила русского справочника.

- [ ] **Step 5: добавить динамический notification guard**

В `SyncTicketsService` после `findMatching(ticket)` и загрузки владельца, но до dedup/send:

```ts
if (!matchesUserTicketPreferences(stored, user)) continue;
```

`matchesSubscription` больше не использует legacy `subscription.baggageRequired`; остальные destination/date/price/direct критерии сохраняются.

- [ ] **Step 6: выполнить проверки и создать коммит**

Run: `rtk npm test -- tests/unit/domain/subscription.test.ts tests/integration/telegram-flows.test.ts tests/integration/sync-hot-tickets.test.ts`

Run: `rtk npm run typecheck`

Expected: PASS.

```bash
rtk git add src/application/bot-router.ts src/application/subscriptions.ts src/application/sync-tickets.ts src/domain/subscription.ts tests/unit/domain/subscription.test.ts tests/integration/telegram-flows.test.ts tests/integration/sync-hot-tickets.test.ts
rtk git diff --cached --check
rtk git commit -m "feat: apply user filters to notifications"
```

---

## Task 9: Зафиксировать production-поведение и выполнить сквозную проверку

**Files:**
- Modify: `README.md`
- Modify: `tests/contract/vds-deploy.test.ts` only if README assertions require updates

- [ ] **Step 1: выполнить сквозной integration audit**

Убедиться, что tests, добавленные в Tasks 5–8, совместно покрывают один цельный сценарий:

1. поднять SQLite с migrations;
2. создать пользователя и настройки `business/true`;
3. выполнить sync fixture, содержащего economy и business offers нескольких направлений;
4. подтвердить единственный source `TAS/UZS` и exact Explore URL из Task 3;
5. открыть `ALL`, затем следующие страницы и получить все подходящие business-with-baggage tickets без дубликатов;
6. открыть конкретное направление русским названием;
7. подтвердить, что уведомление отправлено только для подходящего класса/багажа.

Если какого-либо звена нет, сначала добавить его в соответствующий integration test и подтвердить падение именно из-за отсутствующего production wiring, затем внести минимальное исправление в файл задачи-владельца.

- [ ] **Step 2: запустить интеграционные сценарии после всех feature-задач**

Run: `rtk npm test -- tests/integration/sync-hot-tickets.test.ts tests/integration/telegram-flows.test.ts`

Expected: PASS; это regression gate, а не новый независимый production behavior.

- [ ] **Step 3: обновить README**

Описать:

- фиксированный вылет из `Ташкент (TAS)` и валюту `UZS`;
- `/tickets`, `/tickets IST`, поиск `Стамбул`, кнопку всех направлений и pagination;
- `/settings` только для class/baggage;
- общий cron sync с двумя Explore parameters;
- применение миграции автоматически при `start`/`sync`;
- production rollout: `git pull`, `npm ci`, `npm run build`, ручной `npm run sync`, `sudo systemctl restart hot-ticket-bot`, проверка logs.

Не менять systemd/cron units и не возвращать внешний cron/webhook.

- [ ] **Step 4: выполнить focused проверки**

Run: `rtk npm test -- tests/unit/domain/locations.test.ts tests/unit/aviasales/url.test.ts tests/unit/aviasales/mapper.test.ts tests/unit/application/tickets.test.ts tests/unit/presentation/ticket-pagination.test.ts tests/integration/sqlite-migrations.test.ts tests/integration/sqlite-repositories.test.ts tests/integration/sync-hot-tickets.test.ts tests/integration/telegram-flows.test.ts`

Expected: PASS.

- [ ] **Step 5: выполнить полную verification gate**

Run: `rtk npm run verify`

Expected: ESLint, strict TypeScript, весь Vitest suite и production build проходят с exit code 0.

- [ ] **Step 6: проверить migration и рабочее дерево**

Run: `rtk git status --short`

Run: `rtk git diff --check`

Expected: нет новых неожиданных изменений; исходные пользовательские `.codex/`, `.idea/`, `generated/`, `scripts/`, `package*.json` могут оставаться dirty и не должны попасть в коммит.

- [ ] **Step 7: создать финальный коммит документации/сквозных тестов**

```bash
rtk git add README.md
rtk git diff --cached --check
rtk git commit -m "docs: describe fixed Tashkent catalog"
```

Если README contract test пришлось изменить, добавить только `tests/contract/vds-deploy.test.ts` отдельной явной командой перед commit.

---

## Definition of Done

- Explore URL содержит ровно `origin=TAS&currency=uzs`.
- В database enabled только source `TAS/UZS`; legacy users/subscriptions мигрированы.
- В ticket rows сохраняются `economy/business` и baggage.
- Поиск принимает точный IATA и русское название, а неизвестное/неоднозначное значение обрабатывается безопасно.
- Все пользовательские маршруты отображаются читаемо: `Ташкент (TAS) → …`.
- Нет default 5; страницы по 10 позволяют просмотреть весь подходящий каталог.
- Настройки содержат только class и baggage, а profile явно показывает фиксированные origin/currency.
- Подписки не спрашивают origin/currency и динамически используют текущие user filters.
- `rtk npm run verify` проходит полностью.
- В коммиты не попали секреты, IDE/Codex metadata и несвязанные пользовательские изменения.
