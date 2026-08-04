import type {
  NotificationInput,
  TelegramCallbackAnswer,
  TelegramMessageInput
} from '../../application/models.js';
import type { TelegramGateway, TicketNotifier } from '../../application/ports.js';
import { parseTelegramUpdate, type TelegramUpdate } from './updates.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type RecordValue = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RecordValue {
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

export class TelegramBotApiClient implements TelegramGateway, TicketNotifier {
  public constructor(
    private readonly token: string,
    private readonly fetch: FetchLike = globalThis.fetch
  ) {}

  public async getUpdates(
    input: { readonly offset: number; readonly timeoutSeconds: number },
    signal: AbortSignal
  ): Promise<readonly TelegramUpdate[]> {
    const result = await this.call('getUpdates', {
      offset: input.offset,
      timeout: input.timeoutSeconds,
      allowed_updates: ['message', 'callback_query']
    }, signal);
    if (!Array.isArray(result)) throw new TypeError('Telegram API вернул некорректный result getUpdates');
    return result.map(parseTelegramUpdate);
  }

  public async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }

  public async sendMessage(input: TelegramMessageInput): Promise<{ messageId: number }> {
    const result = await this.call('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode === undefined ? {} : { parse_mode: input.parseMode }),
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup })
    });
    return { messageId: messageId(result) };
  }

  public async answerCallbackQuery(input: TelegramCallbackAnswer): Promise<void> {
    await this.call('answerCallbackQuery', {
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
    const result = await this.sendMessage({
      chatId: input.user.telegramChatId,
      text,
      parseMode: 'HTML',
      replyMarkup: {
        inline_keyboard: [[{ text: '🎫 Посмотреть билет', url: input.ticket.ticketLink }]]
      }
    });
    return { telegramMessageId: result.messageId };
  }

  private async call(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        ...(signal === undefined ? {} : { signal })
      });
    } catch {
      if (signal?.aborted === true) throw new DOMException('Telegram polling aborted', 'AbortError');
      throw new Error(`Telegram API ${method}: transport error`);
    }
    let envelope: unknown;
    try {
      envelope = await response.json() as unknown;
    } catch {
      throw new Error(`Telegram API ${method}: invalid JSON (${response.status})`);
    }
    if (!isRecord(envelope) || typeof envelope.ok !== 'boolean') {
      throw new TypeError(`Telegram API ${method}: invalid envelope`);
    }
    if (!response.ok || !envelope.ok) {
      const code = typeof envelope.error_code === 'number' ? envelope.error_code : response.status;
      throw new Error(`Telegram API ${method} failed (${code})`);
    }
    if (!Object.hasOwn(envelope, 'result')) {
      throw new TypeError(`Telegram API ${method}: result отсутствует`);
    }
    return envelope.result;
  }
}
