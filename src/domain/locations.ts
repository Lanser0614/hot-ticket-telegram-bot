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

export interface LocationSearchOption {
  readonly code: string;
  readonly name: string;
  readonly searchNames: readonly string[];
}

export type LocationResolution =
  | { readonly kind: 'resolved'; readonly code: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly LocationMatch[] }
  | { readonly kind: 'not_found' };

const LOCATIONS = IATA_LOCATIONS_RU as Readonly<Record<string, LocationRecord | undefined>>;
const IATA_CODE_PATTERN = /^[A-Z0-9]{3}$/u;
const UZBEK_LOCATION_NAMES: Readonly<Record<string, string>> = {
  TAS: 'Toshkent',
  IST: 'Istanbul',
  DXB: 'Dubay',
  ALA: 'Olmaota',
  SKD: 'Samarqand',
  BHK: 'Buxoro',
  FEG: 'Farg‘ona',
  NMA: 'Namangan',
  NCU: 'Nukus',
  UGC: 'Urganch',
  TMJ: 'Termiz',
  KSQ: 'Qarshi',
  AZN: 'Andijon',
  NVI: 'Navoiy'
};
const COMMON_LOCATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  TAS: ['Tashkent'], IST: ['Istanbul'], DXB: ['Dubai'], ALA: ['Almaty'],
  SKD: ['Samarkand'], BHK: ['Bukhara'], FEG: ['Fergana'], UGC: ['Urgench']
};

export const UZBEKISTAN_ORIGIN_CODES = [
  'TAS', 'SKD', 'BHK', 'FEG', 'NMA', 'NCU', 'UGC', 'TMJ', 'KSQ', 'AZN', 'NVI'
] as const;

export function isUzbekistanOrigin(code: string): boolean {
  return (UZBEKISTAN_ORIGIN_CODES as readonly string[]).includes(code.trim().toUpperCase());
}

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g', Д: 'D', д: 'd',
  Е: 'E', е: 'e', Ё: 'Yo', ё: 'yo', Ж: 'J', ж: 'j', З: 'Z', з: 'z', И: 'I', и: 'i',
  Й: 'Y', й: 'y', К: 'K', к: 'k', Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n',
  О: 'O', о: 'o', П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
  У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'X', х: 'x', Ц: 'Ts', ц: 'ts', Ч: 'Ch', ч: 'ch',
  Ш: 'Sh', ш: 'sh', Щ: 'Shch', щ: 'shch', Ъ: '', ъ: '', Ы: 'I', ы: 'i', Ь: '', ь: '',
  Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya'
};

function transliterateRussian(value: string): string {
  return [...value].map((character) => CYRILLIC_TO_LATIN[character] ?? character).join('');
}

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
  addNameIndex(transliterateRussian(location.name), location);
  addNameIndex(transliterateRussian(location.cityName), location);
  const uzbekName = UZBEK_LOCATION_NAMES[location.code];
  if (uzbekName !== undefined) addNameIndex(uzbekName, location);
}

export function getLocationName(code: string): string | null {
  return LOCATIONS[code.trim().toUpperCase()]?.name ?? null;
}

export function getLocalizedLocationName(code: string, language: 'ru' | 'uz'): string | null {
  const normalizedCode = code.trim().toUpperCase();
  const name = getLocationName(normalizedCode);
  if (name === null || language === 'ru') return name;
  return UZBEK_LOCATION_NAMES[normalizedCode] ?? transliterateRussian(name);
}

export function getLocationSearchNames(code: string): readonly string[] {
  const normalizedCode = code.trim().toUpperCase(); const location = LOCATIONS[normalizedCode];
  if (location === undefined) return [normalizedCode];
  return [...new Set([
    normalizedCode, location.name, location.cityName, transliterateRussian(location.name),
    transliterateRussian(location.cityName), UZBEK_LOCATION_NAMES[normalizedCode],
    ...(COMMON_LOCATION_ALIASES[normalizedCode] ?? [])
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export function searchLocationsByPrefix(
  input: string,
  language: 'ru' | 'uz',
  limit = 8
): readonly LocationSearchOption[] {
  const query = normalizeSearchText(input); if (query.length === 0) return [];
  const options = new Map<string, LocationSearchOption & { readonly score: number }>();
  for (const location of Object.values(LOCATIONS)) {
    if (location === undefined) continue;
    const code = IATA_CODE_PATTERN.test(location.cityCode) && LOCATIONS[location.cityCode] !== undefined
      ? location.cityCode
      : location.code;
    if (options.has(code)) continue;
    const name = getLocalizedLocationName(code, language) ?? code; const searchNames = getLocationSearchNames(code);
    const normalizedCode = normalizeSearchText(code); const normalizedName = normalizeSearchText(name);
    const productNameMatch = [UZBEK_LOCATION_NAMES[code], ...(COMMON_LOCATION_ALIASES[code] ?? [])]
      .some((candidate) => candidate !== undefined && normalizeSearchText(candidate).startsWith(query));
    const aliasMatch = searchNames.some((candidate) => {
      const normalizedCandidate = normalizeSearchText(candidate);
      return normalizedCandidate !== normalizedCode && normalizedCandidate !== normalizedName
        && normalizedCandidate.startsWith(query);
    });
    if (!normalizedCode.startsWith(query) && !normalizedName.startsWith(query) && !aliasMatch) continue;
    const score = productNameMatch ? 0 : normalizedName.startsWith(query) ? 1 : aliasMatch ? 2 : 3;
    options.set(code, { code, name, searchNames, score });
  }
  return [...options.values()]
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name, language === 'uz' ? 'uz' : 'ru'))
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map(({ code, name, searchNames }) => ({ code, name, searchNames }));
}

export function getLocationCountryCode(code: string): string | null {
  return LOCATIONS[code.trim().toUpperCase()]?.countryCode ?? null;
}

export function formatLocationLabel(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  const name = getLocationName(normalizedCode);
  return name === null ? normalizedCode : `${name} (${normalizedCode})`;
}

export function formatLocalizedLocationLabel(code: string, language: 'ru' | 'uz'): string {
  const normalizedCode = code.trim().toUpperCase();
  const name = getLocalizedLocationName(normalizedCode, language);
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
