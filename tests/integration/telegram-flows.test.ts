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
  it('показывает билеты по кнопке меню без разбора текста кнопки как IATA', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.store.upsert(createTicket({}), fixture.clock.now());

    await fixture.router.handleMessage({ ...startMessage, text: '🔥 Горящие билеты' });

    expect(fixture.gateway.messages.at(-1)?.text).toContain('<b>TAS → IST</b>');
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

  it('обновляет origin и currency через settings flow', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    await fixture.router.handleMessage({ ...startMessage, text: '/settings' });
    await fixture.router.handleMessage({ ...startMessage, text: 'SKD' });
    await fixture.router.handleMessage({ ...startMessage, text: 'USD' });

    expect(await fixture.store.findByTelegramUserId(100)).toMatchObject({
      defaultOriginCode: 'SKD',
      preferredCurrencyCode: 'USD'
    });
  });
});

describe('подписки и сессии', () => {
  it('создаёт подписку через последовательный flow', async () => {
    const fixture = createFixture();
    await fixture.router.handleMessage(startMessage);
    for (const text of [
      '/new_subscription',
      'TAS',
      'IST',
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
      originCode: 'TAS',
      destinationCode: 'IST',
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-10',
      departureDateTo: '2026-09-20',
      maxPrice: null,
      directOnly: false,
      baggageRequired: false
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
      data: `subscription:disable:${subscription.id}`
    });

    expect((await fixture.store.listByUser(owner.id))[0]?.isActive).toBe(true);
    expect(fixture.gateway.callbackAnswers.at(-1)?.text).toContain('не найдена');
  });
});
