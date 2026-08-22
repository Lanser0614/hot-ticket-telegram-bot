import { ValidationError } from './errors.js';

export const CLICK_SOURCES = [
  'bot_search',
  'bot_notification',
  'bot_share',
  'miniapp_deals',
  'miniapp_card',
  'miniapp_watchlist'
] as const;

export type ClickSource = typeof CLICK_SOURCES[number];
export type UserAgentKind = 'human' | 'telegram_preview' | 'bot';

export function parseClickSource(value: string): ClickSource {
  if ((CLICK_SOURCES as readonly string[]).includes(value)) return value as ClickSource;
  throw new ValidationError('Некорректный источник перехода');
}

export function classifyUserAgent(value: string | undefined): UserAgentKind {
  const normalized = value?.toLocaleLowerCase('en-US') ?? '';
  if (normalized.includes('telegrambot')) return 'telegram_preview';
  if (/(?:bot\b|\bcrawler\b|\bspider\b|\bslurp\b|\bpreview\b)/u.test(normalized)) return 'bot';
  return 'human';
}
