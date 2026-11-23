import { z } from 'zod';

// AI-elaborated Boolean OR groups for a saved filter set, e.g. the title
// "founder" -> [founder, co-founder, entrepreneur, startup, side hustle].
// Generated once when the filter set is saved (RolesService.createFilter),
// stored under role_filters.metadata.criterionExpansions, and reused as-is by
// every search run, so a rerun makes no AI call and sends the same query.
// Expansions only widen the Google x-ray query; scoring still uses the
// recruiter's literal criteria.

export const EXPANSION_CATEGORIES = ['job_titles', 'skills'] as const;
export type ExpansionCategory = (typeof EXPANSION_CATEGORIES)[number];

export const MAX_TERMS_PER_SEED = 8;
export const MAX_TERM_LENGTH = 60;

const termSchema = z.string().trim().min(1);

const expansionGroupSchema = z.object({
  seed: termSchema,
  // Always starts with the seed itself.
  terms: z.array(termSchema).min(1),
});

const expansionsByCategorySchema = z.object({
  job_titles: z.array(expansionGroupSchema).optional(),
  skills: z.array(expansionGroupSchema).optional(),
});

export const criterionExpansionsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  model: z.string().min(1),
  byCategory: expansionsByCategorySchema,
});

const filterMetadataSchema = z.object({
  criterionExpansions: criterionExpansionsSchema,
});

export type ExpansionGroup = z.infer<typeof expansionGroupSchema>;
export type ExpansionsByCategory = z.infer<typeof expansionsByCategorySchema>;
export type CriterionExpansions = z.infer<typeof criterionExpansionsSchema>;

// Seeds are the recruiter's own title/skill strings, in filter order.
export type ExpansionSeeds = Record<ExpansionCategory, string[]>;

// Structural subset of FilterItemDto, so this module doesn't depend on the
// HTTP DTO classes.
export interface ExpansionSeedSource {
  category: string;
  list_value?: string[];
  children?: { title: string; value?: string }[];
}

export interface GeneratedExpansions {
  byCategory: ExpansionsByCategory;
  model: string;
  generatedAt: string;
}

export function seedKey(seed: string): string {
  return seed.trim().toLowerCase();
}

// Boundary decode: role_filters.metadata is arbitrary JSON. Anything that
// isn't a valid v1 expansion block (old `{}` rows, hand edits) means "no
// expansions", and the search falls back to its literal query.
export function parseCriterionExpansions(
  metadata: unknown,
): CriterionExpansions | null {
  const parsed = filterMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.criterionExpansions : null;
}

export function termsForSeed(
  expansions: CriterionExpansions | null,
  category: ExpansionCategory,
  seed: string,
): string[] {
  const key = seedKey(seed);
  return (
    expansions?.byCategory[category]?.find(
      (group) => seedKey(group.seed) === key,
    )?.terms ?? []
  );
}

// Mirrors the Vertex query builder's title selection (first main
// row, else the role name; first alternative row capped at 3, else the role
// name) so every title that can reach a query gets a group, and no AI call is
// spent on one that can't.
export function collectExpansionSeeds(
  items: readonly ExpansionSeedSource[],
  roleName: string,
): ExpansionSeeds {
  const titleRows = items.filter((item) => item.category === 'job_titles');
  const isAlternative = (item: ExpansionSeedSource) =>
    item.children?.find((child) => child.title === 'title_option')?.value ===
    'alternative_title';
  const mainTitles =
    titleRows.find((item) => !isAlternative(item))?.list_value ?? [];
  const alternativeTitles =
    titleRows.find((item) => isAlternative(item))?.list_value ?? [];
  const fallback = roleName.trim() ? [roleName] : [];

  return {
    job_titles: uniqueSeeds([
      ...(mainTitles.some((title) => title.trim()) ? mainTitles : fallback),
      ...(alternativeTitles.some((title) => title.trim())
        ? alternativeTitles.slice(0, 3)
        : fallback),
    ]),
    skills: uniqueSeeds(
      items
        .filter((item) => item.category === 'skills')
        .flatMap((item) => item.list_value ?? []),
    ),
  };
}

export function seedsMissingFrom(
  expansions: CriterionExpansions | null,
  seeds: ExpansionSeeds,
): ExpansionSeeds {
  const missing = (category: ExpansionCategory) =>
    seeds[category].filter(
      (seed) => termsForSeed(expansions, category, seed).length === 0,
    );
  return { job_titles: missing('job_titles'), skills: missing('skills') };
}

export function hasSeeds(seeds: ExpansionSeeds): boolean {
  return EXPANSION_CATEGORIES.some((category) => seeds[category].length > 0);
}

