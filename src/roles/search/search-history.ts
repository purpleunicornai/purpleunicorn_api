import { countryName } from './filter-terms';
import { parseSearchProgress, type SearchRunStatus } from './search-progress';
import { workTypesFromChildren, type WorkType } from './work-types';

// Search history: every searched filter set is one run. Saving filters
// archives the previous set (with its results), so the sets themselves are
// the history; nothing extra is stored.

type Child = {
  title: string;
  value: string | null;
  list_value: string[];
  boolean: boolean | null;
};
export type HistoryItem = {
  category: string;
  value: string | null;
  list_value: string[];
  children: Child[];
};
export type HistoryFilterSet = {
  uid: string;
  role_id: string;
  archived: boolean;
  search_run_date: Date | null;
  search_run_by: string | null;
  search_run_by_id: string | null;
  metadata: unknown;
  role: { name: string; project_id: string; project: { name: string } };
  role_filter_items: HistoryItem[];
};
// Results that count: not-suitable ones are left out like every summary.
export type HistoryResult = {
  filter_id: string | null;
  candidate_uid: string | null;
  score: number | null;
};

export type SearchRun = {
  id: string;
  roleId: string;
  roleName: string;
  projectId: string;
  projectName: string;
  current: boolean;
  ranAt: string;
  ranBy: string | null;
  ranById: string | null;
  status: SearchRunStatus;
  error: string | null;
  pagesLoaded: number;
  estimatedTotal: number | null;
  candidates: number;
  topScore: number | null;
  // Candidates this run found that the role's previous run didn't.
  newCandidates: number;
  // A run is one plan search; a failed one isn't counted. Never credits.
  searchesUsed: 0 | 1;
  brief: string;
  added: string[];
  removed: string[];
};

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  ONSITE: 'On-site',
  HYBRID: 'Hybrid',
  REMOTE: 'Remote',
};

// Each filter row as the short phrases a recruiter reads, e.g.
// "Exclude Deloitte" or "6+ years experience".
export function filterTerms(item: HistoryItem): string[] {
  const child = (title: string) =>
    item.children.find((c) => c.title === title)?.value;
  switch (item.category) {
    case 'location': {
      const place = [
        child('region'),
        countryName(item.value ?? '') ?? item.value,
      ]
        .filter(Boolean)
        .join(', ');
      const work = workTypesFromChildren(item.children)
        .map((t) => WORK_TYPE_LABELS[t])
        .join(', ');
      return [place, work].filter(Boolean);
    }
    case 'experience':
      return item.value ? [`${item.value}+ years experience`] : [];
    case 'companies': {
      const exclude = child('company_type') === 'exclude';
      return item.list_value.map((n) => (exclude ? `Exclude ${n}` : n));
    }
    default:
      return [item.value, ...item.list_value].filter((v): v is string => !!v);
  }
}

const termsOf = (set: HistoryFilterSet) =>
  set.role_filter_items.flatMap(filterTerms);

// Newest first. `results` may cover any of the sets.
export function toSearchRuns(
  sets: HistoryFilterSet[],
  results: HistoryResult[],
): SearchRun[] {
  const ran = sets
    .filter((s) => s.search_run_date)
    .sort((a, b) => +b.search_run_date! - +a.search_run_date!);
  const bySet = new Map<string, HistoryResult[]>();
  for (const r of results) {
    if (r.filter_id)
      bySet.set(r.filter_id, [...(bySet.get(r.filter_id) ?? []), r]);
  }

  return ran.map((set, index) => {
    const previous = ran
      .slice(index + 1)
      .find((s) => s.role_id === set.role_id);
    const mine = bySet.get(set.uid) ?? [];
    const before = new Set(
      (previous ? (bySet.get(previous.uid) ?? []) : []).map(
        (r) => r.candidate_uid,
      ),
    );
    const terms = termsOf(set);
    const previousTerms = previous ? termsOf(previous) : [];
    const progress = parseSearchProgress(set.metadata);
    const status = progress?.status ?? 'complete';
    const scores = mine.flatMap((r) => (r.score == null ? [] : [r.score]));

    return {
      id: set.uid,
      roleId: set.role_id,
      roleName: set.role.name,
      projectId: set.role.project_id,
      projectName: set.role.project.name,
      current: !set.archived,
      ranAt: set.search_run_date!.toISOString(),
      ranBy: set.search_run_by,
      ranById: set.search_run_by_id,
      status,
      error: progress?.error ?? null,
      pagesLoaded: progress?.pagesLoaded ?? 0,
      estimatedTotal: progress?.estimatedTotal ?? null,
      candidates: mine.length,
      topScore: scores.length ? Math.max(...scores) : null,
      newCandidates: mine.filter((r) => !before.has(r.candidate_uid)).length,
      searchesUsed: status === 'failed' ? 0 : 1,
      brief: terms.join(', '),
      added: previous ? terms.filter((t) => !previousTerms.includes(t)) : [],
      removed: previousTerms.filter((t) => !terms.includes(t)),
    };
  });
}
