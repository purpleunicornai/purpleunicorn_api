import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FilterItemDto, RoleFilterDto } from './role_filter.dto';

describe('FilterItemDto', () => {
  it('rejects a category outside the fixed 7-category vocabulary', async () => {
    const dto = new FilterItemDto();
    dto.category = 'not_a_real_category';
    dto.priority = 'essential';

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('accepts every one of the known categories', async () => {
    for (const category of [
      'location',
      'job_titles',
      'skills',
      'languages',
      'industry',
      'companies',
      'education',
      'experience',
    ]) {
      const dto = new FilterItemDto();
      dto.category = category;
      dto.priority = 'essential';

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'category')).toBe(false);
    }
  });

  it('rejects a priority value other than essential/optional', async () => {
    const dto = new FilterItemDto();
    dto.category = 'skills';
    dto.priority = 'URGENT';

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'priority')).toBe(true);
  });

  it('accepts essential and optional priority', async () => {
    for (const priority of ['essential', 'optional']) {
      const dto = new FilterItemDto();
      dto.category = 'skills';
      dto.priority = priority;

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'priority')).toBe(false);
    }
  });
});

describe('RoleFilterDto work types and edited expansions', () => {
  const errorsFor = async (body: unknown) =>
    validate(plainToInstance(RoleFilterDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  const location = (work_types: unknown) => ({
    filters: [
      { category: 'location', value: 'ZA', priority: 'ESSENTIAL', work_types },
    ],
  });

  it('accepts ONSITE, HYBRID and REMOTE', async () => {
    expect(await errorsFor(location(['ONSITE', 'HYBRID', 'REMOTE']))).toEqual(
      [],
    );
  });

  it('rejects an unknown or repeated work type', async () => {
    expect(await errorsFor(location(['ONSITE', 'FLEXI']))).not.toEqual([]);
    expect(await errorsFor(location(['REMOTE', 'REMOTE']))).not.toEqual([]);
  });

  it('accepts edited expansion groups', async () => {
    expect(
      await errorsFor({
        filters: [],
        criterion_expansions: {
          job_titles: [{ seed: 'Founder', terms: ['Co-founder'] }],
          skills: [{ seed: 'Python', terms: [] }],
        },
      }),
    ).toEqual([]);
  });

  it('rejects malformed expansion groups', async () => {
    expect(
      await errorsFor({
        filters: [],
        criterion_expansions: { job_titles: [{ seed: '', terms: 'x' }] },
      }),
    ).not.toEqual([]);
    expect(
      await errorsFor({
        filters: [],
        criterion_expansions: {
          skills: [{ seed: 'Python', terms: Array(9).fill('term') }],
        },
      }),
    ).not.toEqual([]);
    expect(
      await errorsFor({
        filters: [],
        criterion_expansions: { languages: [] },
      }),
    ).not.toEqual([]);
  });
});
