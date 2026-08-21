import { resolve } from 'node:path';

import { TelegramBotRouter } from '../application/bot-router.js';
import type { Clock, Logger } from '../application/ports.js';
import { SessionService } from '../application/sessions.js';
import { SubscriptionService } from '../application/subscriptions.js';
import { SyncHotTicketsJob } from '../application/sync-hot-tickets-job.js';
import { SyncTicketsService } from '../application/sync-tickets.js';
import { TicketService } from '../application/tickets.js';
import { UserService } from '../application/users.js';
import { SignedTrackedLinkFactory } from '../application/tracked-links.js';
import type { VdsConfig } from '../config.js';
import {
  AviasalesClient,
  AviasalesHotTicketsProvider,
  type Sleeper
} from '../infrastructure/aviasales/client.js';
import { NativeTextHttpClient } from '../infrastructure/http/native-fetch.js';
import { ConsoleLogger, SystemClock } from '../infrastructure/runtime/logger.js';
import { openSqliteDatabase } from '../infrastructure/sqlite/database.js';
import { applyMigrations } from '../infrastructure/sqlite/migrations.js';
import { TelegramOffsetStore } from '../infrastructure/sqlite/offset-store.js';
import { ApplicationRepositories } from '../infrastructure/sqlite/repositories.js';
import {
  TelegramBotApiClient,
  type FetchLike
} from '../infrastructure/telegram/api-client.js';
import { LongPollingRunner } from '../infrastructure/telegram/long-polling.js';

class TimerSleeper implements Sleeper {
  public sleep(milliseconds: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
  }
}

export interface RuntimeOverrides {
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly sleeper?: Sleeper;
  readonly migrationsDirectory?: string;
}

export function createVdsRuntime(config: VdsConfig, overrides: RuntimeOverrides = {}) {
  const clock = overrides.clock ?? new SystemClock();
  const logger = overrides.logger ?? new ConsoleLogger();
  const sleeper = overrides.sleeper ?? new TimerSleeper();
  const fetch = overrides.fetch ?? globalThis.fetch;
  const database = openSqliteDatabase(config.databasePath);
  applyMigrations(database, overrides.migrationsDirectory ?? resolve('migrations'));
  const repositories = new ApplicationRepositories(database, clock);
  const links = new SignedTrackedLinkFactory({
    publicBaseUrl: config.tracking.publicBaseUrl,
    signingSecret: config.tracking.clickSigningSecret
  });
  const telegram = new TelegramBotApiClient(config.telegramBotToken, fetch, links);
  const router = new TelegramBotRouter({
    users: new UserService(repositories, clock),
    tickets: new TicketService(repositories, repositories, clock),
    subscriptions: new SubscriptionService(repositories, repositories, clock),
    sessions: new SessionService(repositories, clock),
    gateway: telegram,
    links
  });
  const provider = new AviasalesHotTicketsProvider(
    new AviasalesClient(new NativeTextHttpClient(fetch), sleeper, config.aviasales),
    logger
  );
  const syncService = new SyncTicketsService({
    provider,
    ticketRepository: repositories,
    priceHistoryRepository: repositories,
    routePriceRepository: repositories,
    subscriptionRepository: repositories,
    notificationHistoryRepository: repositories,
    userRepository: repositories,
    notifier: telegram,
    lockRepository: repositories,
    syncRunRepository: repositories,
    clock,
    logger
  });
  const syncJob = new SyncHotTicketsJob(repositories, syncService, logger);
  const polling = new LongPollingRunner({
    api: telegram,
    offsetStore: new TelegramOffsetStore(database, clock),
    router,
    logger,
    pollTimeoutSeconds: config.pollTimeoutSeconds,
    updateMaxAttempts: config.updateMaxAttempts,
    sleep: (milliseconds) => sleeper.sleep(milliseconds)
  });
  return {
    database,
    repositories,
    clock,
    logger,
    links,
    telegram,
    router,
    polling,
    syncJob,
    ensureInitialSource: () => repositories.ensureInitialSource(clock.now()),
    close: () => database.close()
  };
}
