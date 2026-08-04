# HotTicketBot VDS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить Telegram Serverless runtime обычным Node.js 24 приложением для VDS с long polling, локальным SQLite, systemd и локальным cron.

**Architecture:** доменная и прикладная логика остаётся за существующими портами. Новые адаптеры используют Telegram Bot API через native `fetch` и SQLite через `better-sqlite3`; постоянный bot entry point работает под systemd, а отдельные sync и backup entry points запускаются cron.

**Tech Stack:** Node.js 24 LTS, strict TypeScript, `better-sqlite3`, native `fetch`, Vitest, ESLint, systemd, cron, SQLite WAL.

## Global Constraints

- Вся работа выполняется в текущем `master`, без отдельной ветки или worktree.
- Production runtime требует Node.js 24 LTS и не содержит imports `sdk`, `sdk/db`, `sdk/api` или `sdk/fetch`.
- Telegram updates получаются только через long polling; webhook и публичный HTTP server отсутствуют.
- `TELEGRAM_BOT_TOKEN` обязателен и никогда не попадает в ошибки, логи или Git.
- SQLite по умолчанию хранится в `./data/hot-ticket-bot.sqlite`, включает WAL, foreign keys и `busy_timeout = 5000`.
- Long polling timeout по умолчанию 50 секунд; update обрабатывается максимум три раза с паузами 1 и 2 секунды.
- Sync запускается локальным cron каждые 10 минут через `flock`.
- Backup запускается ежедневно в 03:30 и удаляет только свои копии старше семи дней.
- Сохраняются strict TypeScript, `noUncheckedIndexedAccess`, запрет `any`, unknown validation и существующие бизнес-правила.

---

## Карта файлов

```text
package.json                                  VDS-команды и runtime-зависимости
tsconfig.build.json                           production emit в dist
src/config.ts                                 проверенная VDS-конфигурация
migrations/001_initial.sql                    SQLite schema и app_state
src/infrastructure/sqlite/database.ts         better-sqlite3 adapter и lifecycle
src/infrastructure/sqlite/migrations.ts       транзакционный migration runner
src/infrastructure/sqlite/repositories.ts     application repositories
src/infrastructure/sqlite/offset-store.ts     durable Telegram update offset
src/infrastructure/telegram/api-client.ts     raw Telegram Bot API
src/infrastructure/telegram/updates.ts        unknown -> internal update
src/infrastructure/telegram/long-polling.ts   polling, retry, shutdown
src/infrastructure/http/native-fetch.ts       Aviasales HTTP adapter
src/infrastructure/runtime/logger.ts          console logger и clock
src/runtime/composition.ts                    production dependency composition
src/entries/bot.ts                            systemd process entry point
src/entries/sync.ts                           cron sync entry point
src/entries/backup.ts                         daily backup entry point
deploy/systemd/hot-ticket-bot.service         hardened service unit
deploy/cron/hot-ticket-bot                    sync и backup schedule
README.md                                     установка и эксплуатация VDS
```

Удаляются Serverless-only файлы: `schema.ts`, `scripts/build-policy.js`, `scripts/build-telegram.mjs`, `scripts/tgcloud.mjs`, `src/handlers`, `src/types/telegram-sdk.d.ts`, `src/http/sync-endpoint.ts`, прежние Serverless entries/adapters и соответствующие tests.

---

### Task 1: VDS configuration and Node build foundation

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `tsconfig.build.json`
- Modify: `src/config.ts`
- Create: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `loadVdsConfig(input: NodeJS.ProcessEnv): VdsConfig`
- Produces: `VdsConfig` с `telegramBotToken`, `databasePath`, `aviasales`, `pollTimeoutSeconds`, `updateMaxAttempts`

- [ ] **Step 1: написать падающие тесты VDS-конфигурации**

```ts
it('создаёт production config с безопасными defaults', () => {
  const config = loadVdsConfig({
    TELEGRAM_BOT_TOKEN: '123:secret',
    AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
  });
  expect(config.databasePath).toBe('./data/hot-ticket-bot.sqlite');
  expect(config.pollTimeoutSeconds).toBe(50);
  expect(config.updateMaxAttempts).toBe(3);
});

it('не раскрывает токен при ошибке', () => {
  const token = '123:very-secret';
  expect(() => loadVdsConfig({
    TELEGRAM_BOT_TOKEN: token,
    AVIASALES_EXPLORE_BASE_URL: 'http://unsafe.example'
  })).toThrowError(expect.not.stringContaining(token));
});
```

