import { candidate } from '../../generated/prisma/client';
import { RoleFilterPriority } from '../../generated/prisma/enums';
import { FilterItemDto } from '../dto/role_filter.dto';
import { parseRoleFilters, ParsedRoleFilters } from './role-filter-parser';

type Seed = Pick<
  candidate,
  | 'current_title'
  | 'current_company'
  | 'current_location_city'
  | 'current_location_country_code'
  | 'experience_roles'
  | 'experience_years'
  | 'skills'
>;

const unique = (values: (string | null | undefined)[]) =>
  [
    ...new Set(values.map((value) => value?.trim()).filter((v) => !!v)),
  ] as string[];

// "Find more like this": the seed candidate's profile as editable filter
// rows. What defines the person (title, skills, location) starts Essential;
// the rest Optional. Nothing here calls an AI.
export function traitsOf(seed: Seed): FilterItemDto[] {
  const titles = unique([seed.current_title, ...seed.experience_roles]).slice(
    0,
    3,
  );
  const skills = unique(seed.skills);
  const traits: FilterItemDto[] = [];
  if (titles.length)
    traits.push({
      category: 'job_titles',
      list_value: titles,
      priority: 'ESSENTIAL',
      non_negotiable: false,
    });
  if (seed.experience_years)
    traits.push({
      category: 'experience',
      value: String(seed.experience_years),
      priority: 'OPTIONAL',
      non_negotiable: false,
    });
  if (skills.length)
    traits.push({
      category: 'skills',
      list_value: skills.slice(0, 4),
      priority: 'ESSENTIAL',
      non_negotiable: false,
    });
  if (skills.length > 4)
    traits.push({
      category: 'skills',
      list_value: skills.slice(4, 8),
      priority: 'OPTIONAL',
      non_negotiable: false,
    });
  if (seed.current_company)
    traits.push({
      category: 'companies',
      list_value: [seed.current_company],
      priority: 'OPTIONAL',
      non_negotiable: false,
      children: [{ title: 'company_type', value: 'include' }],
    });
  if (seed.current_location_country_code)
    traits.push({
      category: 'location',
      value: seed.current_location_country_code,
      priority: 'ESSENTIAL',
      non_negotiable: false,
      children: seed.current_location_city
        ? [{ title: 'city', value: seed.current_location_city }]
        : [],
    });
  return traits;
}

// Unsaved trait rows parsed the same way as a role's stored filters.
export function parseTraits(items: FilterItemDto[]): ParsedRoleFilters {
  return parseRoleFilters(
    items.map((item, index) => ({
      uid: `trait-${index}`,
      created: new Date(0),
      updated: new Date(0),
      role_filter_id: null,
      job_spec_import_id: null,
      category: item.category,
      value: item.value ?? null,
      list_value: item.list_value ?? [],
      priority: item.priority as RoleFilterPriority,
      non_negotiable: item.non_negotiable ?? false,
      children: (item.children ?? []).map((child, childIndex) => ({
        uid: `trait-${index}-${childIndex}`,
        created: new Date(0),
        updated: new Date(0),
        parent_uid: `trait-${index}`,
        title: child.title,
        value: child.value ?? null,
        list_value: child.list_value ?? [],
        boolean: child.boolean_value ?? false,
      })),
    })),
  );
}
