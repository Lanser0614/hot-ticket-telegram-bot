import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/config.js';
import { ValidationError } from '../../../src/domain/errors.js';
import { createHotOffersUrl } from '../../../src/infrastructure/aviasales/url.js';

describe('createHotOffersUrl', () => {
  it('отправляет только origin и currency', () => {
    const config = loadConfig({
      AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
    });
    const url = createHotOffersUrl({ originCode: 'tas', currencyCode: 'uzs' }, config);

    expect(url.origin).toBe('https://explore-api.aviasales.com');
    expect(url.pathname).toBe('/v1/hot_offers/list.json');
    expect(url.search).toBe('?origin=TAS&currency=uzs');
    expect(Object.fromEntries(url.searchParams)).toEqual({ origin: 'TAS', currency: 'uzs' });
    expect([...url.searchParams.keys()].sort()).toEqual(['currency', 'origin']);
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
