import { createHmac, timingSafeEqual } from 'node:crypto';

import { ValidationError } from './errors.js';

export interface TelegramMiniAppUser {
  readonly id: number;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly languageCode: string | null;
}

function optionalJsonString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function validateMiniAppInitData(
  rawInitData: string,
  botToken: string,
  now: Date,
  maxAgeSeconds: number
): TelegramMiniAppUser {
  const parameters = new URLSearchParams(rawInitData);
  const receivedHash = parameters.get('hash');
  if (receivedHash === null || !/^[a-f0-9]{64}$/u.test(receivedHash)) {
    throw new ValidationError('Некорректная подпись Telegram');
  }
  parameters.delete('hash');
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const expected = Buffer.from(expectedHash);
  const actual = Buffer.from(receivedHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ValidationError('Некорректная подпись Telegram');
  }

  const authDate = Number(parameters.get('auth_date'));
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || nowSeconds - authDate > maxAgeSeconds) {
    throw new ValidationError('Сессия Telegram устарела');
  }
  if (authDate > nowSeconds + 30) throw new ValidationError('Некорректное время Telegram');

  const rawUser = parameters.get('user');
  if (rawUser === null) throw new ValidationError('Telegram не передал пользователя');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser) as unknown;
  } catch {
    throw new ValidationError('Некорректный пользователь Telegram');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError('Некорректный пользователь Telegram');
  }
  const user = parsed as Readonly<Record<string, unknown>>;
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new ValidationError('Некорректный Telegram ID');
  }
  return {
    id: user.id,
    firstName: optionalJsonString(user.first_name),
    lastName: optionalJsonString(user.last_name),
    username: optionalJsonString(user.username),
    languageCode: optionalJsonString(user.language_code)
  };
}
