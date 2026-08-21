import type {
  TelegramGateway,
  TrackedLinkFactory
} from './ports.js';
import type { SessionService } from './sessions.js';
import type { SubscriptionService } from './subscriptions.js';
import type { TicketListingOptions, TicketService } from './tickets.js';
import type { UserService } from './users.js';
import { assertIsoDate } from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import {
  formatLocalizedLocationLabel,
  isUzbekistanOrigin,
  resolveLocation
} from '../domain/locations.js';
import { assertMoney } from '../domain/money.js';
import {
  DEFAULT_CURRENCY_CODE,
  presentBaggage,
  presentTripClass,
  type TripClass
} from '../domain/travel-preferences.js';
import {
  catalogCitiesKeyboard,
  catalogTabsKeyboard,
  languageKeyboard,
  mainKeyboard,
  originKeyboard,
  settingsOriginKeyboard,
  subscriptionKeyboard,
  ticketKeyboard,
  ticketNavigationKeyboard
} from '../presentation/keyboards.js';
import { presentSubscription } from '../presentation/subscription-presenter.js';
import type { AppLanguage } from '../presentation/language.js';
import { languageFromCode, message as languageMessage } from '../presentation/language.js';
import type { CatalogCommand } from '../presentation/ticket-pagination.js';
import { parseCatalogCommand, parseTicketCursor } from '../presentation/ticket-pagination.js';
import { presentTicket } from '../presentation/ticket-presenter.js';

function localized(language: AppLanguage, russian: string, uzbek: string): string {
  return language === 'uz' ? uzbek : russian;
}

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
  chatId: number | null;
  data?: string;
}

interface RouterDependencies {
  users: UserService;
  tickets: TicketService;
  subscriptions: SubscriptionService;
  sessions: SessionService;
  gateway: TelegramGateway;
  links?: TrackedLinkFactory;
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
    const language = languageFromCode(message.from.language_code);
    try {
      if (message.contact !== undefined) {
        await this.dependencies.users.acceptContact({
          telegramUserId: message.from.id,
          contactUserId: message.contact.user_id ?? 0,
          phoneNumber: message.contact.phone_number
        });
        await this.send(message.chat.id, localized(language, 'Телефон сохранён.', 'Telefon saqlandi.'));
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
      await this.send(message.chat.id, this.errorText(
        error,
        language,
        'Не удалось выполнить действие',
        'Amalni bajarib bo‘lmadi'
      ));
    }
  }