- [ ] **Step 2: подтвердить ожидаемое падение**

Run: `npm test -- tests/unit/config.test.ts`

Expected: FAIL, потому что `loadVdsConfig` ещё отсутствует.

- [ ] **Step 3: реализовать точную конфигурацию**

```ts
export interface VdsConfig {
  readonly telegramBotToken: string;
  readonly databasePath: string;
  readonly pollTimeoutSeconds: number;
  readonly updateMaxAttempts: number;
  readonly aviasales: AppConfig;
}

export function loadVdsConfig(input: NodeJS.ProcessEnv): VdsConfig {
  const telegramBotToken = requiredSecret(input.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN');
  return {
    telegramBotToken,
    databasePath: input.DATABASE_PATH?.trim() || './data/hot-ticket-bot.sqlite',
    pollTimeoutSeconds: boundedInteger(input.TELEGRAM_POLL_TIMEOUT_SECONDS, 50, 1, 50),
    updateMaxAttempts: boundedInteger(input.TELEGRAM_UPDATE_MAX_ATTEMPTS, 3, 1, 5),
    aviasales: loadConfig({ AVIASALES_EXPLORE_BASE_URL: input.AVIASALES_EXPLORE_BASE_URL })
  };
}
```

- [ ] **Step 4: добавить VDS build config и зависимости**

`tsconfig.build.json` расширяет основной config, включает `noEmit: false`, `rootDir: src`, `outDir: dist`, `declaration: false`, `sourceMap: true`. Установить `better-sqlite3` как dependency и `@types/better-sqlite3` как dev dependency. Добавить `engines.node: ">=24"`, пока не удаляя старые scripts до Task 7.

- [ ] **Step 5: выполнить проверки задачи**

Run: `npm test -- tests/unit/config.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: создать коммит**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json src/config.ts tests/unit/config.test.ts
git commit -m "build: add VDS runtime configuration"
```

---

### Task 2: SQLite database and transactional migrations

**Files:**
- Create: `migrations/001_initial.sql`
- Create: `src/infrastructure/sqlite/database.ts`
- Create: `src/infrastructure/sqlite/migrations.ts`
- Create: `tests/integration/sqlite-migrations.test.ts`

**Interfaces:**
- Produces: `openSqliteDatabase(path: string): SqliteDatabase`
- Produces: `applyMigrations(database: SqliteDatabase, directory: string): void`
- Produces: `SqliteDatabase implements RawDatabase` и exposes `close()`, `backup(path)`

- [ ] **Step 1: написать падающий migration integration test**

```ts
it('создаёт schema один раз и включает pragmas', async () => {
  const fixture = createTemporaryDatabase();
  const database = openSqliteDatabase(fixture.databasePath);
  applyMigrations(database, migrationsDirectory);
  applyMigrations(database, migrationsDirectory);

  expect(await database.get('PRAGMA journal_mode')).toMatchObject({ journal_mode: 'wal' });
  expect(await database.get('PRAGMA foreign_keys')).toMatchObject({ foreign_keys: 1 });
  expect(await database.get('SELECT count(*) AS count FROM schema_migrations'))
    .toEqual({ count: 1 });
  expect(await database.get("SELECT name FROM sqlite_master WHERE name = 'app_state'"))
    .toEqual({ name: 'app_state' });
  database.close();
});
```

- [ ] **Step 2: подтвердить падение**

Run: `npm test -- tests/integration/sqlite-migrations.test.ts`

Expected: FAIL из-за отсутствующих SQLite modules.

- [ ] **Step 3: создать полную SQL schema**

`001_initial.sql` переносит девять таблиц из прежнего `schema.ts` в обычный SQL, включая все unique constraints и indexes, и добавляет `app_state`. Все timestamps остаются integer Unix seconds, boolean — integer `0/1`, JSON — text.

