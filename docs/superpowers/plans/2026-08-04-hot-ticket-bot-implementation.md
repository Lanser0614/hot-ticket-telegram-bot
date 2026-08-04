# План реализации Telegram-бота горячих авиабилетов

> **Для агентных исполнителей:** ОБЯЗАТЕЛЬНЫЙ ДОПОЛНИТЕЛЬНЫЙ НАВЫК: использовать `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans` и выполнять задачи по очереди. Для отслеживания шагов используются флажки `- [ ]`.

**Цель:** создать проверяемый MVP Telegram Serverless-бота для импорта горячих билетов Aviasales, просмотра предложений, подписок и дедуплицированных уведомлений.

**Архитектура:** бизнес-логика пишется на strict TypeScript и не зависит от Telegram SDK. Тонкие адаптеры связывают порты приложения со встроенными `sdk/db`, `sdk/fetch` и `sdk/api`, а esbuild создаёт допустимые JavaScript-модули в `telegram-dist`. Синхронизация оформляется отдельным use case; публичный cron-trigger добавляется после выбора поддерживаемого HTTP-механизма.

**Стек:** TypeScript, Vitest, ESLint, esbuild, Telegram Serverless SDK, встроенная SQLite-база, Aviasales Hot Offers API.

## Общие ограничения

- TypeScript работает с `strict: true`, `noUncheckedIndexedAccess: true` и без `any`.
- Внешний JSON принимается только как `unknown` и проверяется type guards.
- В production runtime разрешены импорты только из `sdk`, `sdk/db`, `sdk/api`, `sdk/fetch`, `schema` и собственных Telegram-модулей.
- Telegram Serverless получает только `schema.js`, `handlers/*.js` и `lib/**/*.js`.
- Origin и destination соответствуют `^[A-Z0-9]{3}$`, currency — `^[A-Z]{3}$` после нормализации регистра.
- Система не преобразует IATA-коды в названия городов и стран.
- HTTP timeout Aviasales равен 10 секундам, максимум попыток — 3.
- Retry выполняется только для сетевой ошибки, timeout и HTTP `429`, `500`, `502`, `503`, `504`.
- Билет становится неактивным через 6 часов отсутствия, сессия истекает через 30 минут, sync-lock — через 5 минут.
- У пользователя может быть не более 20 активных подписок.
- История уведомлений создаётся только после успешной отправки Telegram-сообщения.
- Первоначальный источник синхронизации — `TAS` и `UZS`.
- Базовый URL Aviasales читается из единственной настройки `AVIASALES_EXPLORE_BASE_URL`.
- Ошибка одной активной пары sync source не останавливает обработку остальных пар.
- Sync endpoint не принимает origin, currency или произвольный внешний URL из HTTP-запроса.

---

## Карта файлов

```text
package.json                              команды разработки и проверки
tsconfig.json                             строгая проверка TypeScript
eslint.config.js                          правила ESLint без any
vitest.config.ts                          конфигурация unit/integration тестов
scripts/build-telegram.mjs                сборка и проверка deploy-модулей
src/config.ts                             единая конфигурация приложения
src/domain/errors.ts                      типизированные ошибки
src/domain/codes.ts                       origin/destination/currency
src/domain/ticket.ts                      модель билета и идентичность
src/domain/subscription.ts                модель и matching подписок
src/domain/dates.ts                       календарные даты и диапазоны
src/domain/money.ts                       проверка целой цены
src/application/ports.ts                  внешние порты приложения
src/application/sync-tickets.ts           синхронизация одной пары origin/currency
src/application/sync-hot-tickets-job.ts   обход всех активных sync_sources
src/application/users.ts                  регистрация и контакт
src/application/tickets.ts                запрос списка билетов
src/application/subscriptions.ts          создание и управление подписками
src/infrastructure/aviasales/url.ts        URL Hot Offers
src/infrastructure/aviasales/mapper.ts     unknown response -> Ticket[]
src/infrastructure/aviasales/client.ts     timeout и retry
src/infrastructure/memory/store.ts         in-memory адаптер для тестов
src/platform/telegram/repositories.ts      адаптер встроенной БД
src/platform/telegram/notifier.ts          адаптер Bot API
src/platform/telegram/http.ts              адаптер sdk/fetch
src/handlers/message.ts                    message update entry point
src/handlers/callback_query.ts             callback update entry point
src/entries/sync-hot-tickets.ts            callable sync-модуль без HTTP
src/http/sync-endpoint.ts                  защищённый endpoint-контракт
schema.ts                                  Telegram SQLite schema DSL
tests/fixtures/aviasales-hot-offers.json   реальный ответ TAS/UZS
tests/unit/                                чистые unit-тесты
tests/integration/                         сценарные тесты
telegram-dist/                             генерируемый deploy-результат
README.md                                  настройка, тестирование и deploy
```

