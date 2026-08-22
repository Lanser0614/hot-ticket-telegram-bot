import type { NotificationQueueItem, User } from './models.js';
import type {
  Clock,
  Logger,
  NotificationHistoryRepository,
  NotificationQueueRepository,
  SubscriptionRepository,
  TelegramGateway,
  TicketNotifier,
  TicketRepository,
  UserRepository
} from './ports.js';
import { dateInTimeZone } from '../domain/dates.js';
import type { StoredTicket } from './models.js';

const TIME_ZONE = 'Asia/Tashkent';
const DAILY_INSTANT_LIMIT = 3;
const DIGEST_MINUTE = 9 * 60;
const MAX_ATTEMPTS = 5;

interface Dependencies {
  readonly queue: NotificationQueueRepository;
  readonly history: NotificationHistoryRepository;
  readonly users: UserRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly tickets: TicketRepository;
  readonly notifier: TicketNotifier;
  readonly telegram: TelegramGateway;
  readonly clock: Clock;
  readonly logger: Logger;
}

function minuteInTimeZone(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const read = (type: 'hour' | 'minute'): number => Number(
    parts.find((part) => part.type === type)?.value ?? '0'
  );
  return read('hour') * 60 + read('minute');
}

function isQuiet(user: User, now: Date): boolean {
  if (!user.quietHoursEnabled) return false;
  const minute = minuteInTimeZone(now);
  return user.quietStartMinute <= user.quietEndMinute
    ? minute >= user.quietStartMinute && minute < user.quietEndMinute
    : minute >= user.quietStartMinute || minute < user.quietEndMinute;
}

function bestPerSubscription(items: readonly NotificationQueueItem[]): NotificationQueueItem[] {
  const best = new Map<string, NotificationQueueItem>();
  for (const item of items) {
    const key = `${String(item.userId)}:${String(item.subscriptionId)}`;
    const current = best.get(key);
    if (
      current === undefined
      || item.ticketPrice < current.ticketPrice
      || (item.ticketPrice === current.ticketPrice && item.id > current.id)
    ) best.set(key, item);
  }
  return [...best.values()].sort((left, right) => left.queuedAt.getTime() - right.queuedAt.getTime());
}

function digestText(items: readonly { ticket: StoredTicket }[]): string {
  const lines = items.map(({ ticket }) => (
    `• ${ticket.originCode} → ${ticket.destinationCode} — ${new Intl.NumberFormat('ru-RU').format(ticket.price)} ${ticket.currencyCode}`
  ));
  return ['☀️ <b>Утренний HotTicket</b>', '', ...lines, '', 'Откройте Mini App, чтобы посмотреть детали.'].join('\n');
}

export class NotificationDeliveryService {
  public constructor(private readonly dependencies: Dependencies) {}

  public async execute(): Promise<{ notificationsSent: number; digestsSent: number }> {
    const now = this.dependencies.clock.now();
    let notificationsSent = 0;
    const due = await this.dependencies.queue.listDue(now, 500);
    const quietItems: NotificationQueueItem[] = [];
    const immediateItems: NotificationQueueItem[] = [];
    for (const item of due) {
      const user = await this.dependencies.users.findById(item.userId);
      if (user !== null && isQuiet(user, now)) quietItems.push(item);
      else immediateItems.push(item);
    }
    for (const item of bestPerSubscription(quietItems)) {
      await this.dependencies.queue.discardPendingForSubscriptionExcept(
        item.userId,
        item.subscriptionId,
        item.id
      );
    }
    for (const item of immediateItems) {
      notificationsSent += await this.tryImmediate(item, now);
    }
    const digestsSent = await this.tryDigests(now);
    return { notificationsSent, digestsSent };
  }