- [ ] **Step 4: реализовать database adapter**

```ts
export class SqliteDatabase implements RawDatabase {
  public run(query: string, parameters: Parameters = {}): Promise<unknown> {
    return Promise.resolve(this.database.prepare(query).run(stripPrefixes(parameters)));
  }

  public all(query: string, parameters: Parameters = {}): Promise<readonly Row[]> {
    return Promise.resolve(this.database.prepare(query).all(stripPrefixes(parameters)) as Row[]);
  }

  public get(query: string, parameters: Parameters = {}): Promise<Row | null> {
    const row = this.database.prepare(query).get(stripPrefixes(parameters));
    return Promise.resolve(row === undefined ? null : row as Row);
  }
}
```

Adapter создаёт parent directory, открывает `Database`, выполняет `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, не разрешает extensions и нормализует существующие `:named` parameters для `better-sqlite3`.

- [ ] **Step 5: реализовать migration runner**

Runner сортирует только имена `^\d{3}_[a-z0-9-]+\.sql$`, создаёт `schema_migrations`, вычисляет SHA-256 содержимого, отклоняет изменение уже применённой migration и применяет каждую новую migration внутри `BEGIN IMMEDIATE` transaction.

- [ ] **Step 6: выполнить тесты**

Run: `npm test -- tests/integration/sqlite-migrations.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: создать коммит**

```bash
git add migrations src/infrastructure/sqlite tests/integration/sqlite-migrations.test.ts
git commit -m "feat: add VDS SQLite database and migrations"
```

---

### Task 3: Real SQLite repositories and durable offset

**Files:**
- Move: `src/platform/telegram/repositories.ts` → `src/infrastructure/sqlite/repositories.ts`
- Create: `src/infrastructure/sqlite/offset-store.ts`
- Replace: `tests/contract/telegram-repositories.test.ts` → `tests/integration/sqlite-repositories.test.ts`
- Create: `tests/unit/sqlite/offset-store.test.ts`

**Interfaces:**
- Preserves: `ApplicationRepositories implements UserRepository, TicketRepository, PriceHistoryRepository, SubscriptionRepository, SessionRepository, NotificationHistoryRepository, SyncSourceRepository, SyncRunRepository, LockRepository`
- Produces: `TelegramOffsetStore.read(): Promise<number>`
- Produces: `TelegramOffsetStore.save(nextOffset: number): Promise<void>`

- [ ] **Step 1: заменить mock-контракт реальным integration test**

Test открывает временный SQLite-файл, применяет migrations, выполняет user upsert дважды, ticket insert/update, price history, subscription matching, notification dedup, session save/delete, initial sync source и lock acquire/release. Проверки используют реальные SQL rows, а не `SdkDbMock`.

- [ ] **Step 2: написать падающий offset test**

```ts
it('сохраняет следующий Telegram offset между экземплярами', async () => {
  const first = new TelegramOffsetStore(database, clock);
  expect(await first.read()).toBe(0);
  await first.save(42);
  const second = new TelegramOffsetStore(database, clock);
  expect(await second.read()).toBe(42);
});
```

- [ ] **Step 3: подтвердить падение новых тестов**

Run: `npm test -- tests/integration/sqlite-repositories.test.ts tests/unit/sqlite/offset-store.test.ts`

Expected: FAIL до переноса repository и реализации offset store.

- [ ] **Step 4: перенести repository без изменения бизнес-семантики**

Переименовать `TelegramRepositories` в `ApplicationRepositories`, сохранить parameterized SQL и row guards. Удалить только зависимость от Serverless namespace.

- [ ] **Step 5: реализовать durable offset**

```sql
INSERT INTO app_state (key, value, updated_at)
VALUES ('telegram_update_offset', :value, :updatedAt)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
```

`read()` принимает только безопасное неотрицательное integer string; повреждённое значение вызывает `TypeError`.

- [ ] **Step 6: выполнить проверки**

Run: `npm test -- tests/integration/sqlite-repositories.test.ts tests/unit/sqlite/offset-store.test.ts`

Expected: PASS.

- [ ] **Step 7: создать коммит**

