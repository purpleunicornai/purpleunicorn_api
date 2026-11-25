import { extractCandidate } from './extract-candidate';

// Example data shaped like a Vertex website-search result, not a real profile.
function result(fields: Record<string, unknown>) {
  const toValue = (value: unknown): unknown => {
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value))
      return { listValue: { values: value.map(toValue) } };
    return {
      structValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [
            k,
            toValue(v),
          ]),
        ),
      },
    };
  };
  return {
    document: {
      derivedStructData: {
        fields: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, toValue(v)]),
        ),
      },
    },
  } as Parameters<typeof extractCandidate>[0];
}

describe('extractCandidate', () => {
  it('pulls name, headline, company, location and snippet from a profile', () => {
    const candidate = extractCandidate(
      result({
        link: 'https://za.linkedin.com/in/jane-doe-123',
        title: 'Jane Doe - Senior React Native Developer - Acme | LinkedIn',
        snippets: [
          {
            snippet:
              'Experienced <b>React Native</b> developer &amp; mentor. Location: Cape Town · 500+ connections',
          },
        ],
      }),
    );

    expect(candidate).toEqual({
      name: 'Jane Doe',
      key: 'jane-doe-123',
      headline: 'Senior React Native Developer',
      company: 'Acme',
      location: 'Cape Town',
      linkedinUrl: 'https://za.linkedin.com/in/jane-doe-123',
      snippet:
        'Experienced React Native developer & mentor. Location: Cape Town · 500+ connections',
      candidate: {
        first_name: 'Jane',
        last_name: 'Doe',
        current_title: 'Senior React Native Developer',
        current_company: 'Acme',
        current_location_city: 'Cape Town',
        sources: [
          {
            title: 'Jane Doe - Senior React Native Developer - Acme',
            source: 'LinkedIn',
            url: 'https://za.linkedin.com/in/jane-doe-123',
            main: true,
            type: 'SEARCH',
          },
        ],
      },
    });
  });

  it('falls back to og metatags when title and snippets are missing', () => {
    const candidate = extractCandidate(
      result({
        link: 'https://www.linkedin.com/in/john',
        pagemap: {
          metatags: [
            {
              'og:title': 'John Smith | LinkedIn',
              'og:description': 'Founder',
            },
          ],
        },
      }),
    );

    expect(candidate).toMatchObject({ name: 'John Smith', snippet: 'Founder' });
    expect(candidate?.headline).toBeUndefined();
  });

  it.each([
    [
      'Ryan H. - Front-End Developer - LinkedIn',
      'Ryan H.',
      'Front-End Developer',
      undefined,
    ],
    [
      'Austin C | Mobile Developer | AI - LinkedIn',
      'Austin C',
      'Mobile Developer',
      'AI',
    ],
  ])('parses title %s', (title, name, headline, company) => {
    const candidate = extractCandidate(
      result({ link: 'https://www.linkedin.com/in/x', title }),
    );
    expect(candidate).toMatchObject({ name, headline });
    expect(candidate?.company).toBe(company);
  });

  it('ignores an unrendered location placeholder', () => {
    const candidate = extractCandidate(
      result({
        link: 'https://za.linkedin.com/in/stephan',
        title: 'Stephan - CA (SA) | LinkedIn',
        snippets: [
          { snippet: 'Location: {:currentLocation} · 500+ connections' },
        ],
      }),
    );
    expect(candidate?.location).toBeUndefined();
  });

  it('copies an og:image onto the seeded candidate', () => {
    const candidate = extractCandidate(
      result({
        link: 'https://www.linkedin.com/in/jane',
        title: 'Jane Doe | LinkedIn',
        pagemap: {
          metatags: [{ 'og:image': 'https://media.licdn.com/jane.jpg' }],
        },
      }),
    );
    expect(candidate?.imageUrl).toBe('https://media.licdn.com/jane.jpg');
    expect(candidate?.candidate.image_url).toBe(
      'https://media.licdn.com/jane.jpg',
    );
  });

  it("skips LinkedIn's placeholder og:image for the profile's real CSE photo, or none", () => {
    const placeholder =
      'https://static.licdn.com/aero-v1/sc/h/1c5u578iilxfi4m4dvc4q810q';
    const withPhoto = extractCandidate(
      result({
        link: 'https://www.linkedin.com/in/jane',
        title: 'Jane Doe | LinkedIn',
        pagemap: {
          metatags: [{ 'og:image': placeholder }],
          cse_image: [{ src: 'https://media.licdn.com/jane.jpg' }],
        },
      }),
    );
    expect(withPhoto?.candidate.image_url).toBe(
      'https://media.licdn.com/jane.jpg',
    );

    const without = extractCandidate(
      result({
        link: 'https://www.linkedin.com/in/jane',
        title: 'Jane Doe | LinkedIn',
        pagemap: { metatags: [{ 'og:image': placeholder }] },
      }),
    );
    expect(without?.imageUrl).toBeUndefined();
    expect(without?.candidate.image_url).toBeUndefined();
  });

  it('returns null for job postings', () => {
    expect(
      extractCandidate(
        result({
          link: 'https://www.linkedin.com/jobs/view/123',
          title: 'React Native Developer job',
        }),
      ),
    ).toBeNull();
  });
});
