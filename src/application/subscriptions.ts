import type { User } from './models.js';
import type { Clock, SubscriptionRepository, UserRepository } from './ports.js';
import {
  validateSubscriptionDraft,
  type Subscription,
  type SubscriptionDraft
} from '../domain/subscription.js';
import { ValidationError } from '../domain/errors.js';

export type CreateSubscriptionInput = Pick<
  SubscriptionDraft,
  | 'destinationCode'
  | 'departureDateFrom'
  | 'departureDateTo'
  | 'maxPrice'
  | 'directOnly'
  | 'roundTripOnly'
> & {
  readonly baggageRequired?: boolean | undefined;
  readonly tripClass?: SubscriptionDraft['tripClass'] | undefined;
};

export type UpdateSubscriptionInput = Omit<
  CreateSubscriptionInput,
  never
>;

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
    const user = await this.users.findById(userId);
    if (user === null) throw new ValidationError('Пользователь не найден');
    return this.subscriptions.create(validateSubscriptionDraft({
      ...input,
      userId,
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      baggageRequired: input.baggageRequired ?? user.baggageRequired,
      tripClass: input.tripClass ?? user.preferredTripClass
    }), this.clock.now());
  }

  public async updateForUser(
    userId: number,
    subscriptionId: number,
    input: UpdateSubscriptionInput
  ): Promise<Subscription | null> {
    const user = await this.users.findById(userId);
    if (user === null) throw new ValidationError('Пользователь не найден');
    const validated = validateSubscriptionDraft({
      ...input,
      userId,
      originCode: user.defaultOriginCode,
      currencyCode: user.preferredCurrencyCode,
      baggageRequired: input.baggageRequired ?? user.baggageRequired,
      tripClass: input.tripClass ?? user.preferredTripClass
    });
    return this.subscriptions.updateOwned(userId, subscriptionId, {
      destinationCode: validated.destinationCode,
      departureDateFrom: validated.departureDateFrom,
      departureDateTo: validated.departureDateTo,
      maxPrice: validated.maxPrice,
      directOnly: validated.directOnly,
      roundTripOnly: validated.roundTripOnly,
      baggageRequired: validated.baggageRequired,
      tripClass: validated.tripClass
    }, this.clock.now());
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
