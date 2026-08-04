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
  readonly databasePath: string;
  readonly pollTimeoutSeconds: number;
  readonly updateMaxAttempts: number;
  readonly aviasales: AppConfig;
}

function requiredSecret(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new ValidationError(`Отсутствует ${name}`);
  }
  return normalized;
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

export function loadVdsConfig(input: NodeJS.ProcessEnv): VdsConfig {
  return {
    telegramBotToken: requiredSecret(input.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
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
    })
  };
}
