import { describe, expect, it } from 'vitest';

import {
  allDestinationsKeyboard,
  encodeTicketCursor,
  parseTicketCursor,
  ticketNavigationKeyboard
} from '../../../src/presentation/ticket-pagination.js';

describe('ticket pagination callbacks', () => {
  it('кодирует и читает короткий callback', () => {
    const data = encodeTicketCursor({
      destinationCode: 'IST',
      offset: 10,
      tripClass: 'economy',
      baggageRequired: true
    });

    expect(data).toBe('tickets:IST:10:E1');
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseTicketCursor(data)).toEqual({
      destinationCode: 'IST',
      offset: 10,
      tripClass: 'economy',
      baggageRequired: true
    });
  });

  it('поддерживает ALL и business without baggage requirement', () => {
    expect(parseTicketCursor('tickets:ALL:0:B0')).toEqual({
      destinationCode: null,
      offset: 0,
      tripClass: 'business',
      baggageRequired: false
    });
  });

  it.each([
    'tickets:IS:0:E0',
    'tickets:IST:-10:E0',
    'tickets:IST:1:E0',
    'tickets:IST:10010:E0',
    'tickets:IST:10:X0',
    'other:IST:10:E0'
  ])('отклоняет malformed callback %s', (data) => {
    expect(parseTicketCursor(data)).toBeNull();
  });

  it('строит кнопки назад и вперёд', () => {
    expect(ticketNavigationKeyboard({
      tickets: [],
      destinationCode: 'IST',
      offset: 10,
      hasPrevious: true,
      hasNext: true
    }, { tripClass: 'business', baggageRequired: false })).toEqual({
      inline_keyboard: [[
        { text: '⬅️ Назад', callback_data: 'tickets:IST:0:B0' },
        { text: '➡️ Показать ещё', callback_data: 'tickets:IST:20:B0' }
      ]]
    });
  });

  it('строит кнопку всех направлений с текущей сигнатурой', () => {
    expect(allDestinationsKeyboard({ tripClass: 'economy', baggageRequired: false }))
      .toEqual({ inline_keyboard: [[{
        text: '🌍 Все направления из Ташкента',
        callback_data: 'tickets:ALL:0:E0'
      }]] });
  });
});
