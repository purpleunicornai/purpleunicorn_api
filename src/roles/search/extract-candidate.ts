import { protos } from '@google-cloud/discoveryengine';
import { isLinkedInProfileUrl } from './is-linkedin-profile';
import {
  candidateKey,
  normalizeImageUrl,
  seedCandidate,
  type CandidateRecord,
} from './candidate-profile';

type SearchResult =
  protos.google.cloud.discoveryengine.v1.SearchResponse.ISearchResult;
type ProtoValue = protos.google.protobuf.IValue;
type ProtoStruct = protos.google.protobuf.IStruct;

export interface Candidate {
  name: string;
  key: string;
  headline?: string;
  company?: string;
  location?: string;
  linkedinUrl: string;
  snippet?: string;
  imageUrl?: string;
  // Present when a search ran location and remote queries in parallel.
  matchedBy?: 'location' | 'remote';
  candidate: CandidateRecord;
}

// Vertex hands back derivedStructData as a protobuf Struct
// ({ fields: { link: { stringValue } } }); flatten it to plain JSON so the
// rest of this file reads it like a normal object.
function toPlain(value: ProtoValue | null | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue != null) return value.stringValue;
  if (value.numberValue != null) return value.numberValue;
  if (value.boolValue != null) return value.boolValue;
  if (value.structValue) return structToObject(value.structValue);
  if (value.listValue) return (value.listValue.values ?? []).map(toPlain);
  return undefined;
}

function structToObject(
  struct: ProtoStruct | null | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(struct?.fields ?? {}).map(([key, value]) => [
      key,
      toPlain(value),
    ]),
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  return first && typeof first === 'object'
    ? (first as Record<string, unknown>)
    : undefined;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// LinkedIn profile titles read "Name - Headline - Company | LinkedIn" (or
// "... - LinkedIn"), and some people put "|" in their name line too, e.g.
// "Jane Doe | Mobile Developer". Headline and company are each optional.
function parseTitle(title: string) {
  const [name, headline, ...rest] = title
    .replace(/\s*[-–|]\s*LinkedIn\s*$/i, '')
    .split(/\s+[-–|]\s+/)
    .map((part) => part.trim());
  return {
    name: name ?? '',
    headline: headline || undefined,
    company: rest.join(' - ') || undefined,
  };
}

// Profile snippets usually carry "Location: Cape Town · 500+ connections".
function parseLocation(snippet?: string): string | undefined {
  const location = snippet?.match(/Location:\s*([^·|\n]+)/i)?.[1].trim();
  // Some cached pages leak LinkedIn's unrendered "{:currentLocation}".
  return location && !/[{}]/.test(location) ? location : undefined;
}

// One clean candidate per LinkedIn profile result; anything that isn't a
// profile page (job posts, company pages) returns null.
export function extractCandidate(result: SearchResult): Candidate | null {
  const data = structToObject(result.document?.derivedStructData);
  const link = asString(data.link);
  if (!isLinkedInProfileUrl(link)) return null;

  const metatags = firstRecord(
    (data.pagemap as Record<string, unknown> | undefined)?.metatags,
  );
  const rawSnippet =
    asString(firstRecord(data.snippets)?.snippet) ??
    asString(metatags?.['og:description']);
  const snippet = rawSnippet ? stripHtml(rawSnippet) : undefined;
  const title = asString(data.title) ?? asString(metatags?.['og:title']) ?? '';
  const key = candidateKey(link);
  if (!key) return null;
  const parsed = parseTitle(stripHtml(title));
  const location = parseLocation(snippet);
  const imageUrl = extractImageUrl(data, metatags);

  return {
    ...parsed,
    key,
    location,
    linkedinUrl: link,
    snippet,
    ...(imageUrl ? { imageUrl } : {}),
    candidate: seedCandidate({
      name: parsed.name,
      headline: parsed.headline,
      company: parsed.company,
      location,
      linkedinUrl: link,
      imageUrl,
    }),
  };
}

function extractImageUrl(
  data: Record<string, unknown>,
  metatags: Record<string, unknown> | undefined,
): string | undefined {
  const pagemap = data.pagemap as Record<string, unknown> | undefined;
  // The first real photo: og:image is LinkedIn's placeholder when the
  // profile has no public photo, so fall through to the CSE images.
  return [
    asString(metatags?.['og:image']),
    asString(firstRecord(pagemap?.cse_image)?.src),
    asString(firstRecord(pagemap?.cse_thumbnail)?.src),
  ]
    .map((url) => normalizeImageUrl(url))
    .find(Boolean);
}
