import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationInput } from '../../src/application/models.js';
import type { Subscription } from '../../src/domain/subscription.js';
import type { SdkFetch, TelegramApi } from 'sdk';
import { TimeoutError } from '../../src/infrastructure/aviasales/client.js';
import { SdkTextHttpClient } from '../../src/platform/telegram/http.js';
import { TelegramApiAdapter } from '../../src/platform/telegram/notifier.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('SdkTextHttpClient', () => {
  it('передаёт GET и Accept в sdk/fetch', async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Readonly<Record<string, string>> } }> = [];
    const fetch: SdkFetch = (url, init) => {
      calls.push(init === undefined ? { url } : { url, init });
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        ok: true,
        url,
        headers: {
          get: () => null,
          has: () => false,
          keys: function* () {},
          entries: function* () {}
        },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{"directions":[]}')
      });
    };

    await expect(new SdkTextHttpClient(fetch).get(
      new URL('https://example.test/data'),
      10_000,
      { Accept: 'application/json' }
    )).resolves.toEqual({ status: 200, body: '{"directions":[]}' });
    expect(calls[0]).toMatchObject({
      url: 'https://example.test/data',
      init: { method: 'GET', headers: { Accept: 'application/json' } }
    });
  });

  it('прерывает ожидание по timeout race', async () => {
    vi.useFakeTimers();
    const fetch: SdkFetch = () => new Promise(() => undefined);
    const result = new SdkTextHttpClient(fetch).get(
      new URL('https://example.test/slow'),
      10_000,
      { Accept: 'application/json' }
    );
    const expectation = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
  });
});

describe('TelegramApiAdapter', () => {
  it('отправляет уведомление и возвращает message_id', async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const api: TelegramApi = {
      sendMessage(parameters) {
        calls.push(parameters);
        return Promise.resolve({ message_id: 777 });
      },
      answerCallbackQuery() {
        return Promise.resolve({});
      }
    };
    const adapter = new TelegramApiAdapter(api);
    const subscription: Subscription = {
      id: 2,
      userId: 1,
      originCode: 'TAS',
      destinationCode: 'IST',
      currencyCode: 'UZS',
      departureDateFrom: '2026-09-10',
      departureDateTo: '2026-09-20',
      maxPrice: 2_000_000,
      directOnly: false,
      baggageRequired: false,
      isActive: true
    };
    const input: NotificationInput = {
      type: 'new_ticket',
      subscription,
      user: {
        id: 1,
        telegramUserId: 100,
        telegramChatId: 200,
        username: null,
        firstName: 'Ali',
        lastName: null,
        phoneNumber: null,
        languageCode: 'ru',
        defaultOriginCode: 'TAS',
        preferredCurrencyCode: 'UZS',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      ticket: {
        id: 3,
        externalKey: 'key',
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
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };

    await expect(adapter.send(input)).resolves.toEqual({ telegramMessageId: 777 });
    expect(calls[0]).toMatchObject({ chat_id: 200, parse_mode: 'HTML' });
    expect(String(calls[0]?.text)).toContain('Найден новый горячий билет');
  });
});
