import { describe, expect, it } from 'vitest';

import type { Clock, TelegramGateway } from '../../src/application/ports.js';
import { TelegramBotRouter } from '../../src/application/bot-router.js';
import { SessionService } from '../../src/application/sessions.js';
import { SubscriptionService } from '../../src/application/subscriptions.js';
import { TicketService } from '../../src/application/tickets.js';
import type {
  TelegramCallbackAnswer,
  TelegramMessageInput
} from '../../src/application/models.js';
import { UserService } from '../../src/application/users.js';
import { ValidationError } from '../../src/domain/errors.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { MemoryStore } from '../../src/infrastructure/memory/store.js';

class MutableClock implements Clock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class FakeTelegramGateway implements TelegramGateway {
  public readonly messages: TelegramMessageInput[] = [];
  public readonly callbackAnswers: TelegramCallbackAnswer[] = [];

  public sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }> {
    this.messages.push(input);
    return Promise.resolve({ messageId: this.messages.length });
  }

  public answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void> {
    this.callbackAnswers.push(input);
    return Promise.resolve();
  }
}

function createTicket(overrides: Partial<Ticket>): Ticket {
  return {
    externalKey: `key-${String(overrides.destinationCode ?? 'IST')}-${String(overrides.price ?? 1)}`,
    originCode: 'TAS',
    destinationCode: 'IST',
    departureDate: '2026-09-15',
    departureAt: null,
    price: 1_850_000,
    currencyCode: 'UZS',
    airlineCode: null,
    airlineName: null,
    isDirect: false,
    tripClass: 'economy',
    hasBaggage: false,
    ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
    rawTicketLink: null,
    rawPayload: {},
    ...overrides
  };
}

function createFixture(): {
  clock: MutableClock;
  store: MemoryStore;
  gateway: FakeTelegramGateway;
  users: UserService;
  tickets: TicketService;
  subscriptions: SubscriptionService;
  sessions: SessionService;
  router: TelegramBotRouter;
} {
  const clock = new MutableClock(new Date('2026-08-04T12:00:00Z'));
  const store = new MemoryStore(clock);
  const gateway = new FakeTelegramGateway();
  const users = new UserService(store, clock);
  const tickets = new TicketService(store, store, clock);
  const subscriptions = new SubscriptionService(store, store, clock);
  const sessions = new SessionService(store, clock);
  const router = new TelegramBotRouter({ users, tickets, subscriptions, sessions, gateway });
  return { clock, store, gateway, users, tickets, subscriptions, sessions, router };
}

const startMessage = {
  chat: { id: 200 },
  from: {
    id: 100,
    username: 'traveler',
    first_name: 'Ali',
    last_name: null,
    language_code: 'ru'
  },
  text: '/start'
};

describe('регистрация и профиль', () => {
  it('первый /start создаёт пользователя, повторный обновляет без дубликата', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.router.handleMessage({
      ...startMessage,
      from: { ...startMessage.from, first_name: 'Alisher' }
    });

    const user = await fixture.store.findByTelegramUserId(100);
    expect(user).toMatchObject({ firstName: 'Alisher', telegramChatId: 200 });
    expect(fixture.gateway.messages.at(-1)?.text).toContain('Главное меню');
  });

  it('принимает только собственный контакт', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.router.handleMessage({
      chat: { id: 200 },
      from: startMessage.from,
      contact: { user_id: 100, phone_number: '+998901234567' }
    });
    expect((await fixture.store.findByTelegramUserId(100))?.phoneNumber).toBe('+998901234567');

    await fixture.router.handleMessage({
      chat: { id: 200 },
      from: startMessage.from,
      contact: { user_id: 999, phone_number: '+998909999999' }
    });
    expect(fixture.gateway.messages.at(-1)?.text).toContain('чужой контакт');
    expect((await fixture.store.findByTelegramUserId(100))?.phoneNumber).toBe('+998901234567');
  });
});

