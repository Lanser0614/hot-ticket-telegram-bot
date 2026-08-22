import type { SyncResult, SyncSourceKey } from './models.js';
import type {
  Clock,
  HotTicketsProvider,
  LockRepository,
  Logger,
  NotificationHistoryRepository,
  NotificationQueueRepository,
  PriceHistoryRepository,
  RoutePriceRepository,
  SubscriptionRepository,
  SyncRunRepository,
  TicketNotifier,
  TicketRepository,
  UserRepository
} from './ports.js';
import { validateHotOffersInput } from '../domain/codes.js';
import { dateInTimeZone } from '../domain/dates.js';
import { detectTicketEvent } from '../domain/ticket-events.js';
import type { TripClass } from '../domain/travel-preferences.js';
import { calculateDaysAhead, createRouteKey } from '../domain/route-price.js';

interface SyncTicketsDependencies {
  provider: HotTicketsProvider;
  ticketRepository: TicketRepository;
  priceHistoryRepository: PriceHistoryRepository;
  routePriceRepository: RoutePriceRepository;
  subscriptionRepository: SubscriptionRepository;
  notificationHistoryRepository: NotificationHistoryRepository;
  notificationQueueRepository?: NotificationQueueRepository;
  userRepository: UserRepository;
  notifier: TicketNotifier;
  lockRepository: LockRepository;
  syncRunRepository: SyncRunRepository;
  clock: Clock;
  logger: Logger;
}

const LOCK_TTL_SECONDS = 300;
const DESTINATION_CACHE_TRIP_CLASSES: readonly TripClass[] = ['economy', 'business'];
const DESTINATION_CACHE_BAGGAGE_OPTIONS = [false, true] as const;

function minuteInTashkent(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: 'hour' | 'minute'): number => Number(
    parts.find((part) => part.type === type)?.value ?? '0'
  );
  return value('hour') * 60 + value('minute');
}

function isQuietMinute(minute: number, start: number, end: number): boolean {
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

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
      const observedRouteKeys = new Set<string>();

      for (const ticket of tickets) {
        const { stored, previous } = await this.dependencies.ticketRepository.upsert(ticket, observedAt);
        if (previous === null) result.inserted += 1;
        else result.updated += 1;

        if (previous === null || previous.price !== stored.price) {
          await this.dependencies.priceHistoryRepository.addPrice(stored.id, stored.price, observedAt);
        }

        const routeKey = createRouteKey(
          stored.originCode,
          stored.destinationCode,
          stored.tripClass
        );
        try {
          if (stored.price < 100_000 || stored.price > 100_000_000) {
            this.dependencies.logger.warn('route_observation_rejected', {
              ticketId: stored.id,
              routeKey,
              price: stored.price
            });
          } else {
            await this.dependencies.routePriceRepository.recordObservation({
              routeKey,
              originCode: stored.originCode,
              destinationCode: stored.destinationCode,
              tripClass: stored.tripClass,
              isDirect: stored.isDirect,
              hasBaggage: stored.hasBaggage,
              departureDate: stored.departureDate,
              daysAhead: calculateDaysAhead(stored.departureDate, observedAt),
              price: stored.price,
              currencyCode: stored.currencyCode,
              observedAt
            });
            observedRouteKeys.add(routeKey);
          }
        } catch (error: unknown) {
          this.dependencies.logger.warn('route_observation_failed', {
            ticketId: stored.id,
            routeKey,
            error: error instanceof Error ? error.message : 'Неизвестная ошибка'
          });
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
          if (this.dependencies.notificationQueueRepository !== undefined) {
            await this.dependencies.notificationQueueRepository.enqueue({
              userId: user.id,
              subscriptionId: subscription.id,
              ticketId: stored.id,
              ticketPrice: stored.price,
              notificationType: event,
              queuedAt: observedAt
            });
            continue;
          }
          if (!user.instantNotificationsEnabled) continue;
          if (
            user.quietHoursEnabled
            && isQuietMinute(
              minuteInTashkent(observedAt),
              user.quietStartMinute,
              user.quietEndMinute
            )
          ) continue;
          const tashkentDay = dateInTimeZone(observedAt, 'Asia/Tashkent');
          const dayStart = new Date(`${tashkentDay}T00:00:00+05:00`);
          if (
            await this.dependencies.notificationHistoryRepository.countSentSince(user.id, dayStart)
            >= 3
          ) continue;
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

      const observedDay = dateInTimeZone(observedAt, 'Asia/Tashkent');
      for (const routeKey of observedRouteKeys) {
        await this.dependencies.routePriceRepository.rebuildDailyAggregate(
          routeKey,
          observedDay,
          observedAt
        );
      }
      await this.dependencies.routePriceRepository.pruneObservations(
        new Date(observedAt.getTime() - 30 * 86_400_000)
      );

      await this.dependencies.ticketRepository.deactivateUnseen(
        source,
        tickets.map((ticket) => ticket.externalKey),
        observedAt
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