## Задача 1: Каркас TypeScript и воспроизводимая Telegram-сборка

**Файлы:**

- создать `.gitignore`;
- создать `package.json`;
- создать `tsconfig.json`;
- создать `eslint.config.js`;
- создать `vitest.config.ts`;
- создать `scripts/build-policy.js`;
- создать `scripts/build-telegram.mjs`;
- создать `tests/build/build-telegram.test.ts`.

**Интерфейсы:**

- производит команды `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` и `npm run verify`;
- производит `telegram-dist/schema.js`, `telegram-dist/handlers/message.js`, `telegram-dist/handlers/callback_query.js`, `telegram-dist/lib/sync-hot-tickets.js`;
- проверяет список разрешённых runtime-импортов.

- [ ] **Шаг 1: создать минимальные package scripts и строгий TypeScript**

`package.json` должен содержать:

```json
{
  "name": "hot-ticket-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build-telegram.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

Установить локальные dev-зависимости с фиксацией точных версий в `package-lock.json`:

```bash
npm install --save-dev typescript vitest eslint @eslint/js typescript-eslint esbuild @types/node @tgcloud/cli
```

`tsconfig.json` включает `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `allowJs`, `checkJs`, `noEmit`, `ES2022` и `Bundler` module resolution.

- [ ] **Шаг 2: написать падающий тест ограничений deploy-структуры**

```ts
import { describe, expect, it } from 'vitest';
import { validateDeployPath } from '../../scripts/build-policy.js';

describe('validateDeployPath', () => {
  it.each([
    'schema.js',
    'handlers/message.js',
    'handlers/callback_query.js',
    'lib/sync-hot-tickets.js',
  ])('принимает %s', (path) => {
    expect(validateDeployPath(path)).toBe(true);
  });

  it.each(['package.json', 'handlers/nested/message.js', 'lib/file.ts'])('отклоняет %s', (path) => {
    expect(validateDeployPath(path)).toBe(false);
  });
});
```

- [ ] **Шаг 3: выполнить тест и подтвердить ожидаемое падение**

Команда: `npm test -- tests/build/build-telegram.test.ts`.

Ожидаемый результат: FAIL, потому что `scripts/build-policy.js` ещё отсутствует.

- [ ] **Шаг 4: реализовать policy и esbuild-сборку**

`scripts/build-policy.js` экспортирует чистые функции:

```js
export function validateDeployPath(path) {
  return path === 'schema.js'
    || /^handlers\/[^/]+\.js$/.test(path)
    || /^lib\/.+\.js$/.test(path);
}

export function isAllowedRuntimeImport(value) {
  return value === 'sdk'
    || value === 'schema'
    || value.startsWith('sdk/')
    || value.startsWith('lib/')
    || value.startsWith('handlers/');
}
```

`scripts/build-telegram.mjs` удаляет только управляемые пути `telegram-dist/schema.js`, `telegram-dist/handlers` и `telegram-dist/lib`, сохраняя `telegram-dist/.tgcloud`. Затем он собирает четыре entry point через esbuild с `bundle: true`, `format: 'esm'`, `platform: 'neutral'`, `target: 'es2022'`, отмечает `sdk`, `sdk/*` и `schema` как external и проверяет пути и оставшиеся import statements.

- [ ] **Шаг 5: создать временные минимальные entry points для проверки сборки**

Минимальные файлы экспортируют функции, которые бросают `Error('Модуль ещё не подключён')`. Они нужны только до задач 7–8 и заменяются реальными обработчиками.

- [ ] **Шаг 6: выполнить проверки задачи**

Команды:

```bash
npm run typecheck
npm test -- tests/build/build-telegram.test.ts
npm run build
```

Ожидаемый результат: все команды завершаются с кодом 0, а `telegram-dist` содержит только четыре разрешённых `.js`-модуля.

- [ ] **Шаг 7: создать коммит**

```bash
git add .gitignore package.json package-lock.json tsconfig.json eslint.config.js vitest.config.ts scripts tests/build src/handlers src/entries schema.ts
git commit -m "build: scaffold strict Telegram Serverless project"
```

## Задача 2: Доменные значения и стабильная идентичность билета

**Файлы:**

- создать `src/domain/errors.ts`;
- создать `src/domain/codes.ts`;
- создать `src/domain/dates.ts`;
- создать `src/domain/money.ts`;
- создать `src/domain/sha256.ts`;
- создать `src/domain/ticket.ts`;
- создать `tests/unit/domain/codes.test.ts`;
- создать `tests/unit/domain/ticket.test.ts`;
- создать `tests/unit/domain/dates-money.test.ts`.