// Central post-processing of a model's raw groups: in seed order, seed first
// and in the recruiter's own casing, case-insensitively deduped, over-long
// terms dropped, capped at MAX_TERMS_PER_SEED. A seed with no alternate term
// left (skipped by the model, or only the seed echoed back) gets no group, so
// it stays literal and the next save asks again.
export function normalizeExpansionGroups(
  seeds: ExpansionSeeds,
  raw: readonly { category: string; seed: string; terms: string[] }[],
): ExpansionsByCategory {
  const byCategory: ExpansionsByCategory = {};
  for (const category of EXPANSION_CATEGORIES) {
    const groups = seeds[category].flatMap((seed): ExpansionGroup[] => {
      const key = seedKey(seed);
      const generated = raw
        .filter((group) => group.category === category)
        .find((group) => seedKey(group.seed) === key);
      const terms = normalizeTerms(seed, generated?.terms ?? []);
      return terms.length > 1 ? [{ seed: seed.trim(), terms }] : [];
    });
    if (groups.length > 0) byCategory[category] = groups;
  }
  return byCategory;
}

// Builds the saved block for the new filter set: each current seed takes its
// previously saved group when there is one (a saved [seed]-only group
// included, so it is not asked for again), else the freshly generated one,
// else none (it stays a literal term). When no fresh group is used, the
// previous model/generatedAt are kept so an unchanged save stores identical
// metadata.
export function mergeExpansions({
  seeds,
  previous,
  generated,
}: {
  seeds: ExpansionSeeds;
  previous: CriterionExpansions | null;
  generated: GeneratedExpansions | null;
}): CriterionExpansions | null {
  const byCategory: ExpansionsByCategory = {};
  let usedGenerated = false;
  for (const category of EXPANSION_CATEGORIES) {
    const groups = seeds[category].flatMap((seed): ExpansionGroup[] => {
      const key = seedKey(seed);
      const saved = previous?.byCategory[category]?.find(
        (g) => seedKey(g.seed) === key,
      );
      if (saved) return [saved];
      const fresh = generated?.byCategory[category]?.find(
        (g) => seedKey(g.seed) === key,
      );
      if (fresh) usedGenerated = true;
      return fresh ? [fresh] : [];
    });
    if (groups.length > 0) byCategory[category] = groups;
  }
  if (Object.keys(byCategory).length === 0) return null;

  const stamp = usedGenerated ? generated : previous;
  if (!stamp) return null;
  return {
    version: 1,
    generatedAt: stamp.generatedAt,
    model: stamp.model,
    byCategory,
  };
}

// Layers recruiter-edited groups (from the save request) over the previous
// filter set's groups. An edited group replaces the saved one for its seed
// and is kept even when only the seed is left (every alternative removed),
// so mergeExpansions reuses it and it is never regenerated. Edits for seeds
// that aren't in this filter set are ignored. Returns `previous` untouched
// when there is nothing to apply.
export const EDITED_EXPANSIONS_MODEL = 'recruiter-edited';

export function applyExpansionOverrides({
  seeds,
  previous,
  overrides,
  now = new Date(),
}: {
  seeds: ExpansionSeeds;
  previous: CriterionExpansions | null;
  overrides: Partial<Record<ExpansionCategory, ExpansionGroup[]>> | undefined;
  now?: Date;
}): CriterionExpansions | null {
  const byCategory: ExpansionsByCategory = { ...(previous?.byCategory ?? {}) };
  let applied = false;
  for (const category of EXPANSION_CATEGORIES) {
    const edits = overrides?.[category] ?? [];
    for (const seed of seeds[category]) {
      const key = seedKey(seed);
      const edit = edits.find((group) => seedKey(group.seed) === key);
      if (!edit) continue;
      const kept = (byCategory[category] ?? []).filter(
        (group) => seedKey(group.seed) !== key,
      );
      byCategory[category] = [
        ...kept,
        { seed: seed.trim(), terms: normalizeTerms(seed, edit.terms) },
      ];
      applied = true;
    }
  }
  if (!applied) return previous;
  return {
    version: 1,
    generatedAt: previous?.generatedAt ?? now.toISOString(),
    model: previous?.model ?? EDITED_EXPANSIONS_MODEL,
    byCategory,
  };
}

function normalizeTerms(seed: string, terms: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string, enforceLength: boolean) => {
    const term = raw.replace(/\s+/g, ' ').trim();
    if (!term || (enforceLength && term.length > MAX_TERM_LENGTH)) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(term);
  };
  add(seed, false);
  for (const term of terms) add(term, true);
  return result.slice(0, MAX_TERMS_PER_SEED);
}

function uniqueSeeds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const seed = value.trim();
    const key = seed.toLowerCase();
    if (!seed || seen.has(key)) continue;
    seen.add(key);
    result.push(seed);
  }
  return result;
}
