import type { TelegramBotRouter, TelegramMessage } from '../application/bot-router.js';

export function createMessageHandler(router: TelegramBotRouter): (message: TelegramMessage) => Promise<void> {
  return (message) => router.handleMessage(message);
}

export default function handleMessage(): never {
  throw new Error('Composition root Telegram ещё не подключён');
}