  public async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    if (data.startsWith('onboarding:')) {
      await this.handleOnboardingCallback(query, data);
      return;
    }
    if (data.startsWith('settings:origin:')) {
      await this.handleSettingsOriginCallback(query, data);
      return;
    }
    const language = await this.languageForTelegramUser(query.from.id);
    const catalogCommand = parseCatalogCommand(data);
    if (catalogCommand !== null) {
      await this.handleCatalogCommand(query, catalogCommand);
      return;
    }
    if (data.startsWith('tickets:')) {
      const cursor = parseTicketCursor(data);
      if (cursor === null) {
        await this.answerCallback(query.id, localized(language, 'Некорректная страница', 'Noto‘g‘ri sahifa'));
        return;
      }
      if (query.chatId === null) {
        await this.answerCallback(query.id, localized(language, 'Не удалось открыть страницу', 'Sahifani ochib bo‘lmadi'));
        return;
      }
      try {
        const user = await this.dependencies.users.requireByTelegramUserId(query.from.id);
        const filtersChanged = cursor.tripClass !== user.preferredTripClass
          || cursor.baggageRequired !== user.baggageRequired;
        await this.dependencies.sessions.cancel(user.id);
        await this.sendTicketPage(query.from.id, query.chatId, {
          ...(cursor.destinationCode === null ? {} : { destinationCode: cursor.destinationCode }),
          offset: filtersChanged ? 0 : cursor.offset
        });
        await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
      } catch (error: unknown) {
        await this.answerCallback(
          query.id,
          this.errorText(error, language, 'Не удалось открыть страницу', 'Sahifani ochib bo‘lmadi')
        );
      }
      return;
    }
    const subscriptionMatch = /^subscription:disable:(\d+)$/.exec(data);
    if (subscriptionMatch !== null) {
      const subscriptionId = Number(subscriptionMatch[1]);
      const changed = await this.dependencies.subscriptions.deactivateForTelegramUser(
        query.from.id,
        subscriptionId
      );
      await this.dependencies.gateway.answerCallbackQuery({
        callbackQueryId: query.id,
        text: changed
          ? localized(language, 'Подписка отключена', 'Kuzatuv o‘chirildi')
          : localized(language, 'Подписка не найдена', 'Kuzatuv topilmadi')
      });
      return;
    }
    await this.dependencies.gateway.answerCallbackQuery({
      callbackQueryId: query.id,
      text: localized(language, 'Неизвестное действие', 'Noma’lum amal')
    });
  }

  private async handleCatalogCommand(
    query: TelegramCallbackQuery,
    command: CatalogCommand
  ): Promise<void> {
    const language = await this.languageForTelegramUser(query.from.id);
    if (query.chatId === null) {
      await this.answerCallback(query.id, localized(language, 'Не удалось открыть каталог', 'Katalogni ochib bo‘lmadi'));
      return;
    }
    try {
      const user = await this.dependencies.users.requireByTelegramUserId(query.from.id);
      const filter = {
        tripClass: user.preferredTripClass,
        baggageRequired: user.baggageRequired
      };
      if (command.kind === 'home') {
        await this.dependencies.gateway.sendMessage({
          chatId: query.chatId,
          text: this.originPrompt(user.defaultOriginCode, language),
          replyMarkup: catalogTabsKeyboard(filter, language)
        });
        await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
        return;
      }
      const cities = await this.dependencies.tickets.listAvailableDestinations(
        query.from.id,
        command.scope
      );
      if (cities.length === 0) {
        await this.dependencies.gateway.answerCallbackQuery({
          callbackQueryId: query.id,
          text: command.scope === 'domestic'
            ? localized(language, 'Локальных рейсов пока нет', 'Hozircha mahalliy reyslar yo‘q')
            : localized(language, 'Международных рейсов пока нет', 'Hozircha xalqaro reyslar yo‘q')
        });
        return;
      }
      await this.dependencies.gateway.sendMessage({
        chatId: query.chatId,
        text: command.scope === 'domestic'
          ? localized(language, '🇺🇿 Локальные направления:', '🇺🇿 Mahalliy yo‘nalishlar:')
          : localized(language, '🌍 Международные направления:', '🌍 Xalqaro yo‘nalishlar:'),
        replyMarkup: catalogCitiesKeyboard(command.scope, cities, command.offset, filter, language)
      });
      await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
    } catch (error: unknown) {
      await this.answerCallback(
        query.id,
        this.errorText(error, language, 'Не удалось открыть каталог', 'Katalogni ochib bo‘lmadi')
      );
    }
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId, text });
  }

  private async handleOnboardingCallback(
    query: TelegramCallbackQuery,
    data: string
  ): Promise<void> {
    const languageMatch = /^onboarding:language:(ru|uz)$/u.exec(data);
    if (languageMatch !== null) {
      const language = languageMatch[1] as AppLanguage;
      if (query.chatId === null) {
        await this.answerCallback(query.id, localized(language, 'Не удалось продолжить', 'Davom etib bo‘lmadi'));
        return;
      }
      await this.dependencies.gateway.sendMessage({
        chatId: query.chatId,
        text: localized(language, 'Выберите город вылета:', 'Uchish shahrini tanlang:'),
        replyMarkup: originKeyboard(language)
      });
      await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
      return;
    }
    const originMatch = /^onboarding:origin:(ru|uz):([A-Z0-9]{3})$/u.exec(data);
    if (originMatch !== null) {
      const language = originMatch[1] as AppLanguage;
      const originCode = originMatch[2] ?? '';
      if (query.chatId === null) {
        await this.answerCallback(query.id, localized(language, 'Не удалось продолжить', 'Davom etib bo‘lmadi'));
        return;
      }
      try {
        await this.dependencies.users.completeOnboarding(query.from.id, language, originCode);
        await this.dependencies.gateway.sendMessage({
          chatId: query.chatId,
          text: localized(language, 'Настройка завершена. Главное меню', 'Sozlash tugadi. Asosiy menyu'),
          replyMarkup: mainKeyboard(language)
        });
        await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
      } catch (error: unknown) {
        await this.answerCallback(
          query.id,
          this.errorText(error, language, 'Не удалось сохранить выбор', 'Tanlovni saqlab bo‘lmadi')
        );
      }
      return;
    }
    await this.answerCallback(query.id, 'Некорректный выбор');
  }

  private async handleSettingsOriginCallback(
    query: TelegramCallbackQuery,
    data: string
  ): Promise<void> {
    const language = await this.languageForTelegramUser(query.from.id);
    const match = /^settings:origin:([A-Z0-9]{3})$/u.exec(data);
    if (match === null || query.chatId === null) {
      await this.answerCallback(query.id, localized(language, 'Некорректный город', 'Shahar noto‘g‘ri'));
      return;
    }
    try {
      const user = await this.dependencies.users.requireByTelegramUserId(query.from.id);
      const state = await this.dependencies.sessions.getActiveState(user.id);
      if (state.session === null || state.session.flow !== 'settings' || state.session.step !== 'origin') {
        await this.answerCallback(query.id, localized(language, 'Настройка устарела', 'Sozlama muddati tugagan'));
        return;
      }
      await this.selectSettingsOrigin(
        query.from.id,
        query.chatId,
        state.session,
        match[1] ?? '',
        language
      );
      await this.dependencies.gateway.answerCallbackQuery({ callbackQueryId: query.id });
    } catch (error: unknown) {
      await this.answerCallback(
        query.id,
        this.errorText(error, language, 'Не удалось изменить город', 'Shaharni o‘zgartirib bo‘lmadi')
      );
    }
  }

  private isMenuText(text: string): boolean {
    return (['ru', 'uz'] as const).some((language) => [
      languageMessage(language, 'menuDeals'),
      languageMessage(language, 'menuSubscriptions'),
      languageMessage(language, 'menuNewSubscription'),
      languageMessage(language, 'menuSettings'),
      languageMessage(language, 'menuProfile')
    ].includes(text));
  }

  private async handleCommand(message: TelegramMessage, text: string): Promise<void> {
    const from = message.from;
    if (from === undefined) return;
    const command = text.split(/\s+/u, 1)[0] ?? text;
    if (command === '/start') {
      const user = await this.dependencies.users.start({
        telegramUserId: from.id,
        telegramChatId: message.chat.id,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        languageCode: from.language_code ?? null
      });
      if (!user.onboardingCompleted) {
        await this.dependencies.gateway.sendMessage({
          chatId: message.chat.id,
          text: 'Tilni tanlang / Выберите язык:',
          replyMarkup: languageKeyboard()
        });
      } else {
        const language = languageFromCode(user.languageCode);
        await this.dependencies.gateway.sendMessage({
          chatId: message.chat.id,
          text: languageMessage(language, 'mainMenu'),
          replyMarkup: mainKeyboard(language)
        });
      }
      return;
    }

    const user = await this.dependencies.users.requireByTelegramUserId(from.id);
    const language = languageFromCode(user.languageCode ?? from.language_code);
    if (!user.onboardingCompleted) {
      await this.dependencies.gateway.sendMessage({
        chatId: message.chat.id,
        text: 'Tilni tanlang / Выберите язык:',
        replyMarkup: languageKeyboard()
      });
      return;
    }
    if (text === languageMessage(language, 'menuDeals') || command === '/tickets') {
      const destination = command === '/tickets' ? text.split(/\s+/u)[1] : undefined;
      if (destination === undefined) {
        await this.dependencies.sessions.start(user.id, 'ticket_search', 'destination');
        await this.dependencies.gateway.sendMessage({
          chatId: message.chat.id,
          text: this.originPrompt(user.defaultOriginCode, language),
          replyMarkup: catalogTabsKeyboard({
            tripClass: user.preferredTripClass,
            baggageRequired: user.baggageRequired
          }, language)
        });
      } else {
        await this.dependencies.sessions.cancel(user.id);
        await this.resolveDestinationAndOpen(from.id, message.chat.id, destination);
      }
    } else if (command === '/subscriptions' || text === languageMessage(language, 'menuSubscriptions')) {
      const subscriptions = await this.dependencies.subscriptions.listForTelegramUser(from.id);
      if (subscriptions.length === 0) await this.send(message.chat.id, localized(language, 'Активных уведомлений нет.', 'Faol kuzatuvlar yo‘q.'));
      for (const subscription of subscriptions) {
        await this.dependencies.gateway.sendMessage({
          chatId: message.chat.id,
          text: presentSubscription(subscription, language),
          replyMarkup: subscriptionKeyboard(subscription.id, language)
        });
      }
    } else if (command === '/new_subscription' || text === languageMessage(language, 'menuNewSubscription')) {
      await this.dependencies.sessions.start(user.id, 'new_subscription', 'destination');
      await this.send(message.chat.id, localized(language, 'Куда летим? Введите название, IATA-код или ANY.', 'Qayerga uchamiz? Shahar nomi, IATA kodi yoki ANY kiriting.'));
    } else if (command === '/settings' || text === languageMessage(language, 'menuSettings')) {
      await this.dependencies.sessions.start(user.id, 'settings', 'origin');
      await this.dependencies.gateway.sendMessage({
        chatId: message.chat.id,
        text: localized(language, 'Выберите город вылета:', 'Uchish shahrini tanlang:'),
        replyMarkup: settingsOriginKeyboard(language)
      });
    } else if (command === '/profile' || text === languageMessage(language, 'menuProfile')) {
      await this.send(message.chat.id, [
        `${localized(language, 'Профиль', 'Profil')}: ${user.firstName ?? user.username ?? String(user.telegramUserId)}`,
        `${localized(language, 'Город вылета', 'Uchish shahri')}: ${formatLocalizedLocationLabel(user.defaultOriginCode, language)}`,
        `${localized(language, 'Валюта', 'Valyuta')}: ${DEFAULT_CURRENCY_CODE}`,
        `${localized(language, 'Класс', 'Klass')}: ${language === 'uz' ? (user.preferredTripClass === 'economy' ? 'Ekonom' : 'Biznes') : presentTripClass(user.preferredTripClass)}`,
        `${localized(language, 'Багаж', 'Bagaj')}: ${language === 'uz' ? (user.baggageRequired ? 'Faqat bagaj bilan' : 'Muhim emas') : presentBaggage(user.baggageRequired)}`,
        `${localized(language, 'Телефон', 'Telefon')}: ${user.phoneNumber === null ? localized(language, 'не указан', 'ko‘rsatilmagan') : localized(language, 'указан', 'ko‘rsatilgan')}`
      ].join('\n'));
    } else if (command === '/help') {
      await this.send(message.chat.id, '/start /tickets /subscriptions /new_subscription /settings /profile /help');
    } else {
      await this.send(message.chat.id, localized(language, 'Неизвестная команда. Используйте /help.', 'Noma’lum buyruq. /help dan foydalaning.'));
    }
  }

  private async sendTicketPage(
    telegramUserId: number,
    chatId: number,
    options: TicketListingOptions
  ): Promise<void> {
    const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
    const language = languageFromCode(user.languageCode);
    const page = await this.dependencies.tickets.listPageForTelegramUser(telegramUserId, options);
    if (page.tickets.length === 0) {
      await this.send(chatId, localized(language, 'Подходящие билеты не найдены.', 'Mos chiptalar topilmadi.'));
      return;
    }
    for (const ticket of page.tickets) {
      await this.dependencies.gateway.sendMessage({
        chatId,
        text: presentTicket(ticket, language),
        parseMode: 'HTML',
        replyMarkup: ticketKeyboard(this.dependencies.links?.create({
          ticket,
          source: 'bot_search',
          userId: user.id,
          subscriptionId: null
        }) ?? ticket.ticketLink, language)
      });
    }
    await this.dependencies.gateway.sendMessage({
      chatId,
      text: `${localized(language, 'Показано', 'Ko‘rsatildi')} ${page.offset + 1}–${page.offset + page.tickets.length}`,
      replyMarkup: ticketNavigationKeyboard(page, {
        tripClass: user.preferredTripClass,
        baggageRequired: user.baggageRequired
      }, language)
    });
  }

  private async handleSessionInput(telegramUserId: number, chatId: number, text: string): Promise<void> {
    const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
    const language = languageFromCode(user.languageCode);
    const state = await this.dependencies.sessions.getActiveState(user.id);
    if (state.session === null) {
      await this.send(chatId, state.expired
        ? localized(language, 'Сессия истекла. Начните действие заново.', 'Seans muddati tugadi. Amalni qaytadan boshlang.')
        : localized(language, 'Используйте команды из /help.', '/help dagi buyruqlardan foydalaning.'));
      return;
    }
    if (state.session.flow === 'settings') {
      await this.handleSettingsInput(telegramUserId, chatId, state.session, text, language);
      return;
    }
    if (state.session.flow === 'ticket_search') {
      const opened = await this.resolveDestinationAndOpen(telegramUserId, chatId, text, language);
      if (opened) await this.dependencies.sessions.cancel(state.session.userId);
      return;
    }
    if (state.session.flow === 'new_subscription') {
      await this.handleSubscriptionInput(telegramUserId, chatId, state.session, text, language);
    }
  }

  private async resolveDestinationAndOpen(
    telegramUserId: number,
    chatId: number,
    input: string,
    language?: AppLanguage
  ): Promise<boolean> {
    const resolvedLanguage = language ?? await this.languageForTelegramUser(telegramUserId);
    const resolution = resolveLocation(input);
    if (resolution.kind === 'not_found') {
      await this.send(
        chatId,
        localized(
          resolvedLanguage,
          'Город не найден. Введите название или IATA-код, например Стамбул или IST.',
          'Shahar topilmadi. Nom yoki IATA kodini kiriting, masalan Istanbul yoki IST.'
        )
      );
      return false;
    }
    if (resolution.kind === 'ambiguous') {
      await this.send(chatId, [
        localized(resolvedLanguage, 'Найдено несколько городов. Введите точный IATA-код:', 'Bir nechta shahar topildi. Aniq IATA kodini kiriting:'),
        ...resolution.candidates.slice(0, 8).map((candidate) => (
          formatLocalizedLocationLabel(candidate.code, resolvedLanguage)
        ))
      ].join('\n'));
      return false;
    }
    await this.sendTicketPage(telegramUserId, chatId, { destinationCode: resolution.code, offset: 0 });
    return true;
  }

  private async handleSettingsInput(
    telegramUserId: number,
    chatId: number,
    session: Awaited<ReturnType<SessionService['start']>>,
    text: string,
    language: AppLanguage
  ): Promise<void> {
    if (session.step === 'origin') {
      const resolution = resolveLocation(text);
      if (resolution.kind !== 'resolved' || !isUzbekistanOrigin(resolution.code)) {
        throw new ValidationError(localized(
          language,
          'Выберите город Узбекистана из списка',
          'Ro‘yxatdan O‘zbekiston shahrini tanlang'
        ));
      }
      await this.selectSettingsOrigin(
        telegramUserId,
        chatId,
        session,
        resolution.code,
        language
      );
      return;
    }
    if (session.step === 'trip_class') {
      const tripClass = this.tripClassFromText(text);
      if (tripClass === null) throw new ValidationError(localized(language, 'Введите Эконом или Бизнес', 'Ekonom yoki Biznes deb kiriting'));
      await this.dependencies.sessions.advance(session, 'baggage', { tripClass });
      await this.send(chatId, localized(language, 'Багаж: Не важно или Только с багажом?', 'Bagaj: Muhim emas yoki Faqat bagaj bilan?'));
      return;
    }
    if (session.step !== 'baggage') throw new ValidationError(localized(language, 'Некорректный шаг настроек', 'Sozlamalar qadami noto‘g‘ri'));
    const baggageRequired = this.baggageFromText(text);
    if (baggageRequired === null) {
      throw new ValidationError(localized(language, 'Введите Не важно или Только с багажом', 'Muhim emas yoki Faqat bagaj bilan deb kiriting'));
    }
    const tripClassValue = requirePayloadString(session.payload, 'tripClass');
    const tripClass = this.tripClassFromValue(tripClassValue);
    await this.dependencies.users.updateTicketPreferences(
      telegramUserId,
      tripClass,
      baggageRequired
    );
    await this.dependencies.sessions.cancel(session.userId);
    await this.send(chatId, localized(language, 'Настройки обновлены.', 'Sozlamalar yangilandi.'));
  }

  private async selectSettingsOrigin(
    telegramUserId: number,
    chatId: number,
    session: Awaited<ReturnType<SessionService['start']>>,
    originCode: string,
    language: AppLanguage
  ): Promise<void> {
    await this.dependencies.users.updateDefaultOrigin(telegramUserId, originCode);
    await this.dependencies.sessions.advance(session, 'trip_class', {
      ...session.payload,
      defaultOriginCode: originCode
    });
    await this.send(
      chatId,
      localized(language, 'Класс перелёта: Эконом или Бизнес?', 'Parvoz klassi: Ekonom yoki Biznes?')
    );
  }

  private tripClassFromText(text: string): TripClass | null {
    const normalized = text.trim().toLocaleLowerCase('ru-RU');
    if (normalized === 'эконом' || normalized === 'ekonom') return 'economy';
    if (normalized === 'бизнес' || normalized === 'biznes') return 'business';
    return null;
  }

  private tripClassFromValue(value: string): TripClass {
    if (value === 'economy' || value === 'business') return value;
    throw new ValidationError('Некорректный класс в сессии');
  }

  private baggageFromText(text: string): boolean | null {
    const normalized = text.trim().toLocaleLowerCase('ru-RU');
    if (normalized === 'не важно' || normalized === 'muhim emas') return false;
    if (normalized === 'только с багажом' || normalized === 'faqat bagaj bilan') return true;
    return null;
  }

  private async handleSubscriptionInput(
    telegramUserId: number,
    chatId: number,
    session: Awaited<ReturnType<SessionService['start']>>,
    text: string,
    language: AppLanguage
  ): Promise<void> {
    const payload = { ...session.payload };
    if (session.step === 'destination') {
      if (this.normalizedAnswer(text) === 'ANY' || this.normalizedAnswer(text) === 'ISTALGAN') {
        payload.destinationCode = null;
      } else {
        const resolution = resolveLocation(text);
        if (resolution.kind === 'not_found') {
          throw new ValidationError(
            localized(language, 'Город не найден. Введите название или IATA-код, например Стамбул или IST.', 'Shahar topilmadi. Nom yoki IATA kodini kiriting, masalan Istanbul yoki IST.')
          );
        }
        if (resolution.kind === 'ambiguous') {
          throw new ValidationError(`${localized(language, 'Введите точный IATA-код', 'Aniq IATA kodini kiriting')}: ${resolution.candidates
            .slice(0, 8)
            .map((candidate) => candidate.code)
            .join(', ')}`);
        }
        payload.destinationCode = resolution.code;
      }
      await this.advanceSubscription(session, 'date_from', payload, chatId, localized(language, 'Введите начальную дату YYYY-MM-DD.', 'Boshlanish sanasini YYYY-MM-DD formatida kiriting.'));
    } else if (session.step === 'date_from') {
      payload.departureDateFrom = assertIsoDate(text);
      await this.advanceSubscription(session, 'date_to', payload, chatId, localized(language, 'Введите конечную дату YYYY-MM-DD.', 'Tugash sanasini YYYY-MM-DD formatida kiriting.'));
    } else if (session.step === 'date_to') {
      const departureDateTo = assertIsoDate(text);
      if (departureDateTo < String(payload.departureDateFrom)) {
        throw new ValidationError(localized(language, 'Конечная дата раньше начальной', 'Tugash sanasi boshlanish sanasidan oldin'));
      }
      payload.departureDateTo = departureDateTo;
      await this.advanceSubscription(session, 'max_price', payload, chatId, localized(language, 'Введите максимальную цену или ANY.', 'Eng yuqori narxni yoki ANY ni kiriting.'));
    } else if (session.step === 'max_price') {
      payload.maxPrice = ['ANY', 'ISTALGAN'].includes(this.normalizedAnswer(text)) ? null : assertMoney(Number(text));
      await this.advanceSubscription(session, 'direct', payload, chatId, localized(language, 'Только прямой рейс? YES или NO.', 'Faqat to‘g‘ridan-to‘g‘ri reysmi? HA yoki YO‘Q.'));
    } else if (session.step === 'direct') {
      const answer = this.normalizedAnswer(text);
      if (!['YES', 'NO', 'HA', 'YOQ'].includes(answer)) throw new ValidationError(localized(language, 'Введите YES или NO', 'HA yoki YO‘Q deb kiriting'));
      payload.directOnly = answer === 'YES' || answer === 'HA';
      await this.advanceSubscription(session, 'round_trip', payload, chatId, localized(language, 'Только туда-обратно? YES или NO.', 'Faqat borib-kelishmi? HA yoki YO‘Q.'));
    } else if (session.step === 'round_trip') {
      const answer = this.normalizedAnswer(text);
      if (!['YES', 'NO', 'HA', 'YOQ'].includes(answer)) throw new ValidationError(localized(language, 'Введите YES или NO', 'HA yoki YO‘Q deb kiriting'));
      payload.roundTripOnly = answer === 'YES' || answer === 'HA';
      await this.advanceSubscription(session, 'confirm', payload, chatId, localized(language, 'Введите SAVE для сохранения.', 'Saqlash uchun SAQLASH deb kiriting.'));
    } else if (session.step === 'confirm') {
      if (!['SAVE', 'SAQLASH'].includes(this.normalizedAnswer(text))) throw new ValidationError(localized(language, 'Введите SAVE или начните заново', 'SAQLASH deb kiriting yoki qaytadan boshlang'));
      const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
      await this.dependencies.subscriptions.createForUser(user.id, {
        destinationCode: nullablePayloadString(payload, 'destinationCode'),
        departureDateFrom: requirePayloadString(payload, 'departureDateFrom'),
        departureDateTo: requirePayloadString(payload, 'departureDateTo'),
        maxPrice: nullablePayloadNumber(payload, 'maxPrice'),
        directOnly: requirePayloadBoolean(payload, 'directOnly'),
        roundTripOnly: requirePayloadBoolean(payload, 'roundTripOnly')
      });
      await this.dependencies.sessions.cancel(session.userId);
      await this.send(chatId, localized(language, 'Уведомление сохранено.', 'Kuzatuv saqlandi.'));
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

  private normalizedAnswer(text: string): string {
    return text.trim().toUpperCase().replace(/[‘’ʻʼ']/gu, '');
  }

  private originPrompt(originCode: string, language: AppLanguage): string {
    const origin = formatLocalizedLocationLabel(originCode, language);
    return localized(
      language,
      `Город вылета: ${origin}. Куда летим?`,
      `Uchish shahri: ${origin}. Qayerga uchamiz?`
    );
  }

  private async languageForTelegramUser(telegramUserId: number): Promise<AppLanguage> {
    try {
      const user = await this.dependencies.users.requireByTelegramUserId(telegramUserId);
      return languageFromCode(user.languageCode);
    } catch {
      return 'ru';
    }
  }

  private errorText(
    error: unknown,
    language: AppLanguage,
    russianFallback: string,
    uzbekFallback: string
  ): string {
    if (!(error instanceof ValidationError)) return localized(language, russianFallback, uzbekFallback);
    if (language === 'ru' || !/[А-Яа-яЁё]/u.test(error.message)) return error.message;
    const translations: Readonly<Record<string, string>> = {
      'Нельзя сохранить чужой контакт': 'Boshqa foydalanuvchining kontaktini saqlab bo‘lmaydi',
      'Номер телефона пуст': 'Telefon raqami bo‘sh',
      'Сначала выполните /start': 'Avval botda /start buyrug‘ini yuboring',
      'Некорректная страница': 'Noto‘g‘ri sahifa',
      'Некорректная дата': 'Sana noto‘g‘ri',
      'Некорректная цена': 'Narx noto‘g‘ri',
      'Начальная дата позже конечной': 'Boshlanish sanasi tugash sanasidan keyin',
      'Достигнут лимит 20 активных подписок': '20 ta faol kuzatuv chegarasiga yetildi'
    };
    return translations[error.message] ?? uzbekFallback;
  }

  private async send(chatId: number, text: string): Promise<void> {
    await this.dependencies.gateway.sendMessage({ chatId, text });
  }
}
