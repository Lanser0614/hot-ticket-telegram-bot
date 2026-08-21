import type { AppLanguage } from './language.js';
import { message } from './language.js';
import { getLocalizedLocationName, UZBEKISTAN_ORIGIN_CODES } from '../domain/locations.js';

export function languageKeyboard(): unknown {
  return {
    inline_keyboard: [[
      { text: '🇺🇿 O‘zbekcha', callback_data: 'onboarding:language:uz' },
      { text: '🇷🇺 Русский', callback_data: 'onboarding:language:ru' }
    ]]
  };
}

export function originKeyboard(language: AppLanguage): unknown {
  const buttons = UZBEKISTAN_ORIGIN_CODES.map((code) => ({
    text: `${getLocalizedLocationName(code, language) ?? code} (${code})`,
    callback_data: `onboarding:origin:${language}:${code}`
  }));
  const rows: Array<typeof buttons> = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return { inline_keyboard: rows };
}

export function settingsOriginKeyboard(language: AppLanguage): unknown {
  const buttons = UZBEKISTAN_ORIGIN_CODES.map((code) => ({
    text: `${getLocalizedLocationName(code, language) ?? code} (${code})`,
    callback_data: `settings:origin:${code}`
  }));
  const rows: Array<typeof buttons> = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }
  return { inline_keyboard: rows };
}

export function mainKeyboard(language: AppLanguage = 'ru'): unknown {
  return {
    keyboard: [
      [{ text: message(language, 'menuDeals') }],
      [{ text: message(language, 'menuSubscriptions') }, { text: message(language, 'menuNewSubscription') }],
      [{ text: message(language, 'menuSettings') }, { text: message(language, 'menuProfile') }]
    ],
    resize_keyboard: true
  };
}

export function ticketKeyboard(url: string, language: AppLanguage = 'ru'): unknown {
  return { inline_keyboard: [[{ text: message(language, 'viewTicket'), url }]] };
}

export function subscriptionKeyboard(subscriptionId: number, language: AppLanguage = 'ru'): unknown {
  return {
    inline_keyboard: [[{
      text: message(language, 'disable'),
      callback_data: `subscription:disable:${subscriptionId}`
    }]]
  };
}

export {
  allDestinationsKeyboard,
  catalogCitiesKeyboard,
  catalogTabsKeyboard,
  ticketNavigationKeyboard
} from './ticket-pagination.js';
