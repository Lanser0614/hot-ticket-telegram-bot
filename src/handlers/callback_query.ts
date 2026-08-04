import type { TelegramBotRouter, TelegramCallbackQuery } from '../application/bot-router.js';

export function createCallbackQueryHandler(
  router: TelegramBotRouter
): (query: TelegramCallbackQuery) => Promise<void> {
  return (query) => router.handleCallbackQuery(query);
}

export default function handleCallbackQuery(): never {
  throw new Error('Composition root Telegram ещё не подключён');
}
