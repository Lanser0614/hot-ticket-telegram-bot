import { describe, expect, it } from 'vitest';

import {
  normalizeCurrencyCode,
  normalizeIataCode,
  validateHotOffersInput
} from '../../../src/domain/codes.js';
import { ValidationError } from '../../../src/domain/errors.js';

describe('коды направлений и валют', () => {
  it('нормализует регистр и пробелы', () => {
    expect(normalizeIataCode(' tas ')).toBe('TAS');
    expect(normalizeIataCode('a1a')).toBe('A1A');
    expect(normalizeCurrencyCode(' uzs ')).toBe('UZS');
  });

  it.each(['', 'TA', 'TASH', 'T-S', 'ТАС'])('отклоняет IATA-код %j', (value) => {
    expect(() => normalizeIataCode(value)).toThrow(ValidationError);
  });

  it.each(['', 'UZ', 'UZSS', 'U1S', 'СУМ'])('отклоняет код валюты %j', (value) => {
    expect(() => normalizeCurrencyCode(value)).toThrow(ValidationError);
  });

  it('валидирует и нормализует обязательный input Aviasales', () => {
    expect(validateHotOffersInput({ originCode: 'tas', currencyCode: 'uzs' })).toEqual({
      originCode: 'TAS',
      currencyCode: 'UZS'
    });
  });
});

