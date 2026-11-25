import { ParsedFilterRow, ParsedRoleFilters } from './role-filter-parser';

// Look deeper: once the role's own query runs out of pages, search again with
// only what the role can't do without — job titles, location and
// non-negotiables. The other essentials still count in scoring; they just
// stop narrowing what Vertex returns. Null when that wouldn't change the
// query, so there's nothing deeper to look at.
export function broadenFilters(
  filters: ParsedRoleFilters,
): ParsedRoleFilters | null {
  let changed = false;
  const relax = <T>(row: ParsedFilterRow<T>): ParsedFilterRow<T> => {
    if (row.priority !== 'ESSENTIAL' || row.nonNegotiable) return row;
    changed = true;
    return { ...row, priority: 'OPTIONAL' };
  };

  const broad: ParsedRoleFilters = {
    ...filters,
    skills: filters.skills.map(relax),
    languages: filters.languages.map(relax),
    industry: filters.industry && relax(filters.industry),
    // Excluded companies are the user saying "not these people": keep them.
    companies: filters.companies.map((row) =>
      row.value.type === 'exclude' ? row : relax(row),
    ),
    education: filters.education.map(relax),
  };
  return changed ? broad : null;
}
