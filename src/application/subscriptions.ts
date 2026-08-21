import type { User } from './models.js';
import type { Clock, SubscriptionRepository, UserRepository } from './ports.js';
import {
  validateSubscriptionDraft,
  type Subscription,
  type SubscriptionDraft
} from '../domain/subscription.js';
import { ValidationError } from '../domain/errors.js';
import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_ORIGIN_CODE
} from '../domain/travel-preferences.js';

export type CreateSubscriptionInput = Pick<
  SubscriptionDraft,
  | 'destinationCode'
  | 'departureDateFrom'
  | 'departureDateTo'
  | 'maxPrice'
  | 'directOnly'
  | 'roundTripOnly'
> & { readonly baggageRequired?: boolean };

export class SubscriptionService {
  public constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly users: UserRepository,
    private readonly clock: Clock
  ) {}

  public async createForUser(
    userId: number,
    input: CreateSubscriptionInput
  ): Promise<Subscription> {
    if (await this.subscriptions.countActiveByUser(userId) >= 20) {
      throw new ValidationError('Достигнут лимит 20 активных подписок');
    }
    return this.subscriptions.create(validateSubscriptionDraft({
      ...input,
      userId,
      originCode: DEFAULT_ORIGIN_CODE,
      currencyCode: DEFAULT_CURRENCY_CODE,
      baggageRequired: input.baggageRequired ?? false
    }), this.clock.now());
  }

  public listForUser(userId: number): Promise<readonly Subscription[]> {
    return this.subscriptions.listByUser(userId);
  }

  public deactivateForUser(userId: number, subscriptionId: number): Promise<boolean> {
    return this.subscriptions.deactivateOwned(userId, subscriptionId, this.clock.now());
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