**Интерфейсы:**

- производит `normalizeIataCode(value: string): string`;
- производит `normalizeCurrencyCode(value: string): string`;
- производит `normalizeTicketLink(value: string): string`;
- производит `extractTicketSearchCode(value: string): string`;
- производит `createExternalKey(input: ExternalKeyInput): string`;
- производит интерфейс `Ticket` из ТЗ.

- [ ] **Шаг 1: написать тесты кодов, дат и цены**

Проверить принятие `tas -> TAS`, `uzs -> UZS`, `A1A`, календарной даты `2026-08-15` и цены `2395739`. Проверить отказ для пустой строки, двух/четырёхсимвольного кода, отрицательной цены, дробной цены, небезопасного integer и невозможной даты `2026-02-30`.

```ts
expect(normalizeIataCode(' tas ')).toBe('TAS');
expect(normalizeCurrencyCode('uzs')).toBe('UZS');
expect(() => assertMoney(-1)).toThrow(ValidationError);
expect(() => assertIsoDate('2026-02-30')).toThrow(ValidationError);
```

- [ ] **Шаг 2: выполнить тесты и подтвердить падение из-за отсутствующих модулей**

Команда: `npm test -- tests/unit/domain/codes.test.ts tests/unit/domain/dates-money.test.ts`.

- [ ] **Шаг 3: реализовать ошибки и value validators**

```ts
export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

export function normalizeIataCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(normalized)) {
    throw new ValidationError('Некорректный IATA-код');
  }
  return normalized;
}
```

Currency использует отдельный regex `^[A-Z]{3}$`. Цена проверяется через `Number.isSafeInteger(value) && value >= 0`. ISO-дата проверяется regex и обратным сравнением UTC-компонентов созданного `Date`.

- [ ] **Шаг 4: написать тесты реальных форм ссылок Aviasales**

```ts
expect(normalizeTicketLink('/TAS1508IST1?t=token&search_id=1'))
  .toBe('https://www.aviasales.uz/search/TAS1508IST1');
expect(normalizeTicketLink('https://www.aviasales.uz/search/TAS1308IKU1?marker=123'))
  .toBe('https://www.aviasales.uz/search/TAS1308IKU1');
expect(extractTicketSearchCode('https://www.aviasales.uz/search/TAS1308IKU1'))
  .toBe('TAS1308IKU1');
```

Также проверить, что одинаковые входные поля дают одинаковый SHA-256, изменение цены не меняет ключ, а изменение destination меняет ключ. Проверить SHA-256 на публичном векторе `abc -> ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.

- [ ] **Шаг 5: реализовать нормализацию ссылки и SHA-256 без Node API**

`normalizeTicketLink` принимает полный URL или относительный `ticket_link` реального API, извлекает первый сегмент без query string и строит `https://www.aviasales.uz/search/<code>`. `sha256.ts` реализует детерминированный SHA-256 над UTF-8 с `Uint8Array`, чтобы работать в V8 без `node:crypto`.

`createExternalKey` объединяет нормализованные значения через `|`:

```ts
return sha256([
  input.originCode,
  input.destinationCode,
  input.departureDate,
  input.ticketSearchCode,
  input.currencyCode,
].join('|'));
```

- [ ] **Шаг 6: выполнить доменные тесты и проверки типов**

Команды: `npm test -- tests/unit/domain` и `npm run typecheck`.

Ожидаемый результат: PASS без импортов Node runtime.

- [ ] **Шаг 7: создать коммит**

```bash
git add src/domain tests/unit/domain
git commit -m "feat: add ticket domain validation and identity"
```

## Задача 3: Подписки, matching и уведомительные события

**Файлы:**

- создать `src/domain/subscription.ts`;
- создать `src/domain/ticket-events.ts`;
- создать `tests/unit/domain/subscription.test.ts`;
- создать `tests/unit/domain/ticket-events.test.ts`.

**Интерфейсы:**

- потребляет `Ticket`, `assertIsoDate` и code validators;
- производит `Subscription`;
- производит `matchesSubscription(ticket, subscription): boolean`;
- производит `detectTicketEvent(previous, current): 'new_ticket' | 'price_drop' | null`;
- производит `notificationKey(input): string`.

- [ ] **Шаг 1: написать табличные тесты matching**

Тестовая матрица отдельно проверяет origin, currency, nullable destination, включённый диапазон дат, nullable max price, direct-only, baggage-required и `isActive: false`.

```ts
expect(matchesSubscription(ticket, baseSubscription)).toBe(true);
expect(matchesSubscription(ticket, { ...baseSubscription, destinationCode: 'DXB' })).toBe(false);
expect(matchesSubscription(ticket, { ...baseSubscription, maxPrice: ticket.price - 1 })).toBe(false);
```

