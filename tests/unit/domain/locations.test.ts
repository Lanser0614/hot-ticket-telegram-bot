import { describe, expect, it } from 'vitest';

import {
  formatLocationLabel,
  getLocationName,
  resolveLocation
} from '../../../src/domain/locations.js';

describe('русский справочник локаций', () => {
  it('форматирует известный и неизвестный IATA-код', () => {
    expect(getLocationName(' tas ')).toBe('Ташкент');
    expect(formatLocationLabel('tas')).toBe('Ташкент (TAS)');
    expect(formatLocationLabel('zzz')).toBe('ZZZ');
  });

  it.each([
    ['IST', 'IST'],
    ['  ist  ', 'IST'],
    ['Стамбул', 'IST'],
    ['  стамбул  ', 'IST']
  ])('разрешает %s в %s', (input, code) => {
    expect(resolveLocation(input)).toEqual({ kind: 'resolved', code });
  });

  it('нормализует регистр, пробелы и ё', () => {
    expect(resolveLocation('  орёл  ')).toEqual(resolveLocation('ОРЕЛ'));
  });

  it('возвращает варианты для неоднозначного названия', () => {
    expect(resolveLocation('Абердин')).toEqual({
      kind: 'ambiguous',
      candidates: [
        { code: 'ABR', label: 'Абердин (ABR)' },
        { code: 'ABZ', label: 'Абердин (ABZ)' },
        { code: 'APG', label: 'Абердин (APG)' }
      ]
    });
  });

  it('не исправляет опечатки', () => {
    expect(resolveLocation('Стамблл')).toEqual({ kind: 'not_found' });
    expect(resolveLocation('')).toEqual({ kind: 'not_found' });
  });
});
