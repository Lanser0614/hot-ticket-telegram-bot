import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildAffiliateLink } from '../../../src/domain/affiliate-link.js';
import { signClickPayload, verifyClickSignature } from '../../../src/domain/click-signature.js';
import { classifyUserAgent } from '../../../src/domain/click-tracking.js';
import { ValidationError } from '../../../src/domain/errors.js';
import { validateMiniAppInitData } from '../../../src/domain/miniapp-auth.js';

const botToken = '123456:test-token';
const now = new Date('2026-08-21T10:00:00Z');

function signedInitData(overrides: Readonly<Record<string, string>> = {}): string {
  const parameters = new URLSearchParams({
    auth_date: String(Math.floor(now.getTime() / 1_000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({
      id: 42,
      first_name: 'Ali',
      username: 'traveler',
      language_code: 'ru'
    }),
    ...overrides
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  parameters.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return parameters.toString();
}

describe('Telegram Mini App initData', () => {
  it('принимает свежие initData с верной подписью', () => {
    expect(validateMiniAppInitData(signedInitData(), botToken, now, 900)).toEqual({
      id: 42,
      firstName: 'Ali',
      lastName: null,
      username: 'traveler',
      languageCode: 'ru'
    });
  });

  it('отклоняет подменённого пользователя', () => {
    const parameters = new URLSearchParams(signedInitData());
    parameters.set('user', JSON.stringify({ id: 99, first_name: 'Mallory' }));

    expect(() => validateMiniAppInitData(parameters.toString(), botToken, now, 900))
      .toThrow(ValidationError);
  });

  it('отклоняет просроченную сессию', () => {
    const oldAuthDate = String(Math.floor(now.getTime() / 1_000) - 901);

    expect(() => validateMiniAppInitData(
      signedInitData({ auth_date: oldAuthDate }),
      botToken,
      now,
      900
    )).toThrow('Сессия Telegram устарела');
  });
});

describe('подписанные переходы и маркер', () => {
  const payload = {
    ticketId: 7,
    source: 'miniapp_card' as const,
    userId: 3,
    subscriptionId: null
  };

  it('не позволяет подменить ticket или source в tracking URL', () => {
    const signature = signClickPayload(payload, 'a'.repeat(32));

    expect(verifyClickSignature(payload, signature, 'a'.repeat(32))).toBe(true);
    expect(verifyClickSignature({ ...payload, ticketId: 8 }, signature, 'a'.repeat(32))).toBe(false);
    expect(verifyClickSignature({ ...payload, source: 'bot_search' }, signature, 'a'.repeat(32)))
      .toBe(false);
  });

  it('добавляет marker, source и click id в партнёрскую ссылку', () => {
    const result = new URL(buildAffiliateLink(
      'https://www.aviasales.uz/search/TAS1509IST1',
      'miniapp_card',
      81,
      {
        marker: 'partner-7',
        template: 'https://www.aviasales.uz/search/{search_code}?marker={marker}&sub_id={sub_id}&sub_id1={sub_id1}'
      }
    ));

    expect(result.pathname).toBe('/search/TAS1509IST1');
    expect(Object.fromEntries(result.searchParams)).toEqual({
      marker: 'partner-7',
      sub_id: 'miniapp_card',
      sub_id1: '81'
    });
  });

  it('отделяет Telegram preview от человеческого клика', () => {
    expect(classifyUserAgent('TelegramBot (like TwitterBot)')).toBe('telegram_preview');
    expect(classifyUserAgent('Mozilla/5.0 Telegram-Android')).toBe('human');
    expect(classifyUserAgent('Googlebot/2.1')).toBe('bot');
  });
});
