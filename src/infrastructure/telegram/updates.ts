import type {
  TelegramCallbackQuery,
  TelegramMessage
} from '../../application/bot-router.js';

type RecordValue = Readonly<Record<string, unknown>>;

export interface TelegramUpdate {
  readonly updateId: number;
  readonly message: TelegramMessage | null;
  readonly callbackQuery: TelegramCallbackQuery | null;
}

function record(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Некорректный Telegram ${name}`);
  }
  return value as RecordValue;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Некорректный Telegram ${name}`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`Некорректный Telegram ${name}`);
  return value;
}

function parseMessage(value: unknown): TelegramMessage {
  const input = record(value, 'message');
  const chat = record(input.chat, 'message.chat');
  const message: TelegramMessage = {
    chat: { id: integer(chat.id, 'message.chat.id') }
  };

  if (input.from !== undefined) {
    const from = record(input.from, 'message.from');
    const parsedFrom: NonNullable<TelegramMessage['from']> = {
      id: integer(from.id, 'message.from.id')
    };
    const username = optionalString(from.username, 'message.from.username');
    const firstName = optionalString(from.first_name, 'message.from.first_name');
    const lastName = from.last_name === null
      ? null
      : optionalString(from.last_name, 'message.from.last_name');
    const languageCode = optionalString(from.language_code, 'message.from.language_code');
    if (username !== undefined) parsedFrom.username = username;
    if (firstName !== undefined) parsedFrom.first_name = firstName;
    if (lastName !== undefined) parsedFrom.last_name = lastName;
    if (languageCode !== undefined) parsedFrom.language_code = languageCode;
    message.from = parsedFrom;
  }

  const text = optionalString(input.text, 'message.text');
  if (text !== undefined) message.text = text;
  if (input.contact !== undefined) {
    const contact = record(input.contact, 'message.contact');
    const phoneNumber = optionalString(contact.phone_number, 'message.contact.phone_number');
    if (phoneNumber === undefined) throw new TypeError('Некорректный Telegram message.contact.phone_number');
    message.contact = {
      phone_number: phoneNumber,
      ...(contact.user_id === undefined
        ? {}
        : { user_id: integer(contact.user_id, 'message.contact.user_id') })
    };
  }
  return message;
}

function parseCallbackQuery(value: unknown): TelegramCallbackQuery {
  const input = record(value, 'callback_query');
  const from = record(input.from, 'callback_query.from');
  const id = optionalString(input.id, 'callback_query.id');
  if (id === undefined) throw new TypeError('Некорректный Telegram callback_query.id');
  const data = optionalString(input.data, 'callback_query.data');
  return {
    id,
    from: { id: integer(from.id, 'callback_query.from.id') },
    ...(data === undefined ? {} : { data })
  };
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate {
  const input = record(value, 'update');
  const updateId = integer(input.update_id, 'update_id');
  if (input.message !== undefined) {
    return { updateId, message: parseMessage(input.message), callbackQuery: null };
  }
  if (input.callback_query !== undefined) {
    return { updateId, message: null, callbackQuery: parseCallbackQuery(input.callback_query) };
  }
  return { updateId, message: null, callbackQuery: null };
}
