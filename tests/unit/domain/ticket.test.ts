import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { sha256 } from '../../../src/domain/sha256.js';
import {
  createExternalKey,
  extractTicketSearchCode,
  normalizeTicketLink,
  type ExternalKeyInput
} from '../../../src/domain/ticket.js';

describe('ссылки Aviasales', () => {
  it('нормализует относительную ссылку реального Explore API', () => {
    expect(normalizeTicketLink('/TAS1508IST1?t=token&search_id=1'))
      .toBe('https://www.aviasales.uz/search/TAS1508IST1');
  });

  it('удаляет query string из полной ссылки', () => {
    expect(normalizeTicketLink(' https://www.aviasales.uz/search/TAS1308IKU1?marker=123 '))
      .toBe('https://www.aviasales.uz/search/TAS1308IKU1');
  });

  it('извлекает поисковый код', () => {
    expect(extractTicketSearchCode('https://www.aviasales.uz/search/TAS1308IKU1'))
      .toBe('TAS1308IKU1');
  });

  it.each(['', 'https://example.com/search/TAS1308IKU1', '/bad-code!'])('отклоняет %j', (value) => {
    expect(() => normalizeTicketLink(value)).toThrow(ValidationError);
  });
});

describe('SHA-256 и внешний ключ', () => {
  it('соответствует публичному тестовому вектору', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('детерминирован и не зависит от цены', () => {
    const input: ExternalKeyInput & { price: number } = {
      originCode: 'TAS',
      destinationCode: 'IST',
      departureDate: '2026-08-15',
      ticketSearchCode: 'TAS1508IST1',
      currencyCode: 'UZS',
      tripClass: 'economy',
      price: 2_395_739
    };

    const cheaperInput: ExternalKeyInput & { price: number } = {
      ...input,
      price: 1_900_000
    };

    expect(createExternalKey(input)).toBe(createExternalKey(cheaperInput));
  });

  it('изменяется при изменении направления', () => {
    const input: ExternalKeyInput = {
      originCode: 'TAS',
      destinationCode: 'IST',
      departureDate: '2026-08-15',
      ticketSearchCode: 'TAS1508IST1',
      currencyCode: 'UZS',
      tripClass: 'economy'
    };

    expect(createExternalKey(input)).not.toBe(createExternalKey({ ...input, destinationCode: 'DXB' }));
  });

  it('различает одинаковые предложения разных классов', () => {
    const input: ExternalKeyInput = {
      originCode: 'TAS',
      destinationCode: 'IST',
      departureDate: '2026-08-15',
      ticketSearchCode: 'TAS1508IST1',
      currencyCode: 'UZS',
      tripClass: 'economy'
    };

    expect(createExternalKey(input))
      .not.toBe(createExternalKey({ ...input, tripClass: 'business' }));
  });
});
