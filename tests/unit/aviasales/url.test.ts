import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/config.js';
import { ValidationError } from '../../../src/domain/errors.js';
import { createHotOffersUrl } from '../../../src/infrastructure/aviasales/url.js';

describe('createHotOffersUrl', () => {
  it('создаёт полный запрос MVP', () => {
    const config = loadConfig({
      AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
    });
    const url = createHotOffersUrl({ originCode: 'tas', currencyCode: 'uzs' }, config);

    expect(url.origin).toBe('https://explore-api.aviasales.com');
    expect(url.pathname).toBe('/v1/hot_offers/list.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: 'TAS',
      currency: 'uzs',
      direct: 'false',
      'features.hot_tags_new_markets': 'on',
      'features.selection_logic_flag': 'conversionGroup',
      language: 'ru',
      market: 'uz',
      one_way: 'true',
      origin_type: 'CITY',
      passport_country: 'UZ',
      sale_tickets: 'false',
      sort_type: 'popularity',
      trip_class: 'Y',
      with_baggage: 'false'
    });
  });

  it('использует переданный base URL без production host в builder', () => {
    const config = loadConfig({ AVIASALES_EXPLORE_BASE_URL: 'https://example.test/base' });
    expect(createHotOffersUrl({ originCode: 'TAS', currencyCode: 'UZS' }, config).toString())
      .toContain('https://example.test/v1/hot_offers/list.json');
  });

  it.each([
    { originCode: '', currencyCode: 'UZS' },
    { originCode: 'TAS', currencyCode: '' }
  ])('не строит URL для %j', (input) => {
    const config = loadConfig({ AVIASALES_EXPLORE_BASE_URL: 'https://example.test' });
    expect(() => createHotOffersUrl(input, config)).toThrow(ValidationError);
  });

  it.each(['http://example.test', 'not-a-url'])('отклоняет base URL %j', (value) => {
    expect(() => loadConfig({ AVIASALES_EXPLORE_BASE_URL: value })).toThrow(ValidationError);
  });
});

