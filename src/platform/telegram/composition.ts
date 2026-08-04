import { api, db, fetch } from 'sdk';

import { TelegramBotRouter } from '../../application/bot-router.js';
import { SessionService } from '../../application/sessions.js';
import { SubscriptionService } from '../../application/subscriptions.js';
import { SyncHotTicketsJob } from '../../application/sync-hot-tickets-job.js';
import { SyncTicketsService } from '../../application/sync-tickets.js';
import { TicketService } from '../../application/tickets.js';
import { UserService } from '../../application/users.js';
import { loadConfig } from '../../config.js';
import {
  AviasalesClient,
  AviasalesHotTicketsProvider,
  type Sleeper
} from '../../infrastructure/aviasales/client.js';
import { SdkTextHttpClient } from './http.js';
import { ConsoleLogger, SystemClock } from '../../infrastructure/runtime/logger.js';
import { TelegramApiAdapter } from './notifier.js';
import { ApplicationRepositories } from '../../infrastructure/sqlite/repositories.js';

class TimerSleeper implements Sleeper {
  public sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

function createSharedRuntime() {
  const clock = new SystemClock();
  const logger = new ConsoleLogger();
  const repositories = new ApplicationRepositories(db, clock);
  const telegram = new TelegramApiAdapter(api);
  return { clock, logger, repositories, telegram };
}

export function createTelegramRouter(): TelegramBotRouter {
  const runtime = createSharedRuntime();
  return new TelegramBotRouter({
    users: new UserService(runtime.repositories, runtime.clock),
    tickets: new TicketService(runtime.repositories, runtime.repositories, runtime.clock),
    subscriptions: new SubscriptionService(runtime.repositories, runtime.repositories, runtime.clock),
    sessions: new SessionService(runtime.repositories, runtime.clock),
    gateway: runtime.telegram
  });
}

export function createSyncRuntime(): {
  job: SyncHotTicketsJob;
  ensureInitialSource(): Promise<void>;
} {
  const runtime = createSharedRuntime();
  const config = loadConfig({
    AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
  });
  const client = new AviasalesClient(
    new SdkTextHttpClient(fetch),
    new TimerSleeper(),
    config
  );
  const provider = new AviasalesHotTicketsProvider(client, runtime.logger);
  const service = new SyncTicketsService({
    provider,
    ticketRepository: runtime.repositories,
    priceHistoryRepository: runtime.repositories,
    subscriptionRepository: runtime.repositories,
    notificationHistoryRepository: runtime.repositories,
    userRepository: runtime.repositories,
    notifier: runtime.telegram,
    lockRepository: runtime.repositories,
    syncRunRepository: runtime.repositories,
    clock: runtime.clock,
    logger: runtime.logger
  });
  return {
    job: new SyncHotTicketsJob(runtime.repositories, service, runtime.logger),
    ensureInitialSource: () => runtime.repositories.ensureInitialSource(runtime.clock.now())
  };
}