- [ ] **Шаг 2: выполнить тест и подтвердить ожидаемое падение**

Команда: `npm test -- tests/unit/domain/subscription.test.ts`.

- [ ] **Шаг 3: реализовать matching одной чистой функцией**

```ts
export function matchesSubscription(ticket: Ticket, subscription: Subscription): boolean {
  return subscription.isActive
    && ticket.isActive
    && ticket.originCode === subscription.originCode
    && ticket.currencyCode === subscription.currencyCode
    && (subscription.destinationCode === null || ticket.destinationCode === subscription.destinationCode)
    && ticket.departureDate >= subscription.departureDateFrom
    && ticket.departureDate <= subscription.departureDateTo
    && (subscription.maxPrice === null || ticket.price <= subscription.maxPrice)
    && (!subscription.directOnly || ticket.isDirect)
    && (!subscription.baggageRequired || ticket.hasBaggage);
}
```

- [ ] **Шаг 4: написать тесты событий и ключа дедупликации**

Проверить новый билет, снижение цены, повышение цены, неизменную цену и комбинацию `userId|subscriptionId|ticketId|notifiedPrice`.

- [ ] **Шаг 5: реализовать события**

```ts
export function detectTicketEvent(previous: Ticket | null, current: Ticket): TicketEventType | null {
  if (previous === null) return 'new_ticket';
  return current.price < previous.price ? 'price_drop' : null;
}
```

- [ ] **Шаг 6: выполнить тесты и создать коммит**

Команды: `npm test -- tests/unit/domain` и `npm run typecheck`.

```bash
git add src/domain tests/unit/domain
git commit -m "feat: add subscription matching and ticket events"
```

## Задача 4: Схема Telegram SQLite и порты приложения

**Файлы:**

- заменить временный `schema.ts`;
- создать `src/types/telegram-sdk.d.ts`;
- создать `src/application/ports.ts`;
- создать `src/application/models.ts`;
- создать `tests/unit/schema-contract.test.ts`.

**Интерфейсы:**

- производит named exports `users`, `tickets`, `ticketPriceHistory`, `subscriptions`, `notificationHistory`, `userSessions`, `syncSources`, `syncRuns`, `syncLocks`;
- производит порты `UserRepository`, `TicketRepository`, `PriceHistoryRepository`, `SubscriptionRepository`, `SessionRepository`, `NotificationHistoryRepository`, `SyncSourceRepository`, `SyncRunRepository`, `LockRepository`, `HotTicketsProvider`, `TicketNotifier`, `TelegramGateway`, `Clock`, `Logger`.

- [ ] **Шаг 1: написать контрактный тест обязательных таблиц и индексов**

Тест импортирует schema через локальный mock DSL и проверяет имена таблиц, unique constraints и индексы, перечисленные в ТЗ. Отдельно проверяется unique для `notification_history(user_id, subscription_id, ticket_id, notified_price)` и `sync_locks.key`.

- [ ] **Шаг 2: выполнить тест и подтвердить падение временной схемы**

Команда: `npm test -- tests/unit/schema-contract.test.ts`.

- [ ] **Шаг 3: объявить TypeScript-типы минимальной поверхности SDK**

Declaration module описывает только реально используемые `table`, `integer`, `text`, `boolean`, `json`, `index`, `unique`, `sql`, `db`, `api` и `fetch`. Возвраты запросов остаются типизированными и асинхронными; `any` не используется.

- [ ] **Шаг 4: реализовать полную `schema.ts`**

Использовать колонки и индексы из ТЗ. Добавить `sync_sources` и `sync_locks`:

```ts
export const syncLocks = table('sync_locks', {
  key: text('key').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

Все отношения задаются обычными integer-колонками без `.references()`.

- [ ] **Шаг 5: определить точные application ports**

Ключевые сигнатуры:

```ts
export interface TicketRepository {
  findByExternalKey(externalKey: string): Promise<StoredTicket | null>;
  upsert(ticket: Ticket, observedAt: Date): Promise<{ stored: StoredTicket; previous: StoredTicket | null }>;
  deactivateUnseenBefore(source: SyncSource, threshold: Date): Promise<number>;
  listActive(query: TicketQuery): Promise<readonly StoredTicket[]>;
}

export interface PriceHistoryRepository {
  add(ticketId: number, price: number, observedAt: Date): Promise<void>;
}

export interface SyncSourceRepository {
  findEnabled(): Promise<readonly SyncSource[]>;
}

