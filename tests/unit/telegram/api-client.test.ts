import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../../src/infrastructure/telegram/api-client.js';
import { TelegramBotApiClient } from '../../../src/infrastructure/telegram/api-client.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('TelegramBotApiClient', () => {
  it('получает только message и callback_query начиная с offset', async () => {
    let requestUrl = '';
    let requestBody: unknown;
    const fetch: FetchLike = (input, init) => {
      requestUrl = String(input);
      if (typeof init?.body !== 'string') throw new TypeError('Ожидался JSON body');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(jsonResponse({ ok: true, result: [] }));
    };
    const client = new TelegramBotApiClient('123:secret', fetch);

    await expect(client.getUpdates(
      { offset: 17, timeoutSeconds: 50 },
      new AbortController().signal
    )).resolves.toEqual([]);
    expect(requestUrl).toBe('https://api.telegram.org/bot123:secret/getUpdates');
    expect(requestBody).toEqual({
      offset: 17,
      timeout: 50,
      allowed_updates: ['message', 'callback_query']
    });
  });

  it('изолирует повреждённый update с корректным update_id', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({
      ok: true,
      result: [
        { update_id: 7, message: { chat: null } },
        { update_id: 8 }
      ]
    }));
    const client = new TelegramBotApiClient('123:secret', fetch);

    await expect(client.getUpdates(
      { offset: 7, timeoutSeconds: 50 },
      new AbortController().signal
    )).resolves.toEqual([
      { updateId: 7, message: null, callbackQuery: null, malformed: true },
      { updateId: 8, message: null, callbackQuery: null }
    ]);
  });

  it('отправляет message и возвращает message id', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({ ok: true, result: { message_id: 45 } }));
    const client = new TelegramBotApiClient('123:secret', fetch);
    await expect(client.sendMessage({ chatId: 200, text: 'Привет' }))
      .resolves.toEqual({ messageId: 45 });
  });

  it('удаляет старый webhook без потери pending updates', async () => {
    let body: unknown;
    const fetch: FetchLike = (_input, init) => {
      if (typeof init?.body !== 'string') throw new TypeError('Ожидался JSON body');
      body = JSON.parse(init.body) as unknown;
      return Promise.resolve(jsonResponse({ ok: true, result: true }));
    };
    const client = new TelegramBotApiClient('123:secret', fetch);
    await client.deleteWebhook();
    expect(body).toEqual({ drop_pending_updates: false });
  });

  it('не раскрывает token при Telegram error', async () => {
    const token = '123:top-secret';
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({
      ok: false,
      error_code: 401,
      description: `Unauthorized ${token}`
    }));
    const client = new TelegramBotApiClient(token, fetch);
    let message = '';
    try {
      await client.sendMessage({ chatId: 1, text: 'x' });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(token);
    expect(message).toContain('sendMessage');
  });

  it('отклоняет некорректный response envelope', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse({ ok: true, result: 'wrong' }));
    const client = new TelegramBotApiClient('123:secret', fetch);
    await expect(client.getUpdates(
      { offset: 0, timeoutSeconds: 1 },
      new AbortController().signal
    )).rejects.toThrow('result');
  });
});
