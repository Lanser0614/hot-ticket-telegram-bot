import { ValidationError } from './domain/errors.js';

export interface AppConfig {
  aviasalesExploreBaseUrl: string;
  aviasalesMarket: string;
  aviasalesLanguage: string;
  aviasalesPassportCountry: string;
}

export interface ConfigInput {
  AVIASALES_EXPLORE_BASE_URL?: string;
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

