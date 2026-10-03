import { validate } from 'class-validator';
import { FilterItemDto } from './role_filter.dto';

describe('FilterItemDto', () => {
  it('rejects a category outside the fixed 7-category vocabulary', async () => {
    const dto = new FilterItemDto();
    dto.category = 'not_a_real_category';
    dto.priority = 'essential';

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('accepts every one of the 7 known categories', async () => {
    for (const category of [
      'location',
      'job_titles',
      'skills',
      'languages',
      'industry',
      'companies',
      'education',
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
