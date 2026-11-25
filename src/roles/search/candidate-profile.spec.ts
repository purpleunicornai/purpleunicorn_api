import {
  candidateKey,
  normalizeCandidate,
  normalizeImageUrl,
  normalizeIsoDate,
  normalizeSkillName,
  normalizeSkillNames,
  parseLocationFields,
  seedCandidate,
  splitName,
} from './candidate-profile';

describe('candidateKey', () => {
  it('returns the lowercase /in/ slug, ignoring host, slash and query', () => {
    expect(candidateKey('https://za.linkedin.com/in/jane-doe-123')).toBe(
      'jane-doe-123',
    );
    expect(candidateKey('https://www.linkedin.com/in/Jane-Doe-123/')).toBe(
      'jane-doe-123',
    );
    expect(
      candidateKey('https://linkedin.com/in/jane-doe-123?trk=public'),
    ).toBe('jane-doe-123');
  });

  it('decodes a percent-encoded slug', () => {
    expect(
      candidateKey('https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller'),
    ).toBe('jörg-müller');
  });

  it('returns undefined for non-profile URLs', () => {
    expect(
      candidateKey('https://www.linkedin.com/jobs/view/123'),
    ).toBeUndefined();
    expect(candidateKey('not a url')).toBeUndefined();
  });
});

describe('normalizeSkillName', () => {
  it('trims, lowercases and applies the common aliases', () => {
    expect(normalizeSkillName('  ReactJS ')).toBe('react');
    expect(normalizeSkillName('React.js')).toBe('react');
    expect(normalizeSkillName('JS')).toBe('javascript');
    expect(normalizeSkillName('React-Native')).toBe('react native');
    expect(normalizeSkillName('react native')).toBe('react native');
    expect(normalizeSkillName('TypeScript')).toBe('typescript');
  });

  it('returns undefined for blank names', () => {
    expect(normalizeSkillName('   ')).toBeUndefined();
  });
});

describe('normalizeSkillNames', () => {
  it('dedupes by canonical name and drops blanks', () => {
    expect(
      normalizeSkillNames(['ReactJS', 'react', 'JS', '  ', 'TypeScript']),
    ).toEqual(['react', 'javascript', 'typescript']);
  });
});

describe('splitName', () => {
  it('splits the first token from the rest', () => {
    expect(splitName('Jane Doe')).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
    });
    expect(splitName('Jean-Luc Picard')).toEqual({
      first_name: 'Jean-Luc',
      last_name: 'Picard',
    });
    expect(splitName('Ryan H.')).toEqual({
      first_name: 'Ryan',
      last_name: 'H.',
    });
    expect(splitName('Madonna')).toEqual({ first_name: 'Madonna' });
  });
});

describe('parseLocationFields', () => {
  it('pulls city, country code and a postal code out of a LinkedIn location', () => {
    expect(parseLocationFields('Austin, Texas, United States')).toEqual({
      current_location_city: 'Austin',
      current_location_country_code: 'US',
    });
    expect(parseLocationFields('Cape Town')).toEqual({
      current_location_city: 'Cape Town',
    });
    expect(parseLocationFields('London, UK, TW11 8EE')).toEqual({
      current_location_city: 'London',
      current_location_country_code: 'GB',
      current_location_postal_code: 'TW11 8EE',
    });
  });
});

describe('normalizeIsoDate', () => {
  it('expands a year or year-month to an ISO timestamp', () => {
    expect(normalizeIsoDate('2021')).toBe('2021-01-01T00:00:00.000Z');
    expect(normalizeIsoDate('2021-06')).toBe('2021-06-01T00:00:00.000Z');
    expect(normalizeIsoDate('2021-06-18')).toBe('2021-06-18T00:00:00.000Z');
  });

  it('drops absurd or unparseable values', () => {
    expect(normalizeIsoDate('1800')).toBeUndefined();
    expect(normalizeIsoDate('not a date')).toBeUndefined();
  });
});