export interface LockRepository {
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface TicketNotifier {
  send(input: NotificationInput): Promise<{ telegramMessageId: number }>;
}

export interface TelegramGateway {
  sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }>;
  answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void>;
}
```

- [ ] **Шаг 6: выполнить schema, typecheck и build проверки**

Команды: `npm test -- tests/unit/schema-contract.test.ts`, `npm run typecheck`, `npm run build`.

- [ ] **Шаг 7: создать коммит**

```bash
git add schema.ts src/types src/application tests/unit/schema-contract.test.ts
git commit -m "feat: define Telegram database schema and application ports"
```

## Задача 5: Реальный fixture, Aviasales mapper и retry-клиент

**Файлы:**

- создать `tests/fixtures/aviasales-hot-offers.json`;
- создать `src/infrastructure/aviasales/url.ts`;
- создать `src/infrastructure/aviasales/guards.ts`;
- создать `src/infrastructure/aviasales/mapper.ts`;
- создать `src/infrastructure/aviasales/client.ts`;
- создать `src/config.ts`;
- создать `tests/unit/aviasales/url.test.ts`;
- создать `tests/unit/aviasales/mapper.test.ts`;
- создать `tests/unit/aviasales/client.test.ts`.

**Интерфейсы:**

- потребляет `Ticket`, code validators, link normalization и `Logger`;
- производит `createHotOffersUrl(input): URL`;
- производит `mapHotOffersResponse(value: unknown, logger: Logger): Ticket[]`;
- производит `AviasalesClient.getHotOffers(input): Promise<unknown>` как единственную точку фактического HTTP-вызова;
- производит `AviasalesHotTicketsProvider`.
- производит `loadConfig(input): AppConfig` с единственным базовым URL Explore API.

- [ ] **Шаг 1: сохранить фактический API response как fixture**

Выполнить GET с `origin=TAS` и `currency=uzs` и всеми параметрами по умолчанию из ТЗ. Сохранить ответ без редактирования. Проверить, что верхний уровень содержит `origin`, `directions`, `entities_info`, а первый offer имеет `destination_iata`, `ticket.price.value`, `ticket.price.depart_date`, `ticket.price.currency`, `ticket.price.number_of_changes`, `ticket.price.with_baggage`, `ticket.price.airline` и относительный `ticket.price.ticket_link`.

- [ ] **Шаг 2: написать тест точного URL**

Тест сравнивает origin, currency и все 12 дополнительных query params из ТЗ. Пустой origin и currency должны бросать `ValidationError` до вызова HTTP.

Отдельный тест передаёт `aviasalesExploreBaseUrl: 'https://example.test'` и проверяет путь `/v1/hot_offers/list.json`, подтверждая отсутствие захардкоженного production host в URL builder.

- [ ] **Шаг 3: реализовать URL builder и запустить тест**

`currency` отправляется в нижнем регистре, `origin` — в верхнем. `src/config.ts` проверяет `AVIASALES_EXPLORE_BASE_URL` как HTTPS URL и выдаёт `https://explore-api.aviasales.com` только для явно созданной Telegram production-конфигурации. Команда: `npm test -- tests/unit/aviasales/url.test.ts`.

- [ ] **Шаг 4: написать mapper-тест по реальному fixture**

Проверить, что число корректных `Ticket` не превышает `directions.length`, первая запись получает origin из `price.origin`, destination из `direction.destination_iata`, price из `price.value`, direct из `number_of_changes === 0`, baggage из `with_baggage`, airlineCode из `airline`, а rawPayload равен исходному direction.

Добавить смешанный ответ из одной корректной и одной сломанной direction. Результат содержит один билет, logger получает одну ошибку.

- [ ] **Шаг 5: реализовать guards и mapper**

Guards используют `Record<string, unknown>` после проверки `typeof value === 'object' && value !== null`. Mapper не читает `entities_info.cities/countries`. Поле `airlineName` остаётся `null`; `departureAt` строится как локальная строка ISO без добавления выдуманного timezone.

- [ ] **Шаг 6: написать тесты retry-классификации и попыток**

Fake HTTP последовательно возвращает `503`, затем `200`; ожидаются две попытки. Для `400` ожидается одна попытка. Для invalid JSON и invalid structure ожидается одна попытка. Timeout и network error повторяются до трёх раз.

- [ ] **Шаг 7: реализовать клиент с инъекцией HTTP и Sleeper**

```ts
export interface TextHttpClient {
  get(url: URL, timeoutMs: number): Promise<{ status: number; body: string }>;
}

export interface Sleeper {
  sleep(milliseconds: number): Promise<void>;
}
```

Задержки между retry равны 250 и 500 миллисекундам. `AviasalesClient` всегда отправляет `GET` и `Accept: application/json`, а после успешного HTTP возвращает распарсенный `unknown`. Invalid JSON и structural mapping не попадают в retry-loop. `AviasalesHotTicketsProvider` вызывает client, затем mapper.

