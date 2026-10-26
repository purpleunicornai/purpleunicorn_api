import { getStateByCode } from '@countrystatecity/countries';
import { ParsedLocation } from './role-filter-parser';

// Professional designations recruiters type in shorthand that profiles
// spell several ways. Each key is a normalizeTerm() form; the first alias is
// the canonical spelling. Extend as new shorthand turns up in real searches.
const QUALIFICATION_ALIASES: Record<string, string[]> = {
  'ca sa': ['CA(SA)', 'Chartered Accountant', 'SAICA'],
};

// Lowercase, punctuation-insensitive form so "CA(SA)", "CA (SA)" and
// "ca sa" all compare equal while still matching on word boundaries.
export function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

export function qualificationAliases(qualification: string): string[] {
  const aliases = QUALIFICATION_ALIASES[normalizeTerm(qualification)];
  return aliases ?? [qualification];
}

// Word-bounded containment on normalized text, so "CA(SA)" never matches
// inside "Casablanca".
export function textContainsTerm(
  text: string | null | undefined,
  term: string,
): boolean {
  const needle = normalizeTerm(term);
  if (!text || !needle) return false;
  return ` ${normalizeTerm(text)} `.includes(` ${needle} `);
}

export function countryName(countryCode: string): string | undefined {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return undefined;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

// Accepts an ISO alpha-2 code or a country name (Gemini sometimes returns
// "South Africa" despite being asked for a code) and returns the code.
export function sameCountry(
  candidateCountry: string | null | undefined,
  requiredCode: string,
): boolean {
  if (!candidateCountry) return false;
  const value = candidateCountry.trim();
  if (value.toUpperCase() === requiredCode.trim().toUpperCase()) return true;
  const name = countryName(requiredCode);
  return !!name && normalizeTerm(value) === normalizeTerm(name);
}

// The filter UI stores the state/province as its ISO code (e.g. "WC"), which
// never appears on a profile — resolve it to "Western Cape". City values are
// already names and pass through unchanged.
export async function resolveRegionNames(
  location: ParsedLocation,
): Promise<string[]> {
  const names = await Promise.all(
    location.regions.map(async (region) => {
      const value = region.value.trim();
      if (!value || !location.countryCode) return value;
      try {
        const state = await getStateByCode(location.countryCode, value);
        return state?.name ?? value;
      } catch {
        return value;
      }
    }),
  );
  return [...new Set(names.filter(Boolean))];
}
