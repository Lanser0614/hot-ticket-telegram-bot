import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_ORIGIN_CODE,
  TICKET_PAGE_SIZE
} from '../../../src/domain/travel-preferences.js';

describe('системный каталог', () => {
  it('фиксирует TAS, UZS и десять билетов на странице', () => {
    expect(DEFAULT_ORIGIN_CODE).toBe('TAS');
    expect(DEFAULT_CURRENCY_CODE).toBe('UZS');
    expect(TICKET_PAGE_SIZE).toBe(10);
  });
});
