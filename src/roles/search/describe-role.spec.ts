import { describeRole } from './describe-role';
import { ParsedRoleFilters } from './role-filter-parser';

describe('describeRole', () => {
  it('lists each criterion with its priority and non-negotiable tag', () => {
    const filters: ParsedRoleFilters = {
      jobTitles: [
        {
          priority: 'ESSENTIAL',
          nonNegotiable: false,
          value: {
            titles: ['React Native Developer'],
            option: 'main_title',
          },
        },
      ],
      location: {
        priority: 'ESSENTIAL',
        nonNegotiable: false,
        value: {
          countryCode: 'ZA',
          regions: [{ type: 'city', value: 'Cape Town' }],
          remoteWork: true,
          workAuthorizationRequired: false,
        },
      },
      skills: [
        {
          priority: 'ESSENTIAL',
          nonNegotiable: true,
          value: ['TypeScript'],
        },
        { priority: 'OPTIONAL', nonNegotiable: false, value: ['Expo'] },
      ],
      languages: [],
      companies: [
        {
          priority: 'ESSENTIAL',
          nonNegotiable: false,
          value: { names: ['Takealot'], type: 'exclude' },
        },
      ],
      education: [],
      experience: {
        priority: 'OPTIONAL',
        nonNegotiable: false,
        value: { minYears: 5 },
      },
    };

    expect(describeRole(filters).split('\n')).toEqual([
      '- Job titles: React Native Developer [ESSENTIAL]',
      '- Location: Cape Town, South Africa; remote OK [ESSENTIAL]',
      '- Essential skills: TypeScript [ESSENTIAL, NON-NEGOTIABLE]',
      '- Nice-to-have skills: Expo [OPTIONAL]',
      '- Must NOT currently work at: Takealot [ESSENTIAL]',
      '- Experience: at least 5 years [OPTIONAL]',
    ]);
  });
});