```bash
git add src/infrastructure/sqlite tests/integration/sqlite-repositories.test.ts tests/unit/sqlite
git commit -m "feat: run application repositories on SQLite"
```

---

### Task 4: Native HTTP and Telegram Bot API client

**Files:**
- Create: `src/infrastructure/http/native-fetch.ts`
- Create: `src/infrastructure/telegram/api-client.ts`
- Create: `src/infrastructure/telegram/updates.ts`
- Create: `tests/unit/http/native-fetch.test.ts`
- Create: `tests/unit/telegram/api-client.test.ts`
- Create: `tests/unit/telegram/updates.test.ts`

**Interfaces:**
- Produces: `NativeTextHttpClient implements TextHttpClient`
- Produces: `TelegramBotApiClient implements TelegramGateway, TicketNotifier`
- Produces: `getUpdates(input, signal): Promise<readonly TelegramUpdate[]>`
- Produces: `parseTelegramUpdate(value: unknown): TelegramUpdate`

- [ ] **Step 1: написать failing tests Bot API**

```ts
it('получает только message и callback_query начиная с offset', async () => {
  const fetch = new FetchSpy({ ok: true, result: [] });
  const client = new TelegramBotApiClient('123:secret', fetch.call);
  await client.getUpdates({ offset: 17, timeoutSeconds: 50 }, new AbortController().signal);
  expect(fetch.body()).toEqual({
    offset: 17,
    timeout: 50,
    allowed_updates: ['message', 'callback_query']
  });
});

it('не раскрывает token при Telegram error', async () => {
  const token = '123:top-secret';
  const client = new TelegramBotApiClient(token, telegramErrorFetch);
  await expect(client.sendMessage({ chatId: 1, text: 'x' })).rejects.not.toThrow(token);
});
```

- [ ] **Step 2: написать failing unknown update tests**

Проверить корректный `message`, корректный `callback_query`, отказ для дробного `update_id`, отсутствующего `from.id`, массива вместо object и неизвестного payload.

- [ ] **Step 3: подтвердить падение**

Run: `npm test -- tests/unit/telegram tests/unit/http/native-fetch.test.ts`

Expected: FAIL из-за отсутствующих modules.

- [ ] **Step 4: реализовать native Aviasales HTTP adapter**

Использовать `AbortController`, внешний signal timeout, `response.text()`, `TimeoutError` для abort по timeout и `NetworkError` для остальных transport failures.

- [ ] **Step 5: реализовать Bot API client**

Единый private `call(method, payload, signal)` делает POST JSON, проверяет HTTP status, затем unknown envelope `{ok,result}`. Ошибки содержат только method, HTTP status или Telegram description, но никогда не URL и token. Существующий notification formatting переносится из Serverless adapter без изменения текста.

- [ ] **Step 6: реализовать update guards**

Mapper возвращает:

```ts
export interface TelegramUpdate {
  readonly updateId: number;
  readonly message: TelegramMessage | null;
  readonly callbackQuery: TelegramCallbackQuery | null;
}
```

Ровно одно поддерживаемое payload поле должно быть непустым; unsupported update сохраняет `updateId` с обоими payload `null`, чтобы polling мог безопасно продвинуть offset.

- [ ] **Step 7: выполнить проверки и коммит**

Run: `npm test -- tests/unit/telegram tests/unit/http/native-fetch.test.ts && npm run typecheck`

```bash
git add src/infrastructure/http src/infrastructure/telegram tests/unit/http tests/unit/telegram
git commit -m "feat: add native Telegram Bot API client"
```

---

### Task 5: Long polling runner with retry and graceful stop

**Files:**
- Create: `src/infrastructure/telegram/long-polling.ts`
- Create: `tests/unit/telegram/long-polling.test.ts`

**Interfaces:**
- Produces: `LongPollingRunner.run(signal: AbortSignal): Promise<void>`
- Consumes: `TelegramBotApiClient.getUpdates`, `TelegramOffsetStore`, `TelegramBotRouter`, `Logger`, `Sleeper`

- [ ] **Step 1: написать failing dispatch/offset test**

