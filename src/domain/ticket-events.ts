import { ValidationError } from './errors.js';
import { assertMoney } from './money.js';
import type { Ticket } from './ticket.js';

export type TicketEventType = 'new_ticket' | 'price_drop';

export interface NotificationKeyInput {
  userId: number;
  subscriptionId: number;
  ticketId: number;
  notifiedPrice: number;
}

export function detectTicketEvent(previous: Ticket | null, current: Ticket): TicketEventType | null {
  if (previous === null) return 'new_ticket';
  return current.price < previous.price ? 'price_drop' : null;
}

function assertId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Некорректный идентификатор уведомления');
  }
  return value;
}

export function notificationKey(input: NotificationKeyInput): string {
  return [
    assertId(input.userId),
    assertId(input.subscriptionId),
    assertId(input.ticketId),
    assertMoney(input.notifiedPrice)
  ].join('|');
}