describe('билеты и настройки', () => {
  it('запрашивает направление и принимает русское название', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.store.upsert(createTicket({}), fixture.clock.now());

    await fixture.router.handleMessage({ ...startMessage, text: '🔥 Горящие билеты' });
    expect(fixture.gateway.messages.at(-1)?.text)
      .toBe('Вылет из Ташкента (TAS). Куда летим?');
    expect(JSON.stringify(fixture.gateway.messages.at(-1)?.replyMarkup))
      .toContain('Все направления из Ташкента');
    await fixture.router.handleMessage({ ...startMessage, text: 'Стамбул' });

    expect(fixture.gateway.messages.at(-2)?.text)
      .toContain('<b>Ташкент (TAS) → Стамбул (IST)</b>');
    expect(fixture.gateway.messages.at(-1)?.text).toBe('Показано 1–1');
  });

  it('открывает /tickets IST без вопроса и безопасно обрабатывает неизвестный город', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.store.upsert(createTicket({}), fixture.clock.now());

    await fixture.router.handleMessage({ ...startMessage, text: '/tickets IST' });
    expect(fixture.gateway.messages.some((message) => message.text.includes('Стамбул (IST)'))).toBe(true);

    await fixture.router.handleMessage({ ...startMessage, text: '/tickets' });
    await fixture.router.handleMessage({ ...startMessage, text: 'Стамблл' });
    expect(fixture.gateway.messages.at(-1)?.text)
      .toBe('Город не найден. Введите название или IATA-код, например Стамбул или IST.');
  });

  it('сортирует и фильтрует активные билеты', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.store.upsert(createTicket({ price: 2_000_000, departureDate: '2026-09-20' }), fixture.clock.now());
    await fixture.store.upsert(createTicket({
      externalKey: 'key-dxb',
      destinationCode: 'DXB',
      price: 1_500_000,
      departureDate: '2026-09-10',
      isDirect: true
    }), fixture.clock.now());

    const byPrice = await fixture.tickets.listForTelegramUser(100, {});
    expect(byPrice.map((ticket) => ticket.destinationCode)).toEqual(['DXB', 'IST']);

    const filtered = await fixture.tickets.listForTelegramUser(100, {
      destinationCode: 'IST',
      sort: 'departure_date_asc'
    });
    expect(filtered.map((ticket) => ticket.destinationCode)).toEqual(['IST']);
  });

  it('обновляет класс и багаж через settings flow', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.router.handleMessage({ ...startMessage, text: '/settings' });
    expect(fixture.gateway.messages.at(-1)?.text).toContain('Класс перелёта');
    await fixture.router.handleMessage({ ...startMessage, text: 'Бизнес' });
    await fixture.router.handleMessage({ ...startMessage, text: 'Только с багажом' });

    expect(await fixture.store.findByTelegramUserId(100)).toMatchObject({
      defaultOriginCode: 'TAS',
      preferredCurrencyCode: 'UZS',
      preferredTripClass: 'business',
      baggageRequired: true
    });
  });

  it('показывает фиксированные TAS/UZS и текущие фильтры в профиле', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.users.updateTicketPreferences(100, 'business', true);
    await fixture.router.handleMessage({ ...startMessage, text: '/profile' });

    expect(fixture.gateway.messages.at(-1)?.text).toContain('Город вылета: Ташкент (TAS)');
    expect(fixture.gateway.messages.at(-1)?.text).toContain('Валюта: UZS');
    expect(fixture.gateway.messages.at(-1)?.text).toContain('Класс: Бизнес');
    expect(fixture.gateway.messages.at(-1)?.text).toContain('Багаж: Только с багажом');
  });

  it('открывает следующую страницу callback-ом текущего пользователя', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    for (let index = 1; index <= 11; index += 1) {
      await fixture.store.upsert(createTicket({
        externalKey: `ticket-${index}`,
        price: 1_000_000 + index,
        ticketLink: `https://www.aviasales.uz/search/TAS1509IST${index}`
      }), fixture.clock.now());
    }

    await fixture.router.handleCallbackQuery({
      id: 'tickets-page-2',
      from: { id: 100 },
      chatId: 200,
      data: 'tickets:ALL:10:E0'
    });

    expect(fixture.gateway.messages.at(-2)?.text).toContain('Стамбул (IST)');
    expect(fixture.gateway.messages.at(-1)?.text).toBe('Показано 11–11');
    expect(fixture.gateway.callbackAnswers.at(-1)).toEqual({
      callbackQueryId: 'tickets-page-2'
    });
  });
});

describe('подписки и сессии', () => {
  it('создаёт подписку через последовательный flow', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    for (const text of [
      '/new_subscription',
      'Стамбул',
      '2026-09-10',
      '2026-09-20',
      '2000000',
      'NO',
      'SAVE'
    ]) {
      await fixture.router.handleMessage({ ...startMessage, text });
    }

    const user = await fixture.store.findByTelegramUserId(100);
    expect(await fixture.store.listByUser(user?.id ?? 0)).toMatchObject([{
      originCode: 'TAS',
      destinationCode: 'IST',
      maxPrice: 2_000_000,
      directOnly: false,
      baggageRequired: false,
      isActive: true
    }]);
    expect(await fixture.sessions.getActive(user?.id ?? 0)).toBeNull();
  });

  it('отбрасывает просроченную сессию через 30 минут', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.router.handleMessage({ ...startMessage, text: '/new_subscription' });
    fixture.clock.advance(31 * 60 * 1_000);
    await fixture.router.handleMessage({ ...startMessage, text: 'TAS' });

    expect(fixture.gateway.messages.at(-1)?.text).toContain('Сессия истекла');
  });

  it('ограничивает пользователя двадцатью активными подписками', async () => {
    const fixture = createFixture();
    const user = fixture.store.seedUser({ telegramUserId: 100, telegramChatId: 200 });
    for (let id = 0; id < 20; id += 1) {
      fixture.store.seedSubscription({
        userId: user.id,
        originCode: 'TAS',
        destinationCode: null,
        currencyCode: 'UZS',
        departureDateFrom: '2026-09-10',
        departureDateTo: '2026-09-20',
        maxPrice: null,
        directOnly: false,
        baggageRequired: false,
        isActive: true
      });
    }

    await expect(fixture.subscriptions.createForUser(user.id, {
      destinationCode: 'IST',
      departureDateFrom: '2026-09-10',
      departureDateTo: '2026-09-20',
      maxPrice: null,
      directOnly: false
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('не позволяет отключить чужую подписку через callback', async () => {
    const fixture = createFixture();
    const owner = fixture.store.seedUser({ telegramUserId: 100, telegramChatId: 200 });
    const stranger = fixture.store.seedUser({ telegramUserId: 101, telegramChatId: 201 });
    const subscription = fixture.store.seedSubscription({
      userId: owner.id,
      originCode: 'TAS',
      destinationCode: null,
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-10',
      departureDateTo: '2026-09-20',
      maxPrice: null,
      directOnly: false,
      baggageRequired: false,
      isActive: true
    });

    await fixture.router.handleCallbackQuery({
      id: 'callback-1',
      from: { id: stranger.telegramUserId },
      chatId: stranger.telegramChatId,
      data: `subscription:disable:${subscription.id}`
    });

    expect((await fixture.store.listByUser(owner.id))[0]?.isActive).toBe(true);
    expect(fixture.gateway.callbackAnswers.at(-1)?.text).toContain('не найдена');
  });
});
