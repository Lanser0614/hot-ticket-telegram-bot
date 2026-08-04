import type { TelegramBotRouter, TelegramMessage } from '../application/bot-router.js';
import { createTelegramRouter } from '../platform/telegram/composition.js';

export function createMessageHandler(router: TelegramBotRouter): (message: TelegramMessage) => Promise<void> {
  return (message) => router.handleMessage(message);
}

export default async function handleMessage(message: TelegramMessage): Promise<void> {
  await createTelegramRouter().handleMessage(message);
}
