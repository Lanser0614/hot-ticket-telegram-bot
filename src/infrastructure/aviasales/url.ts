import type { AppConfig } from '../../config.js';
import { validateHotOffersInput, type HotOffersInput } from '../../domain/codes.js';

export function createHotOffersUrl(input: HotOffersInput, config: AppConfig): URL {
  const normalized = validateHotOffersInput(input);
  const url = new URL('/v1/hot_offers/list.json', config.aviasalesExploreBaseUrl);

  url.searchParams.set('origin', normalized.originCode);
  url.searchParams.set('currency', normalized.currencyCode.toLowerCase());

  return url;
}
