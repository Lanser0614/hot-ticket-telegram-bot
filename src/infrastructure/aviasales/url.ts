import type { AppConfig } from '../../config.js';
import { validateHotOffersInput, type HotOffersInput } from '../../domain/codes.js';

export function createHotOffersUrl(input: HotOffersInput, config: AppConfig): URL {
  const normalized = validateHotOffersInput(input);
  const url = new URL('/v1/hot_offers/list.json', config.aviasalesExploreBaseUrl);

  url.searchParams.set('origin', normalized.originCode);
  url.searchParams.set('currency', normalized.currencyCode.toLowerCase());
  url.searchParams.set('direct', 'false');
  url.searchParams.set('features.hot_tags_new_markets', 'on');
  url.searchParams.set('features.selection_logic_flag', 'conversionGroup');
  url.searchParams.set('language', config.aviasalesLanguage);
  url.searchParams.set('market', config.aviasalesMarket);
  url.searchParams.set('one_way', 'true');
  url.searchParams.set('origin_type', 'CITY');
  url.searchParams.set('passport_country', config.aviasalesPassportCountry);
  url.searchParams.set('sale_tickets', 'false');
  url.searchParams.set('sort_type', 'popularity');
  url.searchParams.set('trip_class', 'Y');
  url.searchParams.set('with_baggage', 'false');

  return url;
}