```ts
it('обрабатывает updates последовательно и сохраняет offset после каждого', async () => {
  api.queue([
    update(7, message('/start')),
    update(8, callback('subscription:disable:3'))
  ]);
  await runner.runUntilIdle(signal);
  expect(router.events).toEqual(['message:/start', 'callback:subscription:disable:3']);
  expect(offsetStore.saved).toEqual([8, 9]);
});
```

- [ ] **Step 2: написать failing poison update и shutdown tests**

Проверить три dispatch attempts, sleeper calls `[1000, 2000]`, offset после третьей ошибки, отсутствие token/error stack в logger context и завершение активного poll после `AbortController.abort()`.

- [ ] **Step 3: подтвердить падение**

Run: `npm test -- tests/unit/telegram/long-polling.test.ts`

Expected: FAIL до появления runner.

- [ ] **Step 4: реализовать runner**

`run()` содержит бесконечный цикл до abort. Poll transport failures используют capped backoff 1, 2, 5, 10 секунд и сбрасывают backoff после успешного ответа. Dispatch retry использует точное число `updateMaxAttempts`; offset сохраняется после успеха или окончательного poison skip.

- [ ] **Step 5: выполнить проверки и коммит**

Run: `npm test -- tests/unit/telegram/long-polling.test.ts && npm run typecheck`

```bash
git add src/infrastructure/telegram/long-polling.ts tests/unit/telegram/long-polling.test.ts
git commit -m "feat: process Telegram updates with long polling"
```

---

### Task 6: Production composition and executable entries

**Files:**
- Move: `src/platform/telegram/logger.ts` → `src/infrastructure/runtime/logger.ts`
- Create: `src/runtime/composition.ts`
- Create: `src/entries/bot.ts`
- Replace: `src/entries/sync-hot-tickets.ts` → `src/entries/sync.ts`
- Create: `tests/integration/vds-composition.test.ts`

**Interfaces:**
- Produces: `createVdsRuntime(config, dependencies): VdsRuntime`
- Produces: `runBot(signal, env): Promise<void>`
- Produces: `runSync(env): Promise<{processedSources: number}>`

- [ ] **Step 1: написать failing composition integration test**

Test создаёт temporary SQLite, fake Telegram fetch и fixture Aviasales fetch, вызывает composition, обрабатывает `/start`, выполняет sync и проверяет реальные rows `users`, `tickets`, `sync_runs`.

- [ ] **Step 2: подтвердить падение**

Run: `npm test -- tests/integration/vds-composition.test.ts`

Expected: FAIL из-за отсутствующей VDS composition.

- [ ] **Step 3: реализовать shared runtime composition**

Composition открывает DB, применяет migrations, создаёт `ApplicationRepositories`, `TelegramBotApiClient`, `NativeTextHttpClient`, `TelegramBotRouter`, `SyncTicketsService`, `SyncHotTicketsJob`, `TelegramOffsetStore` и `LongPollingRunner`. Factory принимает injectable `fetch`, clock, sleeper и logger для тестов.

- [ ] **Step 4: реализовать bot entry point**

```ts
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}
await runBot(controller.signal, process.env);
```

Top-level catch пишет безопасное сообщение, устанавливает `process.exitCode = 1`; database закрывается в `finally`.

- [ ] **Step 5: реализовать sync entry point**

Entry вызывает `ensureInitialSource()`, затем `job.execute()`, печатает `{"processedSources":N}`, закрывает DB и возвращает nonzero exit code при общей startup/config ошибке.

- [ ] **Step 6: выполнить проверки и коммит**

Run: `npm test -- tests/integration/vds-composition.test.ts tests/integration/telegram-flows.test.ts tests/integration/sync-hot-tickets.test.ts`

```bash
git add src/runtime src/entries src/infrastructure/runtime tests/integration/vds-composition.test.ts
git commit -m "feat: compose executable VDS bot runtime"
```

---

