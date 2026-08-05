import { describe, expect, it } from 'vitest';

import {
  assertTripClass,
  DEFAULT_CURRENCY_CODE,
  DEFAULT_ORIGIN_CODE,
  matchesUserTicketPreferences,
  presentBaggage,
  presentTripClass,
  TICKET_PAGE_SIZE
} from '../../../src/domain/travel-preferences.js';

describe('системный каталог', () => {
  it('фиксирует TAS, UZS и десять билетов на странице', () => {
    expect(DEFAULT_ORIGIN_CODE).toBe('TAS');
    expect(DEFAULT_CURRENCY_CODE).toBe('UZS');
    expect(TICKET_PAGE_SIZE).toBe(10);
  });
});

describe('пользовательские фильтры', () => {
  it.each([
    ['economy', false, 'economy', false, true],
    ['economy', false, 'economy', true, true],
    ['economy', true, 'economy', false, false],
    ['economy', true, 'economy', true, true],
    ['business', false, 'economy', true, false],
    ['business', true, 'business', true, true]
  ] as const)(
    'фильтр %s/%s для билета %s/%s -> %s',
    (preferredTripClass, baggageRequired, tripClass, hasBaggage, expected) => {
      expect(matchesUserTicketPreferences(
        { tripClass, hasBaggage },
        { preferredTripClass, baggageRequired }
      )).toBe(expected);
    }
  );

  it('валидирует и отображает настройки', () => {
    expect(assertTripClass(' BUSINESS ')).toBe('business');
    expect(() => assertTripClass('first')).toThrow('Некорректный класс перелёта');
    expect(presentTripClass('economy')).toBe('Эконом');
    expect(presentTripClass('business')).toBe('Бизнес');
    expect(presentBaggage(false)).toBe('Не важно');
    expect(presentBaggage(true)).toBe('Только с багажом');
  });
});
