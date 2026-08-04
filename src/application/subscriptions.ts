import type { User } from './models.js';
import type { Clock, SubscriptionRepository, UserRepository } from './ports.js';
import {
  validateSubscriptionDraft,
  type Subscription,
  type SubscriptionDraft
} from '../domain/subscription.js';
import { ValidationError } from '../domain/errors.js';

export class SubscriptionService {
  public constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly users: UserRepository,
    private readonly clock: Clock
  ) {}

  public async createForUser(
    userId: number,
    input: Omit<SubscriptionDraft, 'userId'>
  ): Promise<Subscription> {
    if (await this.subscriptions.countActiveByUser(userId) >= 20) {
      throw new ValidationError('Достигнут лимит 20 активных подписок');
    }
    return this.subscriptions.create(validateSubscriptionDraft({ ...input, userId }), this.clock.now());
  }

  public async listForTelegramUser(telegramUserId: number): Promise<readonly Subscription[]> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.listByUser(user.id);
  }

  public async deactivateForTelegramUser(
    telegramUserId: number,
    subscriptionId: number
  ): Promise<boolean> {
    const user = await this.requireUser(telegramUserId);
    return this.subscriptions.deactivateOwned(user.id, subscriptionId, this.clock.now());
  }

  private async requireUser(telegramUserId: number): Promise<User> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start');
    return user;
  }
}

