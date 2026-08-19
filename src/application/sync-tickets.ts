import type { SyncResult, SyncSourceKey } from './models.js';
import type {
  Clock,
  HotTicketsProvider,
  LockRepository,
  Logger,
  NotificationHistoryRepository,
  PriceHistoryRepository,
  SubscriptionRepository,
  SyncRunRepository,
  TicketNotifier,
  TicketRepository,
  UserRepository
} from './ports.js';
import { validateHotOffersInput } from '../domain/codes.js';
import { dateInTimeZone } from '../domain/dates.js';
import { detectTicketEvent } from '../domain/ticket-events.js';
import {
  matchesUserTicketPreferences,
  type TripClass
} from '../domain/travel-preferences.js';

interface SyncTicketsDependencies {
  provider: HotTicketsProvider;
  ticketRepository: TicketRepository;
  priceHistoryRepository: PriceHistoryRepository;
  subscriptionRepository: SubscriptionRepository;
  notificationHistoryRepository: NotificationHistoryRepository;
  userRepository: UserRepository;
  notifier: TicketNotifier;
  lockRepository: LockRepository;
  syncRunRepository: SyncRunRepository;
  clock: Clock;
  logger: Logger;
}

const LOCK_TTL_SECONDS = 300;
const TICKET_EXPIRATION_MS = 6 * 60 * 60 * 1_000;
const DESTINATION_CACHE_TRIP_CLASSES: readonly TripClass[] = ['economy', 'business'];
const DESTINATION_CACHE_BAGGAGE_OPTIONS = [false, true] as const;

export class SyncTicketsService {
  public constructor(private readonly dependencies: SyncTicketsDependencies) {}

  public async execute(input: SyncSourceKey): Promise<SyncResult> {
    const source = validateHotOffersInput(input);
    const lockKey = `sync:hot-tickets:${source.originCode}:${source.currencyCode}`;
    const lockAcquired = await this.dependencies.lockRepository.acquire(lockKey, LOCK_TTL_SECONDS);
    const emptyResult: SyncResult = {
      status: 'skipped',
      origin: source.originCode,
      currency: source.currencyCode,
      fetched: 0,
      inserted: 0,
      updated: 0,
      notificationsSent: 0
    };
    if (!lockAcquired) return emptyResult;

    let runId: number | null = null;
    try {
      const observedAt = this.dependencies.clock.now();
      runId = await this.dependencies.syncRunRepository.start(source, observedAt);
      const tickets = await this.dependencies.provider.getHotTickets(source);
      const result: SyncResult = {
        ...emptyResult,
        status: 'success',
        fetched: tickets.length
      };

      for (const ticket of tickets) {
        const { stored, previous } = await this.dependencies.ticketRepository.upsert(ticket, observedAt);
        if (previous === null) result.inserted += 1;
        else result.updated += 1;

        if (previous !== null && previous.price !== stored.price) {
          await this.dependencies.priceHistoryRepository.addPrice(stored.id, stored.price, observedAt);
        }

        const event = detectTicketEvent(previous, stored);
        if (event === null) continue;

        const subscriptions = await this.dependencies.subscriptionRepository.findMatching(stored);
        for (const subscription of subscriptions) {
          const user = await this.dependencies.userRepository.findById(subscription.userId);
          if (user === null) {
            this.dependencies.logger.warn('notification_user_not_found', {
              userId: subscription.userId,
              subscriptionId: subscription.id
            });
            continue;
          }
          if (!matchesUserTicketPreferences(stored, user)) continue;

          const alreadySent = await this.dependencies.notificationHistoryRepository.exists(
            subscription.userId,
            subscription.id,
            stored.id,
            stored.price
          );
          if (alreadySent) continue;

          const sent = await this.dependencies.notifier.send({ user, subscription, ticket: stored, type: event });
          await this.dependencies.notificationHistoryRepository.addNotification({
            userId: user.id,
            subscriptionId: subscription.id,
            ticketId: stored.id,
            notifiedPrice: stored.price,
            notificationType: event,
            telegramMessageId: sent.telegramMessageId,
            sentAt: observedAt
          });
          result.notificationsSent += 1;
        }
      }

      await this.dependencies.ticketRepository.deactivateUnseenBefore(
        source,
        new Date(observedAt.getTime() - TICKET_EXPIRATION_MS)
      );
      await this.refreshDestinationCache(source, observedAt);
      await this.dependencies.syncRunRepository.complete(runId, result, this.dependencies.clock.now());
      return result;
    } catch (error: unknown) {
      if (runId !== null) {
        await this.dependencies.syncRunRepository.fail(
          runId,
          error instanceof Error ? error.message : 'Неизвестная ошибка синхронизации',
          this.dependencies.clock.now()
        );
      }
      throw error;
    } finally {
      await this.dependencies.lockRepository.release(lockKey);
    }
  }

  private async refreshDestinationCache(source: SyncSourceKey, observedAt: Date): Promise<void> {
    const departureDateFrom = dateInTimeZone(observedAt, 'Asia/Tashkent');
    for (const tripClass of DESTINATION_CACHE_TRIP_CLASSES) {
      for (const baggageRequired of DESTINATION_CACHE_BAGGAGE_OPTIONS) {
        const query = { ...source, departureDateFrom, tripClass, baggageRequired };
        const destinations = await this.dependencies.ticketRepository.listActiveDestinations(query);
        await this.dependencies.ticketRepository.saveActiveDestinationsCache(
          query,
          destinations,
          observedAt
        );
      }
    }
    await this.dependencies.ticketRepository.pruneActiveDestinationsCache(
      source,
      departureDateFrom
    );
  }
}
