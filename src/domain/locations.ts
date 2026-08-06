import { IATA_LOCATIONS_RU } from '../constants/iata-locations-ru.js';

interface LocationRecord {
  readonly code: string;
  readonly name: string;
  readonly cityCode: string;
  readonly cityName: string;
  readonly countryCode: string;
}

export interface LocationMatch {
  readonly code: string;
  readonly label: string;
}

export type LocationResolution =
  | { readonly kind: 'resolved'; readonly code: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly LocationMatch[] }
  | { readonly kind: 'not_found' };

const LOCATIONS = IATA_LOCATIONS_RU as Readonly<Record<string, LocationRecord | undefined>>;
const IATA_CODE_PATTERN = /^[A-Z0-9]{3}$/u;

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

const LOCATIONS_BY_NAME = new Map<string, LocationRecord[]>();

function addNameIndex(value: string, location: LocationRecord): void {
  const key = normalizeSearchText(value);
  if (key.length === 0) return;
  const existing = LOCATIONS_BY_NAME.get(key);
  if (existing === undefined) LOCATIONS_BY_NAME.set(key, [location]);
  else existing.push(location);
}

for (const location of Object.values(LOCATIONS)) {
  if (location === undefined) continue;
  addNameIndex(location.name, location);
  if (normalizeSearchText(location.cityName) !== normalizeSearchText(location.name)) {
    addNameIndex(location.cityName, location);
  }
}

export function getLocationName(code: string): string | null {
  return LOCATIONS[code.trim().toUpperCase()]?.name ?? null;
}

export function getLocationCountryCode(code: string): string | null {
  return LOCATIONS[code.trim().toUpperCase()]?.countryCode ?? null;
}

export function formatLocationLabel(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  const name = getLocationName(normalizedCode);
  return name === null ? normalizedCode : `${name} (${normalizedCode})`;
}

export function resolveLocation(input: string): LocationResolution {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'not_found' };

  const possibleCode = trimmed.toUpperCase();
  const directMatch = IATA_CODE_PATTERN.test(possibleCode) ? LOCATIONS[possibleCode] : undefined;
  if (directMatch !== undefined) return { kind: 'resolved', code: directMatch.code };

  const matches = LOCATIONS_BY_NAME.get(normalizeSearchText(trimmed));
  if (matches === undefined || matches.length === 0) return { kind: 'not_found' };

  const directCityCodes = [...new Set(
    matches
      .filter((location) => location.code === location.cityCode)
      .map((location) => location.code)
      .filter((code) => IATA_CODE_PATTERN.test(code))
  )].sort();
  if (directCityCodes.length === 1) {
    return { kind: 'resolved', code: directCityCodes[0]! };
  }

  const codes = [...new Set(matches
    .map((location) => location.cityCode || location.code)
    .filter((code) => IATA_CODE_PATTERN.test(code)))].sort();
  if (codes.length === 0) return { kind: 'not_found' };
  if (codes.length === 1) return { kind: 'resolved', code: codes[0]! };

  return {
    kind: 'ambiguous',
    candidates: codes.map((code) => ({ code, label: formatLocationLabel(code) }))
  };
}
