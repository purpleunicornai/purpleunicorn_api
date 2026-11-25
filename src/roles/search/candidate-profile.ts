import { countryCodeFromName } from './location-gate';

export const INSTITUTION_TYPES = [
  'HIGH_SCHOOL',
  'COLLEGE',
  'UNIVERSITY',
  'COURSE',
  'OTHER',
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const SOURCE_TYPES = ['SEARCH', 'IMPORT', 'PLUGIN', 'OTHER'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface CandidateExperience {
  company_name: string;
  company_location?: string;
  role: string;
  start_date?: string;
  end_date?: string;
  responsibilities?: string;
  skills: string[];
}

export interface CandidateEducation {
  institution_name: string;
  institution_type: InstitutionType;
  institution_location?: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string;
  end_date?: string;
  summary?: string;
  additional_info?: string;
}

export interface CandidateSource {
  title: string;
  source?: string;
  url?: string;
  main: boolean;
  type: SourceType;
}

// Mirrors purple_unicorn_api's candidate record (and its experience /
// education / source relations), minus system fields the API assigns
// on write (uid, created, updated, enriched_at, and so on).
export interface CandidateRecord {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  country_calling_code?: string;
  current_location_city?: string;
  current_location_country_code?: string;
  current_location_postal_code?: string;
  open_to_relocation?: boolean;
  open_to_remote_work?: boolean;
  current_work_authorization_status?: string;
  experience_years?: number;
  experience_roles?: string[];
  current_title?: string;
  current_company?: string;
  current_salary?: number;
  current_salary_currency?: string;
  current_role_start_date?: string;
  skills?: string[];
  languages?: string[];
  diversity?: string[];
  summary?: string;
  image_url?: string;
  sources?: CandidateSource[];
  experience?: CandidateExperience[];
  education?: CandidateEducation[];
}

export interface RawCandidateSource {
  title?: string;
  name?: string;
  source?: string;
  url?: string;
  main?: boolean;
  type?: string;
}

export interface RawCandidateExperience {
  company_name?: string;
  company_location?: string;
  role?: string;
  start_date?: string;
  end_date?: string;
  responsibilities?: string;
  skills?: string[];
}

export interface RawCandidateEducation {
  institution_name?: string;
  institution_type?: string;
  institution_location?: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string;
  end_date?: string;
  summary?: string;
  additional_info?: string;
}

export interface RawCandidate {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  country_calling_code?: string;
  current_location_city?: string;
  current_location_country_code?: string;
  current_location_postal_code?: string;
  open_to_relocation?: boolean;
  open_to_remote_work?: boolean;
  current_work_authorization_status?: string;
  experience_years?: number;
  experience_roles?: string[];
  current_title?: string;
  current_company?: string;
  current_salary?: number;
  current_salary_currency?: string;
  current_role_start_date?: string;
  skills?: string[];
  languages?: string[];
  diversity?: string[];
  summary?: string;
  image_url?: string;
  sources?: RawCandidateSource[];
  additional_sources?: RawCandidateSource[];
  experience?: RawCandidateExperience[];
  education?: RawCandidateEducation[];
}

export interface CandidateSeedInput {
  name: string;
  headline?: string;
  company?: string;
  location?: string;
  linkedinUrl: string;
  imageUrl?: string;
}

const SKILL_ALIASES: Record<string, string> = {
  reactjs: 'react',
  'react.js': 'react',
  js: 'javascript',
  'react-native': 'react native',
  reactnative: 'react native',
};

const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPES);
const INSTITUTION_TYPE_ALIASES: Record<string, InstitutionType> = {
  'high school': 'HIGH_SCHOOL',
  highschool: 'HIGH_SCHOOL',
  secondary: 'HIGH_SCHOOL',
  college: 'COLLEGE',
  'community college': 'COLLEGE',
  university: 'UNIVERSITY',
  uni: 'UNIVERSITY',
  course: 'COURSE',
  bootcamp: 'COURSE',
  certificate: 'COURSE',
  certification: 'COURSE',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CALLING_CODE_RE = /^\+\d{1,4}$/;
const US_POSTAL_RE = /^\d{5}(?:-\d{4})?$/;
const GB_POSTAL_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const HTTP_URL_RE = /^https?:\/\/\S+$/i;
// countryCodeFromName returns a 2-letter token as-is when Intl accepts it,
// including reserved codes like "UK" that should be stored as ISO "GB".
const COUNTRY_CODE_ALIASES: Record<string, string> = { UK: 'GB' };

// Lowercase LinkedIn /in/ slug, stable across subdomains, trailing
// slashes and tracking query params. Undefined when the URL is not a
// profile page. Used as a local upsert hint; the API dedupes by source URL.
export function candidateKey(linkedinUrl: string): string | undefined {
  try {
    const url = new URL(linkedinUrl.trim());
    const match = url.pathname.match(/^\/in\/([^/]+)/i);
    if (!match?.[1]) return undefined;
    const slug = decodeURIComponent(match[1]).trim().toLowerCase();
    return slug || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSkillName(name: string): string | undefined {
  const lowered = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!lowered) return undefined;
  const compact = lowered.replace(/[\s._-]+/g, '');
  return SKILL_ALIASES[lowered] ?? SKILL_ALIASES[compact] ?? lowered;
}

export function normalizeSkillNames(skills: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const skill of skills ?? []) {
    const name = normalizeSkillName(skill);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function splitName(fullName: string): {
  first_name?: string;
  last_name?: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function parseLocationFields(
  location?: string,
): Pick<
  CandidateRecord,
  | 'current_location_city'
  | 'current_location_country_code'
  | 'current_location_postal_code'
> {
  if (!location?.trim()) return {};
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let current_location_country_code: string | undefined;
  let current_location_postal_code: string | undefined;
  const remaining: string[] = [];
  for (const part of parts) {
    const code = normalizeCountryCode(part);
    const postal = parsePostalCode(part);
    if (code && !current_location_country_code) {
      current_location_country_code = code;
    } else if (postal && !current_location_postal_code) {
      current_location_postal_code = postal;
    } else {
      remaining.push(part);
    }
  }
  const current_location_city = remaining[0] || undefined;
  return {
    ...(current_location_city ? { current_location_city } : {}),
    ...(current_location_country_code ? { current_location_country_code } : {}),
    ...(current_location_postal_code ? { current_location_postal_code } : {}),
  };
}

// A Vertex/LinkedIn snippet is enough to seed the persistable candidate
// shape (name, title, company, location, the LinkedIn source). Gemini
// then overlays any extra grounded fields.
export function seedCandidate(input: CandidateSeedInput): CandidateRecord {
  const names = splitName(input.name);
  const location = parseLocationFields(input.location);
  const current_title = trimText(input.headline);
  const current_company = trimText(input.company);
  const image_url = normalizeImageUrl(input.imageUrl);
  const sourceTitle =
    [input.name, current_title, current_company].filter(Boolean).join(' - ') ||
    input.name;
  return {
    ...names,
    ...location,
    ...(current_title ? { current_title } : {}),
    ...(current_company ? { current_company } : {}),
    ...(image_url ? { image_url } : {}),
    sources: [
      {
        title: sourceTitle,
        source: 'LinkedIn',
        url: input.linkedinUrl,
        main: true,
        type: 'SEARCH',
      },
    ],
  };
}

export function normalizeCandidate(
  raw: RawCandidate | undefined,
  seed: CandidateRecord,
): CandidateRecord {
  const skills = raw?.skills
    ? normalizeSkillNames(raw.skills)
    : (seed.skills ?? []);
  const languages = raw?.languages
    ? normalizeTerms(raw.languages)
    : seed.languages;
  const diversity = raw?.diversity
    ? normalizeTerms(raw.diversity)
    : seed.diversity;
  const experience_roles = raw?.experience_roles
    ? normalizeTerms(raw.experience_roles)
    : seed.experience_roles;
  const experience = raw?.experience
    ? normalizeExperience(raw.experience)
    : seed.experience;
  const education = raw?.education
    ? normalizeEducation(raw.education)
    : seed.education;
  const extraSources = [
    ...(raw?.sources ?? []),
    ...(raw?.additional_sources ?? []),
  ];

  const city =
    trimText(raw?.current_location_city) ?? seed.current_location_city;
  const countryCode =
    normalizeCountryCode(raw?.current_location_country_code) ??
    seed.current_location_country_code;
  const postal =
    parsePostalCode(raw?.current_location_postal_code) ??
    seed.current_location_postal_code;

  return {
    ...seed,
    ...pickName(raw, seed),
    ...pickOptionalString('email', normalizeEmail(raw?.email), seed),
    ...pickOptionalString('phone', normalizePhone(raw?.phone), seed),
    ...pickOptionalString(
      'country_calling_code',
      normalizeCallingCode(raw?.country_calling_code),
      seed,
    ),
    ...(city ? { current_location_city: city } : {}),
    ...(countryCode ? { current_location_country_code: countryCode } : {}),
    ...(postal ? { current_location_postal_code: postal } : {}),
    ...pickOptionalBoolean('open_to_relocation', raw, seed),
    ...pickOptionalBoolean('open_to_remote_work', raw, seed),
    ...pickOptionalString(
      'current_work_authorization_status',
      trimText(raw?.current_work_authorization_status),
      seed,
    ),
    ...pickOptionalNumber(
      'experience_years',
      normalizeYears(raw?.experience_years),
      seed,
    ),
    ...(experience_roles?.length ? { experience_roles } : {}),
    ...pickOptionalString('current_title', trimText(raw?.current_title), seed),
    ...pickOptionalString(
      'current_company',
      trimText(raw?.current_company),
      seed,
    ),
    ...pickOptionalNumber(
      'current_salary',
      normalizeSalary(raw?.current_salary),
      seed,
    ),
    ...pickOptionalString(
      'current_salary_currency',
      normalizeCurrency(raw?.current_salary_currency),
      seed,
    ),
    ...pickOptionalString(
      'current_role_start_date',
      normalizeIsoDate(raw?.current_role_start_date),
      seed,
    ),
    ...(skills.length ? { skills } : omitEmpty('skills', seed.skills)),
    ...(languages?.length ? { languages } : {}),
    ...(diversity?.length ? { diversity } : {}),
    ...pickOptionalString('summary', trimText(raw?.summary), seed),
    ...pickOptionalString('image_url', normalizeImageUrl(raw?.image_url), seed),
    sources: mergeSources(seed.sources ?? [], extraSources),
    ...(experience?.length ? { experience } : {}),
    ...(education?.length ? { education } : {}),
  };
}

function pickName(
  raw: RawCandidate | undefined,
  seed: CandidateRecord,
): Pick<CandidateRecord, 'first_name' | 'last_name'> {
  return {
    first_name: trimText(raw?.first_name) ?? seed.first_name,
    last_name: trimText(raw?.last_name) ?? seed.last_name,
  };
}

function pickOptionalString<K extends keyof CandidateRecord>(
  key: K,
  value: string | undefined,
  seed: CandidateRecord,
): Partial<CandidateRecord> {
  const next = value ?? (seed[key] as string | undefined);
  return next ? { [key]: next } : {};
}

function pickOptionalBoolean<
  K extends 'open_to_relocation' | 'open_to_remote_work',
>(
  key: K,
  raw: RawCandidate | undefined,
  seed: CandidateRecord,
): Partial<CandidateRecord> {
  const value = raw?.[key] ?? seed[key];
  return value !== undefined ? { [key]: value } : {};
}

function pickOptionalNumber<K extends keyof CandidateRecord>(
  key: K,
  value: number | undefined,
  seed: CandidateRecord,
): Partial<CandidateRecord> {
  const next = value ?? (seed[key] as number | undefined);
  return next != null ? { [key]: next } : {};
}

function omitEmpty(
  key: 'skills',
  existing: string[] | undefined,
): Partial<CandidateRecord> {
  return existing?.length ? { [key]: existing } : {};
}

function normalizeExperience(
  rows: RawCandidateExperience[],
): CandidateExperience[] {
  const out: CandidateExperience[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const company_name = trimText(row.company_name);
    const role = trimText(row.role);
    if (!company_name || !role) continue;
    const key = `${company_name.toLowerCase()}|${role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start_date = normalizeIsoDate(row.start_date);
    const end_date = normalizeIsoDate(row.end_date);
    const company_location = trimText(row.company_location);
    const responsibilities = trimText(row.responsibilities);
    out.push({
      company_name,
      role,
      skills: normalizeSkillNames(row.skills),
      ...(company_location ? { company_location } : {}),
      ...(start_date ? { start_date } : {}),
      ...(end_date ? { end_date } : {}),
      ...(responsibilities ? { responsibilities } : {}),
    });
  }
  return out;
}

function normalizeEducation(
  rows: RawCandidateEducation[],
): CandidateEducation[] {
  const out: CandidateEducation[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const institution_name = trimText(row.institution_name);
    if (!institution_name) continue;
    const institution_type = normalizeInstitutionType(row.institution_type);
    const key = `${institution_name.toLowerCase()}|${institution_type}|${(row.degree ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start_date = normalizeIsoDate(row.start_date);
    const end_date = normalizeIsoDate(row.end_date);
    const institution_location = trimText(row.institution_location);
    const degree = trimText(row.degree);
    const field_of_study = trimText(row.field_of_study);
    const summary = trimText(row.summary);
    const additional_info = trimText(row.additional_info);
    out.push({
      institution_name,
      institution_type,
      ...(institution_location ? { institution_location } : {}),
      ...(degree ? { degree } : {}),
      ...(field_of_study ? { field_of_study } : {}),
      ...(start_date ? { start_date } : {}),
      ...(end_date ? { end_date } : {}),
      ...(summary ? { summary } : {}),
      ...(additional_info ? { additional_info } : {}),
    });
  }
  return out;
}

function mergeSources(
  seed: CandidateSource[],
  extra: RawCandidateSource[],
): CandidateSource[] {
  const out: CandidateSource[] = [];
  const seen = new Set<string>();
  const add = (source: CandidateSource) => {
    const key = (source.url ?? `${source.source ?? ''}|${source.title}`)
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(source);
  };
  for (const source of seed) add(source);
  for (const raw of extra) {
    const title = trimText(raw.title);
    const url = normalizeHttpUrl(raw.url);
    if (!title && !url) continue;
    add({
      title: title ?? url ?? 'Source',
      main: false,
      type: 'SEARCH',
      ...(trimText(raw.source) || trimText(raw.name)
        ? { source: trimText(raw.source) ?? trimText(raw.name) }
        : {}),
      ...(url ? { url } : {}),
    });
  }
  return out;
}

function normalizeInstitutionType(value: string | undefined): InstitutionType {
  if (!value) return 'OTHER';
  const upper = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (INSTITUTION_TYPE_SET.has(upper)) return upper as InstitutionType;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return INSTITUTION_TYPE_ALIASES[key] ?? 'OTHER';
}

export function normalizeIsoDate(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    if (year < 1950 || year > 2030) return undefined;
    return `${trimmed}-01-01T00:00:00.000Z`;
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    return validIso(`${trimmed}-01T00:00:00.000Z`);
  }
  return validIso(trimmed);
}

function validIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeYears(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const years = Math.round(value);
  return years >= 0 && years <= 70 ? years : undefined;
}

function normalizeSalary(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && CURRENCY_RE.test(trimmed)
    ? trimmed.toUpperCase()
    : undefined;
}

function normalizeCountryCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const code = countryCodeFromName(value);
  return code ? (COUNTRY_CODE_ALIASES[code] ?? code) : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const email = trimText(value)?.toLowerCase();
  return email && EMAIL_RE.test(email) ? email : undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const phone = trimText(value);
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 6 ? phone : undefined;
}

function normalizeCallingCode(value: string | undefined): string | undefined {
  const code = trimText(value)?.replace(/\s+/g, '');
  return code && CALLING_CODE_RE.test(code) ? code : undefined;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  const url = trimText(value);
  return url && HTTP_URL_RE.test(url) ? url : undefined;
}

// LinkedIn serves a generic grey-person SVG from static.licdn.com as og:image
// for profiles without a public photo; that is not the candidate's photo.
const LINKEDIN_PLACEHOLDER_IMAGE_RE = /^https?:\/\/static\.licdn\.com\//i;

export function normalizeImageUrl(
  value: string | undefined | null,
): string | undefined {
  const url = normalizeHttpUrl(value ?? undefined);
  return url && !LINKEDIN_PLACEHOLDER_IMAGE_RE.test(url) ? url : undefined;
}

function parsePostalCode(value: string | undefined): string | undefined {
  const postal = trimText(value);
  if (!postal) return undefined;
  if (US_POSTAL_RE.test(postal)) return postal;
  if (GB_POSTAL_RE.test(postal))
    return postal.toUpperCase().replace(/\s+/g, ' ');
  return undefined;
}

function normalizeTerms(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const term = trimText(value);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}
