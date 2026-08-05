import type { Clock, UserRepository } from './ports.js';
import type { TelegramProfileInput, User } from './models.js';
import { ValidationError } from '../domain/errors.js';
import type { TripClass } from '../domain/travel-preferences.js';

function assertTelegramId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Некорректный Telegram ID');
  }
  return value;
}

export class UserService {
  public constructor(
    private readonly users: UserRepository,
    private readonly clock: Clock
  ) {}

  public start(input: TelegramProfileInput): Promise<User> {
    assertTelegramId(input.telegramUserId);
    assertTelegramId(input.telegramChatId);
    return this.users.upsertTelegramProfile(input, this.clock.now());
  }

  public async acceptContact(input: {
    telegramUserId: number;
    contactUserId: number;
    phoneNumber: string;
  }): Promise<void> {
    if (assertTelegramId(input.telegramUserId) !== assertTelegramId(input.contactUserId)) {
      throw new ValidationError('Нельзя сохранить чужой контакт');
    }
    const phoneNumber = input.phoneNumber.trim();
    if (phoneNumber.length === 0) throw new ValidationError('Номер телефона пуст');
    const user = await this.requireByTelegramUserId(input.telegramUserId);
    await this.users.updatePhone(user.id, phoneNumber, this.clock.now());
  }

  public requireByTelegramUserId(telegramUserId: number): Promise<User> {
    return this.findRequired(assertTelegramId(telegramUserId));
  }

  private async findRequired(telegramUserId: number): Promise<User> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (user === null) throw new ValidationError('Сначала выполните /start');
    return user;
  }

  public async updateTicketPreferences(
    telegramUserId: number,
    tripClass: TripClass,
    baggageRequired: boolean
  ): Promise<void> {
    const user = await this.requireByTelegramUserId(telegramUserId);
    await this.users.updateTicketPreferences(
      user.id,
      tripClass,
      baggageRequired,
      this.clock.now()
    );
  }
}
