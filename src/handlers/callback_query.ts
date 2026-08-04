import type { TelegramBotRouter, TelegramCallbackQuery } from '../application/bot-router.js';
import { createTelegramRouter } from '../platform/telegram/composition.js';

export function createCallbackQueryHandler(
  router: TelegramBotRouter
): (query: TelegramCallbackQuery) => Promise<void> {
  return (query) => router.handleCallbackQuery(query);
}

export default async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  await createTelegramRouter().handleCallbackQuery(query);
}
