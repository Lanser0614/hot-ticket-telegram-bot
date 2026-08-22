import type { Logger, SyncSourceRepository } from './ports.js';
import type { SyncTicketsService } from './sync-tickets.js';
import type { NotificationDeliveryService } from './notification-delivery.js';

export class SyncHotTicketsJob {
  public constructor(
    private readonly syncSourceRepository: SyncSourceRepository,
    private readonly syncTicketsService: SyncTicketsService,
    private readonly logger: Logger,
    private readonly notificationDelivery?: NotificationDeliveryService
  ) {}

  public async execute(): Promise<{ processedSources: number }> {
    const sources = await this.syncSourceRepository.findEnabled();
    let processedSources = 0;

    for (const source of sources) {
      try {
        await this.syncTicketsService.execute(source);
        processedSources += 1;
      } catch (error: unknown) {
        this.logger.error('ticket_sync_source_failed', {
          originCode: source.originCode,
          currencyCode: source.currencyCode,
          error: error instanceof Error ? error.message : 'Неизвестная ошибка синхронизации'
        });
      }
    }

    await this.notificationDelivery?.execute();
    return { processedSources };
  }
}