- [ ] **Шаг 8: выполнить тесты и создать коммит**

Команды: `npm test -- tests/unit/aviasales`, `npm run typecheck`.

```bash
git add src/infrastructure/aviasales tests/fixtures tests/unit/aviasales
git commit -m "feat: integrate Aviasales hot offers API"
```

## Задача 6: In-memory persistence, SyncTicketsService и SyncHotTicketsJob

**Файлы:**

- создать `src/infrastructure/memory/store.ts`;
- создать `src/application/sync-tickets.ts`;
- создать `src/application/sync-hot-tickets-job.ts`;
- создать `tests/integration/sync-hot-tickets.test.ts`.

**Интерфейсы:**

- потребляет все порты задачи 4 и события задачи 3;
- производит `SyncTicketsService.execute(input): Promise<SyncResult>` для одной пары;
- производит `SyncHotTicketsJob.execute(): Promise<{ processedSources: number }>` для всех активных пар;
- производит in-memory реализации портов для сценарных тестов.

- [ ] **Шаг 1: написать интеграционный тест первого sync**

Fake provider возвращает один билет, активная подписка совпадает. Проверить `fetched=1`, `inserted=1`, `updated=0`, отсутствие price history для первоначальной цены, одну отправку `new_ticket`, одну запись notification history и успешный sync run.

- [ ] **Шаг 2: выполнить тест и подтвердить падение**

Команда: `npm test -- tests/integration/sync-hot-tickets.test.ts`.

- [ ] **Шаг 3: реализовать минимальный orchestration и in-memory store**

`SyncTicketsService` получает через constructor provider, ticket repository, price history repository, subscription repository, notification history repository, notifier, lock repository, sync run repository, clock и logger. Он обрабатывает одну валидированную пару. Lock всегда освобождается в `finally`. История уведомления записывается строго после `notifier.send`.

- [ ] **Шаг 4: добавить сценарии повторного sync и изменения цены**

Повторный идентичный sync не создаёт второй билет, историю цены или уведомление. Снижение цены обновляет билет, добавляет price history и отправляет `price_drop` с новой ценой. Повышение цены добавляет price history, но уведомление не отправляет.

- [ ] **Шаг 5: добавить сценарии ошибок и конкуренции**

Покрыть активный lock (`skipped` без HTTP), исключение provider (`failed` и освобождённый lock), ошибку Telegram send (notification history отсутствует), неактивную подписку и деактивацию билета старше шести часов. Добавить два sync source: первая пара падает, вторая успешно обрабатывается; logger получает `ticket_sync_source_failed`, job возвращает `processedSources: 1`.

- [ ] **Шаг 6: реализовать полное поведение до прохождения сценариев**

`SyncResult` содержит `status`, `origin`, `currency`, `fetched`, `inserted`, `updated`, `notificationsSent`. Счётчики обновляются после подтверждённых операций репозиториев. При ошибке service завершает `sync_runs` статусом `failed`, затем повторно бросает ошибку. `SyncHotTicketsJob` вызывает `syncSourceRepository.findEnabled()`, оборачивает каждую пару в отдельный `try/catch`, логирует `ticket_sync_source_failed` и продолжает цикл после ошибки.

- [ ] **Шаг 7: выполнить полный набор проверок и создать коммит**

Команды: `npm test`, `npm run typecheck`, `npm run lint`.

```bash
git add src/application/sync-tickets.ts src/application/sync-hot-tickets-job.ts src/infrastructure/memory tests/integration/sync-hot-tickets.test.ts
git commit -m "feat: orchestrate idempotent ticket synchronization"
```

## Задача 7: Пользователи, билеты и подписки через Telegram flows

**Файлы:**

- создать `src/application/users.ts`;
- создать `src/application/tickets.ts`;
- создать `src/application/subscriptions.ts`;
- создать `src/application/sessions.ts`;
- создать `src/presentation/keyboards.ts`;
- создать `src/presentation/ticket-presenter.ts`;
- создать `src/presentation/subscription-presenter.ts`;
- заменить `src/handlers/message.ts`;
- заменить `src/handlers/callback_query.ts`;
- создать `tests/integration/telegram-flows.test.ts`.

**Интерфейсы:**

- потребляет repositories, clock, `TelegramGateway` и `TicketNotifier`;
- производит обработку `/start`, `/tickets`, `/subscriptions`, `/new_subscription`, `/settings`, `/profile`, `/help`;
- производит flow создания подписки и отключения собственной подписки.

- [ ] **Шаг 1: написать тест `/start` и контакта**

Первый `/start` создаёт пользователя, повторный обновляет профиль без дубликата. Контакт принимается только при равенстве `contact.user_id` и `from.id`; чужой контакт возвращает русское сообщение об ошибке и не меняет телефон.

