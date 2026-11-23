import { countryName } from './location-gate';
import { ParsedFilterRow, ParsedRoleFilters } from './role-filter-parser';
import { WorkType, remoteAllowed } from './work-types';

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  ONSITE: 'on-site',
  HYBRID: 'hybrid',
  REMOTE: 'remote',
};

function line<T>(
  label: string,
  row: ParsedFilterRow<T>,
  text: string,
): string | undefined {
  if (!text.trim()) return undefined;
  const tags = [row.priority, ...(row.nonNegotiable ? ['NON-NEGOTIABLE'] : [])];
  return `- ${label}: ${text} [${tags.join(', ')}]`;
}

// A compact, model-readable brief of the role, shared by snippet scoring
// and deep research so both judge candidates against the same criteria.
export function describeRole(filters: ParsedRoleFilters): string {
  const lines: (string | undefined)[] = [];
  const { location } = filters;

  for (const row of filters.jobTitles) {
    const label =
      row.value.option === 'alternative_title'
        ? 'Alternative job titles'
        : 'Job titles';
    lines.push(line(label, row, row.value.titles.join(', ')));
  }
  if (location) {
    const { countryCode, regions, workTypes, workAuthorizationRequired } =
      location.value;
    const places = [
      ...regions.map((region) => region.value),
      countryName(countryCode) ?? countryCode,
    ].filter(Boolean);
    const extras = [
      ...(workTypes?.length
        ? [
            `work type: ${workTypes.map((type) => WORK_TYPE_LABELS[type]).join(' / ')}`,
          ]
        : remoteAllowed(location.value)
          ? ['remote OK']
          : []),
      ...(workAuthorizationRequired ? ['work authorisation required'] : []),
    ];
    lines.push(
      line(
        'Location',
        location,
        [places.join(', '), ...extras].filter(Boolean).join('; '),
      ),
    );
  }
  for (const row of filters.skills) {
    const label =
      row.priority === 'ESSENTIAL' ? 'Essential skills' : 'Nice-to-have skills';
    lines.push(line(label, row, row.value.join(', ')));
  }
  for (const row of filters.languages) {
    lines.push(line('Languages', row, row.value.join(', ')));
  }
  if (filters.industry) {
    lines.push(line('Industry', filters.industry, filters.industry.value));
  }
  for (const row of filters.companies) {
    const label =
      row.value.type === 'exclude'
        ? 'Must NOT currently work at'
        : 'Has worked at one of';
    lines.push(line(label, row, row.value.names.join(', ')));
  }
  for (const row of filters.education) {
    const { qualifications, institutions, institutionType } = row.value;
    const where = institutions.length
      ? `; institutions ${institutionType === 'exclude' ? 'NOT ' : ''}${institutions.join(', ')}`
      : '';
    lines.push(line('Education', row, `${qualifications.join(', ')}${where}`));
  }
  if (filters.experience && filters.experience.value.minYears > 0) {
    lines.push(
      line(
        'Experience',
        filters.experience,
        `at least ${filters.experience.value.minYears} years`,
      ),
    );
  }

  return lines.filter(Boolean).join('\n');
}
