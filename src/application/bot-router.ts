import type {
  TelegramGateway
} from './ports.js';
import type { SessionService } from './sessions.js';
import type { SubscriptionService } from './subscriptions.js';
import type { TicketListingOptions, TicketService } from './tickets.js';
import type { UserService } from './users.js';
import { normalizeCurrencyCode, normalizeIataCode } from '../domain/codes.js';
import { assertIsoDate } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { assertMoney } from '../domain/money.js';
import { mainKeyboard, subscriptionKeyboard, ticketKeyboard } from '../presentation/keyboards.js';
import { presentSubscription } from '../presentation/subscription-presenter.js';
import { presentTicket } from '../presentation/ticket-presenter.js';

export interface TelegramMessage {
  chat: { id: number };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string | null;
    language_code?: string;
  };
  text?: string;
  contact?: { user_id?: number; phone_number: string };
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
}

interface RouterDependencies {
  users: UserService;
  tickets: TicketService;
  subscriptions: SubscriptionService;
  sessions: SessionService;
  gateway: TelegramGateway;
}

function requirePayloadString(
  payload: Readonly<Record<string, unknown>>,
  key: string
): string {
  const value = payload[key];
  if (typeof value !== 'string') throw new ValidationError(`Сессия не содержит ${key}`);
  return value;
}

function nullablePayloadString(
  payload: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`Сессия не содержит ${key}`);
  return value;
}

function nullablePayloadNumber(
  payload: Readonly<Record<string, unknown>>,
  key: string
): number | null {
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== 'number') throw new ValidationError(`Сессия не содержит ${key}`);
  return value;
}

function requirePayloadBoolean(
  payload: Readonly<Record<string, unknown>>,
  key: string
): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') throw new ValidationError(`Сессия не содержит ${key}`);
  return value;
}

export class TelegramBotRouter {
  public constructor(private readonly dependencies: RouterDependencies) {}

  public async handleMessage(message: TelegramMessage): Promise<void> {
    if (message.from === undefined) return;
    try {
      if (message.contact !== undefined) {
        await this.dependencies.users.acceptContact({
          telegramUserId: message.from.id,
          contactUserId: message.contact.user_id ?? 0,
          phoneNumber: message.contact.phone_number
        });
        await this.send(message.chat.id, 'Телефон сохранён.');
        return;
      }

      const text = message.text?.trim();
      if (text === undefined || text.length === 0) return;
      if (text.startsWith('/') || this.isMenuText(text)) {
        await this.handleCommand(message, text);
        return;
      }
      await this.handleSessionInput(message.from.id, message.chat.id, text);
    } catch (error: unknown) {
      const text = error instanceof ValidationError ? error.message : 'Не удалось выполнить действие';
      await this.send(message.chat.id, text);
    }
  }