- [ ] **Шаг 2: реализовать user use cases и главное меню**

Главное меню содержит пять кнопок из ТЗ. Telegram handler проверяет наличие `message.from` и `message.chat`, затем передаёт типизированный DTO в application use case.

- [ ] **Шаг 3: написать и реализовать listing билетов**

Запрос по умолчанию использует origin/currency пользователя, `is_active=true`, `departure_date>=today`, `price_asc`, `limit=5`. Presenter форматирует дату по-русски, цену с группировкой, direct/baggage и кнопку с нормализованной ссылкой.

Отдельные тесты проверяют сортировки `price_asc`, `departure_date_asc`, `recently_added` и фильтры `destination_code`, `departure_date_from`, `departure_date_to`, `max_price`, `direct_only`. Callback сохраняет фильтры в `user_sessions`, а repository получает полностью валидированный `TicketQuery`.

- [ ] **Шаг 4: написать тесты session state machine подписки**

Проверить шаги origin, nullable destination, две даты, nullable max price, direct-only и подтверждение. Проверить отмену, срок 30 минут, неверную дату, диапазон с `from > to` и лимит 20 подписок.

- [ ] **Шаг 5: реализовать subscription/session use cases**

Каждый переход загружает сессию по user ID, проверяет `flow` и `step`, валидирует вход, сохраняет JSON payload и обновляет expiry. На подтверждении создаётся подписка и сессия удаляется.

Settings flow отдельно принимает origin и currency, применяет соответствующие validators и обновляет пользователя. `/profile` показывает Telegram-профиль, текущие origin/currency и наличие телефона; `/help` перечисляет поддерживаемые команды.

- [ ] **Шаг 6: написать и реализовать callback ownership**

Отключение подписки получает subscription ID из callback data, повторно загружает подписку с user ID и изменяет только принадлежащую пользователю запись. Чужой ID возвращает `answerCallbackQuery` с отказом.

- [ ] **Шаг 7: выполнить flow-тесты и создать коммит**

Команды: `npm test -- tests/integration/telegram-flows.test.ts`, `npm run typecheck`, `npm run lint`.

```bash
git add src/application src/presentation src/handlers tests/integration/telegram-flows.test.ts
git commit -m "feat: add Telegram user ticket and subscription flows"
```

## Задача 8: Telegram Serverless database, HTTP и notification adapters

**Файлы:**

- создать `src/platform/telegram/repositories.ts`;
- создать `src/platform/telegram/http.ts`;
- создать `src/platform/telegram/notifier.ts`;
- создать `src/platform/telegram/logger.ts`;
- заменить `src/entries/sync-hot-tickets.ts`;
- создать `tests/contract/telegram-repositories.test.ts`;
- создать `tests/contract/telegram-adapters.test.ts`.

**Интерфейсы:**

- реализует все порты задачи 4 через Telegram SDK;
- производит callable default export `telegram-dist/lib/sync-hot-tickets.js`;
- не производит публичный HTTP endpoint.

- [ ] **Шаг 1: написать contract tests асинхронных DB-вызовов**

Mock SDK проверяет `await`, bound parameters, `onConflictDoUpdate`, уникальность notification history и atomic lock acquisition. Repository преобразует timestamp modes и JSON без `any`.

- [ ] **Шаг 2: реализовать Telegram repositories**

User upsert использует unique `telegram_user_id`. Ticket upsert сначала читает предыдущую запись, затем выполняет conflict update по `external_key`. Lock получается через insert-or-conditional-update в одной SQL-команде с условием `expires_at <= now`.

- [ ] **Шаг 3: написать и реализовать sdk/fetch adapter**

Adapter вызывает `fetch` из `sdk`, ограничивает ожидание 10 секундами через timeout race, читает текстовый body и возвращает `{status, body}`. Timeout преобразуется в отдельный `TimeoutError`, распознаваемый retry-клиентом.

- [ ] **Шаг 4: написать и реализовать notifier**

`new_ticket` и `price_drop` получают разные русские заголовки. `api.sendMessage` вызывается с `chat_id`, HTML-safe текстом и inline URL-кнопкой. Возвращённый `message_id` передаётся application layer.

- [ ] **Шаг 5: собрать production composition root**

`src/entries/sync-hot-tickets.ts` создаёт adapters, `SyncTicketsService`, `SyncHotTicketsJob` и экспортирует default async function без внешних origin/currency. Entry point всегда получает активные пары из `sync_sources`.

- [ ] **Шаг 6: выполнить contract и build проверки**

Команды: `npm test -- tests/contract`, `npm run typecheck`, `npm run build`.

