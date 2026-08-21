import { describe, expect, it } from 'vitest';

import {
  allDestinationsKeyboard,
  catalogCitiesKeyboard,
  catalogTabsKeyboard,
  encodeTicketCursor,
  parseCatalogCommand,
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
        text: '🌍 Все направления',
        callback_data: 'tickets:ALL:0:E0'
      }]] });
  });

  it('строит две вкладки локальных и международных рейсов', () => {
    expect(catalogTabsKeyboard({ tripClass: 'economy', baggageRequired: false })).toEqual({
      inline_keyboard: [
        [
          { text: '🇺🇿 Локальные рейсы', callback_data: 'catalog:dom:0' },
          { text: '🌍 Международные', callback_data: 'catalog:intl:0' }
        ],
        [{ text: '🌍 Все направления', callback_data: 'tickets:ALL:0:E0' }]
      ]
    });
  });

  it('разбирает catalog callbacks и отклоняет мусор', () => {
    expect(parseCatalogCommand('catalog:home')).toEqual({ kind: 'home' });
    expect(parseCatalogCommand('catalog:dom:0')).toEqual({ kind: 'scope', scope: 'domestic', offset: 0 });
    expect(parseCatalogCommand('catalog:intl:12')).toEqual({ kind: 'scope', scope: 'international', offset: 12 });
    expect(parseCatalogCommand('catalog:dom:5')).toBeNull();
    expect(parseCatalogCommand('catalog:foo')).toBeNull();
    expect(parseCatalogCommand('tickets:ALL:0:E0')).toBeNull();
  });

  it('строит кнопки городов с пагинацией и возвратом к категориям', () => {
    const cities = Array.from({ length: 13 }, (_, index) => ({
      code: `C${String(index).padStart(2, '0')}`,
      name: `Город ${String(index)}`
    }));

    const keyboard = catalogCitiesKeyboard('international', cities, 0, {
      tripClass: 'economy',
      baggageRequired: false
    }) as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

    expect(keyboard.inline_keyboard[0]?.[0]).toEqual({
      text: 'Город 0 (C00)',
      callback_data: 'tickets:C00:0:E0'
    });
    const nav = keyboard.inline_keyboard.at(-2);
    expect(nav).toEqual([{ text: '➡️ Ещё города', callback_data: 'catalog:intl:12' }]);
    expect(keyboard.inline_keyboard.at(-1)).toEqual([
      { text: '🔙 К категориям', callback_data: 'catalog:home' }
    ]);
  });
});