  public async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    const subscriptionMatch = /^subscription:disable:(\d+)$/.exec(data);
    if (subscriptionMatch !== null) {
      const subscriptionId = Number(subscriptionMatch[1]);
      const changed = await this.dependencies.subscriptions.deactivateForTelegramUser(
        query.from.id,
        subscriptionId
      );
      await this.dependencies.gateway.answerCallbackQuery({
        callbackQueryId: query.id,
        text: changed ? 'Подписка отключена' : 'Подписка не найдена'
      });
      return;
    }
    await this.dependencies.gateway.answerCallbackQuery({
      callbackQueryId: query.id,
      text: 'Неизвестное действие'
    });
  }

  private isMenuText(text: string): boolean {
    return ['🔥 Горящие билеты', '🔔 Мои уведомления', '➕ Создать уведомление', '⚙️ Настройки', '👤 Профиль']
      .includes(text);
  }

  private async handleCommand(message: TelegramMessage, text: string): Promise<void> {
    const from = message.from;
    if (from === undefined) return;
    const command = text.split(/\s+/u, 1)[0] ?? text;
    if (command === '/start') {
      await this.dependencies.users.start({
        telegramUserId: from.id,
        telegramChatId: message.chat.id,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        languageCode: from.language_code ?? null
      });
      await this.dependencies.gateway.sendMessage({
        chatId: message.chat.id,
        text: 'Главное меню',
        replyMarkup: mainKeyboard()
      });
      return;
    }

    const user = await this.dependencies.users.requireByTelegramUserId(from.id);
    if (command === '/tickets' || text === '🔥 Горящие билеты') {
      const destination = text.split(/\s+/u)[1];
      await this.sendTickets(from.id, message.chat.id, destination === undefined ? {} : { destinationCode: destination });
    } else if (command === '/subscriptions' || text === '🔔 Мои уведомления') {
      const subscriptions = await this.dependencies.subscriptions.listForTelegramUser(from.id);
      if (subscriptions.length === 0) await this.send(message.chat.id, 'Активных уведомлений нет.');
      for (const subscription of subscriptions) {
        await this.dependencies.gateway.sendMessage({
          chatId: message.chat.id,
          text: presentSubscription(subscription),
          replyMarkup: subscriptionKeyboard(subscription.id)
        });
      }
    } else if (command === '/new_subscription' || text === '➕ Создать уведомление') {
      await this.dependencies.sessions.start(user.id, 'new_subscription', 'origin');
      await this.send(message.chat.id, 'Введите origin, например TAS.');
    } else if (command === '/settings' || text === '⚙️ Настройки') {
      await this.dependencies.sessions.start(user.id, 'settings', 'origin');
      await this.send(message.chat.id, 'Введите новый origin.');
    } else if (command === '/profile' || text === '👤 Профиль') {
      await this.send(message.chat.id, [
        `Профиль: ${user.firstName ?? user.username ?? String(user.telegramUserId)}`,
        `Origin: ${user.defaultOriginCode}`,
        `Currency: ${user.preferredCurrencyCode}`,
        `Телефон: ${user.phoneNumber === null ? 'не указан' : 'указан'}`
      ].join('\n'));
    } else if (command === '/help') {
      await this.send(message.chat.id, '/start /tickets /subscriptions /new_subscription /settings /profile /help');
    } else {
      await this.send(message.chat.id, 'Неизвестная команда. Используйте /help.');
    }
  }

  private async sendTickets(
    telegramUserId: number,
    chatId: number,
    options: TicketListingOptions
  ): Promise<void> {
    const tickets = await this.dependencies.tickets.listForTelegramUser(telegramUserId, options);
    if (tickets.length === 0) {
      await this.send(chatId, 'Подходящие билеты не найдены.');
      return;
    }
    for (const ticket of tickets) {
      await this.dependencies.gateway.sendMessage({
        chatId,
        text: presentTicket(ticket),
        parseMode: 'HTML',
        replyMarkup: ticketKeyboard(ticket.ticketLink)
      });
    }
  }

  private async handleSessionInput(telegramUserId: number, chatId: number, text: string): Promise<void> {
    const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
    const state = await this.dependencies.sessions.getActiveState(user.id);
    if (state.session === null) {
      await this.send(chatId, state.expired ? 'Сессия истекла. Начните действие заново.' : 'Используйте команды из /help.');
      return;
    }
    if (state.session.flow === 'settings') {
      await this.handleSettingsInput(telegramUserId, chatId, state.session, text);
      return;
    }
    if (state.session.flow === 'new_subscription') {
      await this.handleSubscriptionInput(telegramUserId, chatId, state.session, text);
    }
  }

  private async handleSettingsInput(
    telegramUserId: number,
    chatId: number,
    session: Awaited<ReturnType<SessionService['start']>>,
    text: string
  ): Promise<void> {
    if (session.step === 'origin') {
      const originCode = normalizeIataCode(text);
      await this.dependencies.sessions.advance(session, 'currency', { originCode });
      await this.send(chatId, 'Введите новый currency, например UZS.');
      return;
    }
    const originCode = requirePayloadString(session.payload, 'originCode');
    const currencyCode = normalizeCurrencyCode(text);
    await this.dependencies.users.updatePreferences(telegramUserId, originCode, currencyCode);
    await this.dependencies.sessions.cancel(session.userId);
    await this.send(chatId, 'Настройки обновлены.');
  }

  private async handleSubscriptionInput(
    telegramUserId: number,
    chatId: number,
    session: Awaited<ReturnType<SessionService['start']>>,
    text: string
  ): Promise<void> {
    const payload = { ...session.payload };
    if (session.step === 'origin') {
      payload.originCode = normalizeIataCode(text);
      await this.advanceSubscription(session, 'destination', payload, chatId, 'Введите destination или ANY.');
    } else if (session.step === 'destination') {
      payload.destinationCode = text.toUpperCase() === 'ANY' ? null : normalizeIataCode(text);
      await this.advanceSubscription(session, 'date_from', payload, chatId, 'Введите начальную дату YYYY-MM-DD.');
    } else if (session.step === 'date_from') {
      payload.departureDateFrom = assertIsoDate(text);
      await this.advanceSubscription(session, 'date_to', payload, chatId, 'Введите конечную дату YYYY-MM-DD.');
    } else if (session.step === 'date_to') {
      const departureDateTo = assertIsoDate(text);
      if (departureDateTo < String(payload.departureDateFrom)) {
        throw new ValidationError('Конечная дата раньше начальной');
      }
      payload.departureDateTo = departureDateTo;
      await this.advanceSubscription(session, 'max_price', payload, chatId, 'Введите максимальную цену или ANY.');
    } else if (session.step === 'max_price') {
      payload.maxPrice = text.toUpperCase() === 'ANY' ? null : assertMoney(Number(text));
      await this.advanceSubscription(session, 'direct', payload, chatId, 'Только прямой рейс? YES или NO.');
    } else if (session.step === 'direct') {
      if (!['YES', 'NO'].includes(text.toUpperCase())) throw new ValidationError('Введите YES или NO');
      payload.directOnly = text.toUpperCase() === 'YES';
      await this.advanceSubscription(session, 'confirm', payload, chatId, 'Введите SAVE для сохранения.');
    } else if (session.step === 'confirm') {
      if (text.toUpperCase() !== 'SAVE') throw new ValidationError('Введите SAVE или начните заново');
      const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
      await this.dependencies.subscriptions.createForUser(user.id, {
        originCode: requirePayloadString(payload, 'originCode'),
        destinationCode: nullablePayloadString(payload, 'destinationCode'),
        currencyCode: user.preferredCurrencyCode,
        departureDateFrom: requirePayloadString(payload, 'departureDateFrom'),
        departureDateTo: requirePayloadString(payload, 'departureDateTo'),
        maxPrice: nullablePayloadNumber(payload, 'maxPrice'),
        directOnly: requirePayloadBoolean(payload, 'directOnly'),
        baggageRequired: false
      });
      await this.dependencies.sessions.cancel(session.userId);
      await this.send(chatId, 'Уведомление сохранено.');
    }
  }

  private async advanceSubscription(
    session: Awaited<ReturnType<SessionService['start']>>,
    step: string,
    payload: Readonly<Record<string, unknown>>,
    chatId: number,
    prompt: string
  ): Promise<void> {
    await this.dependencies.sessions.advance(session, step, payload);
    await this.send(chatId, prompt);
  }

  private async send(chatId: number, text: string): Promise<void> {
    await this.dependencies.gateway.sendMessage({ chatId, text });
  }
}
