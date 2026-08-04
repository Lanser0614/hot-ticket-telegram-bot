import type { TelegramBotRouter } from '../../application/bot-router.js';
import type { Logger } from '../../application/ports.js';
import type { TelegramUpdate } from './updates.js';

interface UpdatesApi {
  getUpdates(
    input: { readonly offset: number; readonly timeoutSeconds: number },
    signal: AbortSignal
  ): Promise<readonly TelegramUpdate[]>;
}

interface OffsetStore {
  read(): Promise<number>;
  save(value: number): Promise<void>;
}

interface LongPollingDependencies {
  readonly api: UpdatesApi;
  readonly offsetStore: OffsetStore;
  readonly router: Pick<TelegramBotRouter, 'handleMessage' | 'handleCallbackQuery'>;
  readonly logger: Logger;
  readonly pollTimeoutSeconds: number;
  readonly updateMaxAttempts: number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const POLL_BACKOFF = [1_000, 2_000, 5_000, 10_000] as const;

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export class LongPollingRunner {
  public constructor(private readonly dependencies: LongPollingDependencies) {}

  public async pollOnce(signal: AbortSignal): Promise<number> {
    let offset = await this.dependencies.offsetStore.read();
    const updates = await this.dependencies.api.getUpdates({
      offset,
      timeoutSeconds: this.dependencies.pollTimeoutSeconds
    }, signal);
    for (const update of updates) {
      if (update.updateId < offset) continue;
      await this.processUpdate(update);
      offset = update.updateId + 1;
      await this.dependencies.offsetStore.save(offset);
    }
    return updates.length;
  }

  public async run(signal: AbortSignal): Promise<void> {
    let failureCount = 0;
    while (!signal.aborted) {
      try {
        await this.pollOnce(signal);
        failureCount = 0;
      } catch (error: unknown) {
        if (signal.aborted) return;
        this.dependencies.logger.warn('telegram_poll_failed', { errorType: errorType(error) });
        const index = Math.min(failureCount, POLL_BACKOFF.length - 1);
        await this.dependencies.sleep(POLL_BACKOFF[index] ?? 10_000);
        failureCount += 1;
      }
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    for (let attempt = 1; attempt <= this.dependencies.updateMaxAttempts; attempt += 1) {
      try {
        if (update.malformed === true) {
          throw new TypeError('Некорректный Telegram update payload');
        }
        if (update.message === null && update.callbackQuery === null) return;
        if (update.message !== null) {
          await this.dependencies.router.handleMessage(update.message);
        } else if (update.callbackQuery !== null) {
          await this.dependencies.router.handleCallbackQuery(update.callbackQuery);
        }
        return;
      } catch (error: unknown) {
        if (attempt === this.dependencies.updateMaxAttempts) {
          this.dependencies.logger.error('telegram_update_skipped', {
            updateId: update.updateId,
            errorType: errorType(error)
          });
          return;
        }
        await this.dependencies.sleep(attempt * 1_000);
      }
    }
  }
}
