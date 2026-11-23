import { ParsedFilterRow, ParsedLocation } from './role-filter-parser';
import { remoteAllowed } from './work-types';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

// Codes Intl resolves to non-countries, plus names that are also common
// sub-national places ("New Jersey", "Atlanta, Georgia") and would cause
// false drops.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'JE', 'GE']);

// LinkedIn writes some countries by their parts or short names.
const COUNTRY_ALIASES: Record<string, string[]> = {
  GB: ['UK', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  US: ['USA', 'United States of America'],
  AE: ['UAE'],
  NL: ['Holland'],
};

export function countryName(code: string): string | undefined {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return undefined;
  const name = regionNames.of(upper);
  return name && name !== upper ? name : undefined;
}

function countryTerms(code: string): string[] {
  const upper = code.toUpperCase();
  const name = countryName(upper);
  return [...(name ? [name] : []), ...(COUNTRY_ALIASES[upper] ?? [])];
}

const ALL_COUNTRY_CODES = Array.from({ length: 26 * 26 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
).filter((code) => !NOT_COUNTRIES.has(code) && countryName(code));

// "Greater London Area" and "London Metropolitan Area" both mean London.
function normalize(place: string): string {
  return place
    .toLowerCase()
    .replace(/\b(greater|metropolitan|metro|area|region)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function containsWord(haystack: string, needle: string): boolean {
  return needle.length >= 3 && ` ${haystack} `.includes(` ${needle} `);
}

function mentions(location: string, place: string): boolean {
  const a = normalize(location);
  const b = normalize(place);
  return containsWord(a, b) || containsWord(b, a);
}

// True only when the role has a mandatory, on-site location and the
// candidate's known location names a different country without naming
// any of the role's places. Anything vaguer ("San Francisco Bay Area",
// a city with no country, no location at all) is kept for the AI to judge,
// because a false drop loses a candidate for good.
export function isOutsideRoleLocation(
  candidateLocation: string | undefined,
  roleLocation: ParsedFilterRow<ParsedLocation> | undefined,
): boolean {
  if (!candidateLocation?.trim() || !roleLocation) return false;
  const { priority, nonNegotiable, value } = roleLocation;
  if (priority !== 'ESSENTIAL' && !nonNegotiable) return false;
  // Remote people can be anywhere; only ONSITE/HYBRID-only roles are gated.
  if (remoteAllowed(value)) return false;

  const rolePlaces = [
    ...value.regions.map((region) => region.value),
    ...countryTerms(value.countryCode),
  ];
  if (rolePlaces.length === 0) return false;
  if (rolePlaces.some((place) => mentions(candidateLocation, place))) {
    return false;
  }

  return ALL_COUNTRY_CODES.some(
    (code) =>
      code !== value.countryCode.toUpperCase() &&
      countryTerms(code).some((term) =>
        containsWord(normalize(candidateLocation), normalize(term)),
      ),
  );
}

const NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const code of ALL_COUNTRY_CODES) {
    const name = countryName(code);
    if (name) map[normalize(name)] = code;
    for (const alias of COUNTRY_ALIASES[code] ?? []) {
      map[normalize(alias)] = code;
    }
    map[code.toLowerCase()] = code;
  }
  return map;
})();

// Resolves a country name, alias, or ISO code to an alpha-2 code.
export function countryCodeFromName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return countryName(upper) ? upper : undefined;
  }
  return NAME_TO_CODE[normalize(trimmed)];
}
