import type { TelegramApi } from 'sdk';

import type { NotificationInput, TelegramCallbackAnswer, TelegramMessageInput } from '../../application/models.js';
import type { TelegramGateway, TicketNotifier } from '../../application/ports.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageId(value: unknown): number {
  if (!isRecord(value) || typeof value.message_id !== 'number' || !Number.isSafeInteger(value.message_id)) {
    throw new TypeError('Telegram API не вернул message_id');
  }
  return value.message_id;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export class TelegramApiAdapter implements TelegramGateway, TicketNotifier {
  public constructor(private readonly api: TelegramApi) {}

  public async sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }> {
    const result = await this.api.sendMessage({
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode === undefined ? {} : { parse_mode: input.parseMode }),
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup })
    });
    return { messageId: messageId(result) };
  }

  public async answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void> {
    await this.api.answerCallbackQuery({
      callback_query_id: input.callbackQueryId,
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.showAlert === undefined ? {} : { show_alert: input.showAlert })
    });
  }

  public async send(input: NotificationInput): Promise<{ telegramMessageId: number }> {
    const title = input.type === 'new_ticket'
      ? '🔥 <b>Найден новый горячий билет!</b>'
      : '📉 <b>Цена билета снизилась!</b>';
    const text = [
      title,
      '',
      `✈️ ${escapeHtml(input.ticket.originCode)} → ${escapeHtml(input.ticket.destinationCode)}`,
      `📅 Вылет: ${escapeHtml(input.ticket.departureDate)}`,
      `💰 Цена: ${new Intl.NumberFormat('ru-RU').format(input.ticket.price)} ${escapeHtml(input.ticket.currencyCode)}`,
      `🛫 ${input.ticket.isDirect ? 'Прямой рейс' : 'С пересадкой'}`,
      `🧳 ${input.ticket.hasBaggage ? 'С багажом' : 'Без багажа'}`
    ].join('\n');
    const result = await this.api.sendMessage({
      chat_id: input.user.telegramChatId,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🎫 Посмотреть билет', url: input.ticket.ticketLink }]]
      }
    });
    return { telegramMessageId: messageId(result) };
  }
}