### Task 7: Replace Serverless build and remove SDK runtime

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Delete: `schema.ts`
- Delete: `scripts/build-policy.js`
- Delete: `scripts/build-telegram.mjs`
- Delete: `scripts/tgcloud.mjs`
- Delete: `src/handlers/message.ts`
- Delete: `src/handlers/callback_query.ts`
- Delete: `src/types/telegram-sdk.d.ts`
- Delete: `src/platform/telegram/composition.ts`
- Delete: `src/platform/telegram/http.ts`
- Delete: `src/platform/telegram/notifier.ts`
- Delete: `src/http/sync-endpoint.ts`
- Delete: `tests/build/build-telegram.test.ts`
- Delete: `tests/contract/telegram-adapters.test.ts`
- Delete: `tests/support/sdk-db.mock.ts`
- Delete: `tests/unit/http/sync-endpoint.test.ts`
- Delete: `tests/unit/schema-contract.test.ts`
- Create: `tests/build/vds-build.test.ts`

**Interfaces:**
- Produces scripts: `build`, `start`, `sync`, `test`, `lint`, `typecheck`, `verify`
- Produces: `dist/entries/bot.js`, `dist/entries/sync.js`

- [ ] **Step 1: написать failing VDS build contract**

```ts
it('не содержит Telegram Serverless imports и scripts', () => {
  const sourceFiles = listSourceFiles('src');
  for (const file of sourceFiles) {
    expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"]sdk(?:\/[^'"]*)?['"]/u);
  }
  expect(packageJson.scripts).not.toHaveProperty('cloud:login');
  expect(packageJson.dependencies).not.toHaveProperty('@tgcloud/cli');
});
```

- [ ] **Step 2: подтвердить падение**

Run: `npm test -- tests/build/vds-build.test.ts`

Expected: FAIL, пока Serverless imports и scripts существуют.

- [ ] **Step 3: переключить production scripts**

```json
{
  "build": "tsc -p tsconfig.build.json",
  "start": "node --env-file-if-exists=.env dist/entries/bot.js",
  "sync": "node --env-file-if-exists=.env dist/entries/sync.js",
  "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
}
```

Удалить `@tgcloud/cli` и `esbuild`, сохранить `better-sqlite3` production dependency.

- [ ] **Step 4: удалить перечисленные Serverless-only файлы**

Удаление ограничить точным списком задачи. `telegram-dist/` остаётся ignored generated directory и не используется.

- [ ] **Step 5: выполнить build contract и production build**

Run: `npm test -- tests/build/vds-build.test.ts && npm run build`

Expected: PASS; `dist/entries/bot.js` и `dist/entries/sync.js` существуют, `rg "from ['\"]sdk" dist src` не находит совпадений.

- [ ] **Step 6: создать коммит**

```bash
git add -A package.json package-lock.json tsconfig.json .gitignore scripts schema.ts src tests
git commit -m "refactor: remove Telegram Serverless runtime"
```

---

### Task 8: Backup, systemd, cron and VDS operations

**Files:**
- Create: `src/entries/backup.ts`
- Create: `tests/integration/backup.test.ts`
- Create: `deploy/systemd/hot-ticket-bot.service`
- Create: `deploy/cron/hot-ticket-bot`
- Create: `tests/contract/vds-deploy.test.ts`
- Modify: `.env.example`
- Replace: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces script: `backup`
- Produces: daily backup in `BACKUP_DIRECTORY`, default `./backups`, retention seven days

- [ ] **Step 1: написать failing backup test**

```ts
it('создаёт восстанавливаемую копию и удаляет только старые managed backups', async () => {
  const result = await backupDatabase({ databasePath, backupDirectory, now: fixedNow });
  expect(result.path).toMatch(/hot-ticket-bot-20260804T033000Z\.sqlite$/u);
  expect(readUserCount(result.path)).toBe(1);
  expect(exists(oldManagedBackup)).toBe(false);
  expect(exists(unrelatedFile)).toBe(true);
});
```

- [ ] **Step 2: написать failing deploy contract**

Проверить `User=hotticket`, `EnvironmentFile=/etc/hot-ticket-bot.env`, `WorkingDirectory=/opt/hot-ticket-bot`, `Restart=on-failure`, `NoNewPrivileges=true`, writable data path, cron `*/10`, `flock`, backup `30 3 * * *` и отсутствие HTTP/domain/webhook settings.

- [ ] **Step 3: подтвердить падение**

Run: `npm test -- tests/integration/backup.test.ts tests/contract/vds-deploy.test.ts`

