import {
  locationMatters,
  normalizeWorkTypes,
  remoteAllowed,
  withWorkTypeChildren,
  workTypesFromChildren,
} from './work-types';

describe('work types', () => {
  it('normalizes to valid, unique values in canonical order', () => {
    expect(normalizeWorkTypes(['remote', 'ONSITE', 'x', 'REMOTE'])).toEqual([
      'ONSITE',
      'REMOTE',
    ]);
  });

  it('prefers the work_types child, falling back to the legacy remote flag', () => {
    expect(
      workTypesFromChildren([
        { title: 'work_types', list_value: ['HYBRID'] },
        { title: 'remote_work', boolean: true },
      ]),
    ).toEqual(['HYBRID']);
    expect(
      workTypesFromChildren([{ title: 'remote_work', boolean_value: true }]),
    ).toEqual(['ONSITE', 'REMOTE']);
    expect(workTypesFromChildren([{ title: 'province' }])).toEqual([]);
  });

  it('replaces work children and keeps remote_work in sync', () => {
    expect(
      withWorkTypeChildren(
        [
          { title: 'city', value: 'Cape Town' },
          { title: 'remote_work', boolean_value: false },
          { title: 'work_types', list_value: ['ONSITE'] },
        ],
        ['REMOTE', 'HYBRID'],
      ),
    ).toEqual([
      { title: 'city', value: 'Cape Town' },
      { title: 'work_types', list_value: ['HYBRID', 'REMOTE'] },
      { title: 'remote_work', boolean_value: true },
    ]);
  });

  it('allows remote only with REMOTE, and says location matters unless remote-only', () => {
    expect(remoteAllowed({ remoteWork: false, workTypes: ['REMOTE'] })).toBe(
      true,
    );
    expect(remoteAllowed({ remoteWork: true, workTypes: ['ONSITE'] })).toBe(
      false,
    );
    expect(remoteAllowed({ remoteWork: true })).toBe(true);
    expect(locationMatters({ remoteWork: true, workTypes: ['REMOTE'] })).toBe(
      false,
    );
    expect(
      locationMatters({ remoteWork: true, workTypes: ['HYBRID', 'REMOTE'] }),
    ).toBe(true);
    expect(locationMatters({ remoteWork: false, workTypes: [] })).toBe(true);
  });
});