  private async tryImmediate(item: NotificationQueueItem, now: Date): Promise<number> {
    const [user, subscription, ticket] = await Promise.all([
      this.dependencies.users.findById(item.userId),
      this.dependencies.subscriptions.findSubscriptionById(item.subscriptionId),
      this.dependencies.tickets.findTicketById(item.ticketId)
    ]);
    if (user === null || subscription === null || ticket === null || !subscription.isActive) {
      await this.dependencies.queue.markDiscarded(item.id, 'missing_entity');
      return 0;
    }
    if (await this.dependencies.history.exists(
      item.userId,
      item.subscriptionId,
      item.ticketId,
      item.ticketPrice
    )) {
      await this.dependencies.queue.markDiscarded(item.id, 'already_sent');
      return 0;
    }
    if (isQuiet(user, now)) return 0;
    if (item.deliveryMode === 'digest_only') {
      if (!user.morningDigestEnabled) {
        await this.dependencies.queue.markDiscarded(item.id, 'digest_disabled');
      }
      return 0;
    }
    const localDay = dateInTimeZone(now, TIME_ZONE);
    const dayStart = new Date(`${localDay}T00:00:00+05:00`);
    const sentToday = await this.dependencies.history.countSentSince(user.id, dayStart);
    if (!user.instantNotificationsEnabled || sentToday >= DAILY_INSTANT_LIMIT) {
      if (!user.morningDigestEnabled) {
        await this.dependencies.queue.markDiscarded(item.id, 'delivery_disabled_or_capped');
      } else {
        await this.dependencies.queue.markDigestOnly(item.id);
      }
      return 0;
    }
    try {
      const sent = await this.dependencies.notifier.send({
        user,
        subscription,
        ticket,
        type: item.notificationType
      });
      await this.dependencies.history.addNotification({
        userId: user.id,
        subscriptionId: subscription.id,
        ticketId: ticket.id,
        notifiedPrice: item.ticketPrice,
        notificationType: item.notificationType,
        telegramMessageId: sent.telegramMessageId,
        sentAt: now
      });
      await this.dependencies.queue.markSent(item.id, sent.telegramMessageId, now);
      return 1;
    } catch (error: unknown) {
      await this.retry(item, error, now);
      return 0;
    }
  }

  private async tryDigests(now: Date): Promise<number> {
    if (minuteInTimeZone(now) < DIGEST_MINUTE) return 0;
    const localDay = dateInTimeZone(now, TIME_ZONE);
    const cutoff = new Date(`${localDay}T09:00:00+05:00`);
    const candidates = bestPerSubscription(
      (await this.dependencies.queue.listDue(now, 500))
        .filter((item) => item.queuedAt < cutoff)
    );
    const byUser = new Map<number, NotificationQueueItem[]>();
    for (const item of candidates) {
      const items = byUser.get(item.userId) ?? [];
      items.push(item);
      byUser.set(item.userId, items);
    }
    let sentCount = 0;
    for (const [userId, items] of byUser) {
      const user = await this.dependencies.users.findById(userId);
      if (
        user === null
        || !user.morningDigestEnabled
        || isQuiet(user, now)
        || await this.dependencies.queue.hasDigestDelivery(userId, localDay)
      ) continue;
      const hydrated: Array<{
        item: NotificationQueueItem;
        ticket: StoredTicket;
        subscriptionId: number;
      }> = [];
      for (const item of items) {
        const [ticket, subscription] = await Promise.all([
          this.dependencies.tickets.findTicketById(item.ticketId),
          this.dependencies.subscriptions.findSubscriptionById(item.subscriptionId)
        ]);
        if (ticket === null || subscription === null || !subscription.isActive) {
          await this.dependencies.queue.markDiscarded(item.id, 'missing_entity');
          continue;
        }
        hydrated.push({ item, ticket, subscriptionId: subscription.id });
      }
      if (hydrated.length === 0) continue;
      try {
        const sent = await this.dependencies.telegram.sendMessage({
          chatId: user.telegramChatId,
          text: digestText(hydrated),
          parseMode: 'HTML'
        });
        for (const entry of hydrated) {
          await this.dependencies.history.addNotification({
            userId,
            subscriptionId: entry.subscriptionId,
            ticketId: entry.ticket.id,
            notifiedPrice: entry.item.ticketPrice,
            notificationType: entry.item.notificationType,
            deliveryKind: 'digest',
            telegramMessageId: sent.messageId,
            sentAt: now
          });
          await this.dependencies.queue.markSent(entry.item.id, sent.messageId, now);
        }
        await this.dependencies.queue.addDigestDelivery(userId, localDay, sent.messageId, now);
        sentCount += 1;
      } catch (error: unknown) {
        for (const entry of hydrated) await this.retry(entry.item, error, now);
      }
    }
    return sentCount;
  }

  private async retry(item: NotificationQueueItem, error: unknown, now: Date): Promise<void> {
    const attempts = item.attemptCount + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const delayMinutes = Math.min(360, 2 ** attempts * 5);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка Telegram';
    await this.dependencies.queue.markRetry(
      item.id,
      message,
      new Date(now.getTime() + delayMinutes * 60_000),
      terminal
    );
    this.dependencies.logger.warn('notification_delivery_failed', {
      queueId: item.id,
      attempt: attempts,
      terminal,
      error: message
    });
  }
}