describe('seedCandidate', () => {
  it('builds the API candidate shape from a LinkedIn snippet', () => {
    expect(
      seedCandidate({
        name: 'Jane Doe',
        headline: 'Senior React Native Developer',
        company: 'Acme',
        location: 'Cape Town, South Africa',
        linkedinUrl: 'https://za.linkedin.com/in/jane-doe-123',
        imageUrl: 'https://media.licdn.com/jane.jpg',
      }),
    ).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      current_title: 'Senior React Native Developer',
      current_company: 'Acme',
      current_location_city: 'Cape Town',
      current_location_country_code: 'ZA',
      image_url: 'https://media.licdn.com/jane.jpg',
      sources: [
        {
          title: 'Jane Doe - Senior React Native Developer - Acme',
          source: 'LinkedIn',
          url: 'https://za.linkedin.com/in/jane-doe-123',
          main: true,
          type: 'SEARCH',
        },
      ],
    });
  });
});

describe('normalizeCandidate', () => {
  const seed = seedCandidate({
    name: 'Jane Doe',
    headline: 'Mobile Developer',
    company: 'Acme',
    location: 'Cape Town',
    linkedinUrl: 'https://za.linkedin.com/in/jane-doe-123',
  });

  it('overlays grounded fields onto the seed and normalizes units', () => {
    expect(
      normalizeCandidate(
        {
          current_title: '  Senior React Native Developer ',
          current_company: 'Acme',
          current_location_city: 'Cape Town',
          current_location_country_code: 'south africa',
          experience_years: 8,
          languages: ['English', 'ENGLISH'],
          skills: ['React Native', 'ReactJS', 'TypeScript'],
          current_role_start_date: '2024',
          current_salary: 85000,
          current_salary_currency: 'zar',
          email: 'jane@example.com',
          additional_sources: [
            {
              title: 'GitHub',
              name: 'GitHub',
              url: 'https://github.com/jane',
            },
          ],
          experience: [
            {
              company_name: 'Acme',
              role: 'Senior React Native Developer',
              start_date: '2024',
              skills: ['React Native'],
            },
            { company_name: 'No Role Inc.' },
          ],
          education: [
            {
              institution_name: 'University of Cape Town',
              institution_type: 'university',
              degree: "Bachelor's Degree",
              field_of_study: 'Computer Science',
              start_date: '2016',
              end_date: '2020-06',
            },
          ],
        },
        seed,
      ),
    ).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      current_title: 'Senior React Native Developer',
      current_company: 'Acme',
      current_location_city: 'Cape Town',
      current_location_country_code: 'ZA',
      experience_years: 8,
      current_role_start_date: '2024-01-01T00:00:00.000Z',
      current_salary: 85000,
      current_salary_currency: 'ZAR',
      languages: ['English'],
      skills: ['react native', 'react', 'typescript'],
      sources: [
        {
          title: 'Jane Doe - Mobile Developer - Acme',
          source: 'LinkedIn',
          url: 'https://za.linkedin.com/in/jane-doe-123',
          main: true,
          type: 'SEARCH',
        },
        {
          title: 'GitHub',
          source: 'GitHub',
          url: 'https://github.com/jane',
          main: false,
          type: 'SEARCH',
        },
      ],
      experience: [
        {
          company_name: 'Acme',
          role: 'Senior React Native Developer',
          start_date: '2024-01-01T00:00:00.000Z',
          skills: ['react native'],
        },
      ],
      education: [
        {
          institution_name: 'University of Cape Town',
          institution_type: 'UNIVERSITY',
          degree: "Bachelor's Degree",
          field_of_study: 'Computer Science',
          start_date: '2016-01-01T00:00:00.000Z',
          end_date: '2020-06-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('keeps the seed when Gemini returns nothing useful, and drops invented contact or years', () => {
    const result = normalizeCandidate(
      {
        email: 'not-an-email',
        experience_years: 140,
        phone: 'abc',
      },
      seed,
    );
    expect(result.first_name).toBe('Jane');
    expect(result.current_title).toBe('Mobile Developer');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('experience_years');
  });

  describe('normalizeImageUrl', () => {
    it("keeps a real photo and drops LinkedIn's placeholder and non-URLs", () => {
      expect(normalizeImageUrl(' https://media.licdn.com/jane.jpg ')).toBe(
        'https://media.licdn.com/jane.jpg',
      );
      expect(
        normalizeImageUrl(
          'https://static.licdn.com/aero-v1/sc/h/1c5u578iilxfi4m4dvc4q810q',
        ),
      ).toBeUndefined();
      expect(normalizeImageUrl('not a url')).toBeUndefined();
      expect(normalizeImageUrl(null)).toBeUndefined();
    });
  });
});