Expected: FAIL до появления entry/deploy files.

- [ ] **Step 4: реализовать backup entry**

Использовать `better-sqlite3` backup API. Имя строится только из UTC timestamp, retention удаляет только `^hot-ticket-bot-\d{8}T\d{6}Z\.sqlite$`, cutoff — ровно семь суток.

- [ ] **Step 5: создать hardened systemd unit и cron**

Service запускает `/usr/bin/node dist/entries/bot.js` от `hotticket`, читает `/etc/hot-ticket-bot.env`, имеет `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`, `ReadWritePaths=/opt/hot-ticket-bot/data /opt/hot-ticket-bot/backups`.

Cron запускает sync каждые 10 минут и backup в 03:30 от `hotticket`, обе команды используют `/bin/bash -c`, загружают `/etc/hot-ticket-bot.env` через `set -a; source`, используют абсолютные пути; sync обёрнут `flock -n /run/lock/hot-ticket-bot-sync.lock`. Environment-файл принадлежит `hotticket:hotticket` и имеет mode `0600`, поэтому cron может прочитать его, а root сохраняет административный доступ.

- [ ] **Step 6: полностью переписать README под VDS**

README содержит: создание пользователя и каталогов, Node.js 24 LTS, clone/copy, `npm ci`, `npm run verify`, env permissions `0600`, build, systemd install/enable/start, cron install, первый ручной sync, `/start`, journal logs, status/restart, backup/restore и update procedure. Удалить Serverless, BotFather CLI access и tgcloud instructions. BotFather нужен только для обычного API token.

- [ ] **Step 7: выполнить проверки и коммит**

Run: `npm test -- tests/integration/backup.test.ts tests/contract/vds-deploy.test.ts && npm run build`

```bash
git add src/entries/backup.ts tests deploy .env.example README.md package.json
git commit -m "ops: add VDS service cron and backup"
```

---

### Task 9: Release verification and clean master handoff

**Files:**
- Verify all project files
- Update: `docs/superpowers/plans/2026-08-04-hot-ticket-bot-vds-implementation.md` checkboxes only if execution workflow tracks them in-file

**Interfaces:**
- Produces a verified VDS release with no Serverless runtime dependency

- [ ] **Step 1: выполнить полный release gate**

Run: `npm run verify`

Expected: ESLint, strict TypeScript, every Vitest suite and Node production build exit 0.

- [ ] **Step 2: проверить production artifacts**

Run: `rg -n "from ['\"]sdk|tgcloud|telegram-dist" src dist package.json README.md deploy`

Expected: no matches, кроме исторического пояснения в documentation, если оно явно помечено как удалённое.

- [ ] **Step 3: smoke-test commands without real secrets**

Run: `TELEGRAM_BOT_TOKEN= AVIASALES_EXPLORE_BASE_URL=https://explore-api.aviasales.com npm start`

Expected: nonzero exit и безопасная ошибка об отсутствующем `TELEGRAM_BOT_TOKEN`, без stack/token.

- [ ] **Step 4: подтвердить детерминированный VDS smoke test**

Run: `npm test -- tests/integration/vds-composition.test.ts tests/integration/sqlite-migrations.test.ts`

Expected: fixture-based composition, migrations, `/start` и sync проходят без внешней сети.

- [ ] **Step 5: проверить Git state**

Run: `git status --short --branch`

Expected: только пользовательская `.idea/` остаётся untracked; проектные изменения committed. Если release gate потребовал исправление, оно фиксируется в задаче, которой принадлежит, после повторного полного `npm run verify`; пустой verification commit не создаётся.

## Spec coverage self-review

- Long polling, persistent offset, retry и graceful shutdown: Tasks 4–6.
- SQLite WAL, migrations, repositories и two-process concurrency: Tasks 2–3.
- Local cron sync и `flock`: Task 8.
- Daily backup и seven-day retention: Task 8.
- Node.js 24 build и отсутствие Serverless imports: Tasks 1 и 7.
- systemd hardening, protected environment и no public port: Task 8.
- Existing domain/application behavior and regression coverage: Tasks 3, 6 и 9.
- Полная VDS-инструкция: Task 8.
