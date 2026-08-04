import { describe, expect, it } from 'vitest';

import { parseTelegramUpdate } from '../../../src/infrastructure/telegram/updates.js';

describe('parseTelegramUpdate', () => {
  it('разбирает message с contact', () => {
    expect(parseTelegramUpdate({
      update_id: 7,
      message: {
        chat: { id: 200 },
        from: { id: 100, first_name: 'Ali', language_code: 'ru' },
        text: '/start',
        contact: { user_id: 100, phone_number: '+998901234567' }
      }
    })).toEqual({
      updateId: 7,
      message: {
        chat: { id: 200 },
        from: { id: 100, first_name: 'Ali', language_code: 'ru' },
        text: '/start',
        contact: { user_id: 100, phone_number: '+998901234567' }
      },
      callbackQuery: null
    });
  });

  it('разбирает callback query', () => {
    expect(parseTelegramUpdate({
      update_id: 8,
      callback_query: { id: 'callback-1', from: { id: 100 }, data: 'subscription:disable:3' }
    })).toEqual({
      updateId: 8,
      message: null,
      callbackQuery: { id: 'callback-1', from: { id: 100 }, data: 'subscription:disable:3' }
    });
  });

  it('пропускает неподдерживаемый payload, сохраняя update id', () => {
    expect(parseTelegramUpdate({ update_id: 9, edited_message: {} })).toEqual({
      updateId: 9,
      message: null,
      callbackQuery: null
    });
  });

  it.each([null, [], {}, { update_id: 1.5 }, { update_id: 1, message: {} }])(
    'отклоняет некорректный update %#',
    (value) => expect(() => parseTelegramUpdate(value)).toThrow(TypeError)
  );
});