Проверить, что итоговые imports используют только разрешённые bare names и `telegram-dist` не содержит `.ts`, source maps или `node:` imports.

- [ ] **Шаг 7: создать коммит**

```bash
git add src/platform src/entries tests/contract
git commit -m "feat: connect application to Telegram Serverless SDK"
```

## Задача 9: Полная проверка, документация и готовность к deploy

**Файлы:**

- создать `README.md`;
- создать `.env.example` только для локальных и будущих trigger-настроек;
- создать `src/http/sync-endpoint.ts`;
- создать `tests/unit/http/sync-endpoint.test.ts`;
- изменить `package.json`, добавив команды `cloud:login`, `cloud:status`, `cloud:diff`, `cloud:push`, `cloud:migrate` и `cloud:run-sync`, запускающие `../node_modules/.bin/tgcloud` из `telegram-dist`;
- проверить все созданные файлы.

**Интерфейсы:**

- производит инструкцию активации Serverless в BotFather;
- производит npm-команды для `tgcloud login`, `push`, `migrate`, `run`, `status`;
- производит защищённый транспортно-независимый контракт `POST /internal/jobs/sync-hot-tickets`;
- фиксирует, что публикация cron endpoint ожидает выбора поддерживаемого hosting-механизма.

- [ ] **Шаг 1: написать README с точной последовательностью разработки**

README описывает Node.js 18+, `npm install`, `npm run verify`, включение Serverless в BotFather, получение отдельного CLI token, `npm run cloud:login`, `npm run cloud:push`, отдельный `npm run cloud:migrate` и тестовый `npm run cloud:run-sync`. Все cloud-команды выполняются с рабочей директорией `telegram-dist`, а сборка никогда не удаляет `telegram-dist/.tgcloud`.

- [ ] **Шаг 2: документировать конфигурацию**

`.env.example` содержит `AVIASALES_EXPLORE_BASE_URL=https://explore-api.aviasales.com` и пустой `SYNC_SECRET`. Константы market/language/passport country, timezone, expiration, session TTL и lock TTL находятся в типизированном модуле. `TELEGRAM_BOT_TOKEN` не требуется.

- [ ] **Шаг 3: написать падающие тесты endpoint-контракта**

Проверить отказ для `GET`, отсутствующего/неверного bearer secret и успешный `POST`. Request body игнорируется и не может передать URL, origin или currency. Успешный ответ строго равен:

```json
{
  "status": "success",
  "processed_sources": 1
}
```

Ошибка job возвращает безопасный статус `500` без stack trace и ответа Aviasales.

- [ ] **Шаг 4: реализовать транспортно-независимый endpoint**

```ts
export interface SyncEndpointRequest {
  method: string;
  authorization: string | null;
}

export interface SyncEndpointResponse {
  statusCode: number;
  body: { status: 'success'; processed_sources: number } | { status: 'error' };
}
```

Factory получает `syncSecret` и `SyncHotTicketsJob`, выполняет constant-time сравнение bearer token, вызывает только `job.execute()` и не принимает произвольные параметры синхронизации.

- [ ] **Шаг 5: выполнить release gate**

Команда: `npm run verify`.

Ожидаемый результат: ESLint, TypeScript, все Vitest suites и Telegram build проходят с кодом 0.

- [ ] **Шаг 6: проверить рабочее дерево и deploy-манифест**

Команды:

```bash
git status --short
npm run cloud:status
npm run cloud:diff
```

`tgcloud`-команды выполняются после того, как пользователь включит Serverless и введёт CLI access token. Если токена ещё нет, локальная готовность подтверждается `npm run verify`, а deploy остаётся единственным внешним шагом.

- [ ] **Шаг 7: создать итоговый коммит**

```bash
git add README.md .env.example package.json package-lock.json src/http tests/unit/http
git commit -m "docs: add Telegram Serverless deployment guide"
```

## Самопроверка покрытия

- Пользователи, контакт и профиль покрыты задачей 7.
- Просмотр, сортировка и фильтрация билетов покрыты задачей 7.
- Подписки, matching, лимит и ownership покрыты задачами 3 и 7.
- Реальный Aviasales fixture, unknown validation, URL и retry покрыты задачей 5.
- Ticket upsert, price history, expiration, lock и sync runs покрыты задачами 6 и 8.
- Уведомления, price drop и дедупликация покрыты задачами 3, 6 и 8.
- Telegram SQLite schema и отсутствие foreign keys покрыты задачей 4.
- Strict TypeScript, отсутствие runtime npm и deploy-ограничения покрыты задачами 1 и 9.
- Защищённый HTTP endpoint-контракт покрыт задачей 9; отдельным остаётся только hosting-адаптер, который опубликует контракт после выбора платформы.
