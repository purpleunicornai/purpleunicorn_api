import { parseTraits, traitsOf } from './lookalike';

const seed = {
  current_title: 'Finance Manager',
  current_company: 'Northvale Capital',
  current_location_city: 'Cape Town',
  current_location_country_code: 'ZA',
  experience_roles: ['Senior Accountant', 'Finance Manager'],
  experience_years: 8,
  skills: ['IFRS', 'Treasury', 'CA(SA)', 'Budgeting', 'Consolidations', 'Tax'],
};

describe('traitsOf', () => {
  it("turns the seed's profile into Essential and Optional filter rows", () => {
    const traits = traitsOf(seed);
    expect(
      traits.map((t) => [t.category, t.priority, t.list_value ?? t.value]),
    ).toEqual([
      ['job_titles', 'ESSENTIAL', ['Finance Manager', 'Senior Accountant']],
      ['experience', 'OPTIONAL', '8'],
      ['skills', 'ESSENTIAL', ['IFRS', 'Treasury', 'CA(SA)', 'Budgeting']],
      ['skills', 'OPTIONAL', ['Consolidations', 'Tax']],
      ['companies', 'OPTIONAL', ['Northvale Capital']],
      ['location', 'ESSENTIAL', 'ZA'],
    ]);
  });

  it('leaves out what the profile does not have', () => {
    const traits = traitsOf({
      ...seed,
      current_company: null,
      current_location_country_code: null,
      experience_years: null,
      skills: [],
    });
    expect(traits.map((t) => t.category)).toEqual(['job_titles']);
  });

  it('parses edited traits like stored filters', () => {
    const parsed = parseTraits(traitsOf(seed));
    expect(parsed.jobTitles[0].value.titles).toEqual([
      'Finance Manager',
      'Senior Accountant',
    ]);
    expect(parsed.experience?.value.minYears).toBe(8);
    expect(parsed.location?.value.countryCode).toBe('ZA');
    expect(parsed.companies[0].value).toMatchObject({
      names: ['Northvale Capital'],
      type: 'include',
    });
  });
});
