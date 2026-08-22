import { ValidationError } from './domain/errors.js';

export interface AppConfig {
  aviasalesExploreBaseUrl: string;
  aviasalesMarket: string;
  aviasalesLanguage: string;
  aviasalesPassportCountry: string;
}

export interface ConfigInput {
  AVIASALES_EXPLORE_BASE_URL?: string | undefined;
}

export interface VdsConfig {
  readonly telegramBotToken: string;
  readonly telegramBotUsername: string | null;
  readonly databasePath: string;
  readonly pollTimeoutSeconds: number;
  readonly updateMaxAttempts: number;
  readonly aviasales: AppConfig;
  readonly tracking: TrackingConfig;
}

export interface TrackingConfig {
  readonly publicBaseUrl: string | null;
  readonly clickSigningSecret: string | null;
  readonly affiliateMarker: string | null;
  readonly affiliateLinkTemplate: string;
}

export interface WebConfig {
  readonly host: string;
  readonly port: number;
  readonly authMaxAgeSeconds: number;
}

export interface AdminConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

function requiredSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new ValidationError(`Отсутствует ${name}`);
  }
  return normalized;
}

function optionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function optionalHttpsUrl(value: string | undefined, name: string): string | null {
  const normalized = optionalString(value);
  if (normalized === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ValidationError(`Некорректный ${name}`);
  }
  if (parsed.protocol !== 'https:') throw new ValidationError(`${name} должен использовать HTTPS`);
  return parsed.toString();
}

function boundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value === undefined || value.trim().length === 0) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ValidationError(`${name} должен быть целым числом от ${minimum} до ${maximum}`);
  }
  return parsed;
}

export function loadConfig(input: ConfigInput): AppConfig {
  const rawBaseUrl = input.AVIASALES_EXPLORE_BASE_URL?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    throw new ValidationError('Отсутствует AVIASALES_EXPLORE_BASE_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new ValidationError('Некорректный AVIASALES_EXPLORE_BASE_URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new ValidationError('AVIASALES_EXPLORE_BASE_URL должен использовать HTTPS');
  }

  return {
    aviasalesExploreBaseUrl: parsed.toString(),
    aviasalesMarket: 'uz',
    aviasalesLanguage: 'ru',
    aviasalesPassportCountry: 'UZ'
  };
}

export function loadAdminConfig(input: NodeJS.ProcessEnv): AdminConfig {
  return {
    host: input.ADMIN_HOST?.trim() || '127.0.0.1',
    port: boundedInteger(input.ADMIN_PORT, 8080, 1, 65_535, 'ADMIN_PORT'),
    username: requiredSecret(input.ADMIN_USERNAME, 'ADMIN_USERNAME'),
    password: requiredSecret(input.ADMIN_PASSWORD, 'ADMIN_PASSWORD')
  };
}

export function loadWebConfig(input: NodeJS.ProcessEnv): WebConfig {
  return {
    host: input.WEB_HOST?.trim() || '127.0.0.1',
    port: boundedInteger(input.WEB_PORT, 8081, 1, 65_535, 'WEB_PORT'),
    authMaxAgeSeconds: boundedInteger(
      input.MINIAPP_AUTH_MAX_AGE_SECONDS,
      900,
      60,
      86_400,
      'MINIAPP_AUTH_MAX_AGE_SECONDS'
    )
  };
}

export function loadVdsConfig(input: NodeJS.ProcessEnv): VdsConfig {
  const publicBaseUrl = optionalHttpsUrl(input.PUBLIC_BASE_URL, 'PUBLIC_BASE_URL');
  const clickSigningSecret = optionalString(input.CLICK_SIGNING_SECRET);
  if (clickSigningSecret !== null && clickSigningSecret.length < 32) {
    throw new ValidationError('CLICK_SIGNING_SECRET должен содержать не менее 32 символов');
  }
  return {
    telegramBotToken: requiredSecret(input.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
    telegramBotUsername: normalizeBotUsername(input.TELEGRAM_BOT_USERNAME),
    databasePath: input.DATABASE_PATH?.trim() || './data/hot-ticket-bot.sqlite',
    pollTimeoutSeconds: boundedInteger(
      input.TELEGRAM_POLL_TIMEOUT_SECONDS,
      50,
      1,
      50,
      'TELEGRAM_POLL_TIMEOUT_SECONDS'
    ),
    updateMaxAttempts: boundedInteger(
      input.TELEGRAM_UPDATE_MAX_ATTEMPTS,
      3,
      1,
      5,
      'TELEGRAM_UPDATE_MAX_ATTEMPTS'
    ),
    aviasales: loadConfig({
      AVIASALES_EXPLORE_BASE_URL: input.AVIASALES_EXPLORE_BASE_URL
    }),
    tracking: {
      publicBaseUrl,
      clickSigningSecret,
      affiliateMarker: optionalString(input.AFFILIATE_MARKER),
      affiliateLinkTemplate: input.AFFILIATE_LINK_TEMPLATE?.trim()
        || 'https://www.aviasales.uz/search/{search_code}?marker={marker}&sub_id={sub_id}&sub_id1={sub_id1}'
    }
  };
}

function normalizeBotUsername(value: string | undefined): string | null {
  const normalized = optionalString(value)?.replace(/^@/u, '') ?? null;
  if (normalized === null) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/u.test(normalized)) {
    throw new ValidationError('Некорректный TELEGRAM_BOT_USERNAME');
  }
  return normalized;
}
