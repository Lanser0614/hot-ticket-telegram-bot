import { describe, expect, it } from 'vitest';

import {
  formatLocalizedLocationLabel,
  formatLocationLabel,
  getLocationCountryCode,
  getLocalizedLocationName,
  getLocationName,
  resolveLocation,
  UZBEKISTAN_ORIGIN_CODES
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

  it('не выдаёт внутренние кириллические транспортные коды как IATA', () => {
    expect(resolveLocation('ТАШ')).toEqual({ kind: 'not_found' });
  });

  it('локализует города и разрешает узбекские названия', () => {
    expect(getLocalizedLocationName('TAS', 'uz')).toBe('Toshkent');
    expect(formatLocalizedLocationLabel('SKD', 'uz')).toBe('Samarqand (SKD)');
    expect(formatLocalizedLocationLabel('IST', 'uz')).toBe('Istanbul (IST)');
    expect(resolveLocation('Toshkent')).toEqual({ kind: 'resolved', code: 'TAS' });
    expect(resolveLocation('Samarqand')).toEqual({ kind: 'resolved', code: 'SKD' });
    expect(resolveLocation('Istanbul')).toEqual({ kind: 'resolved', code: 'IST' });
  });

  it('предлагает как origin только аэропорты Узбекистана', () => {
    expect(UZBEKISTAN_ORIGIN_CODES).toHaveLength(11);
    for (const code of UZBEKISTAN_ORIGIN_CODES) {
      expect(getLocationCountryCode(code)).toBe('UZ');
    }
  });
});
