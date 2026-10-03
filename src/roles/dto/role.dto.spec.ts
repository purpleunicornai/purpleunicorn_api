import { plainToInstance } from 'class-transformer';
import {
  RoleFilterChildResponseDto,
  RoleResultScoreBreakdownDto,
  RoleResultSummaryDto,
} from './role.dto';

describe('RoleFilterChildResponseDto', () => {
  it('serializes the boolean column into boolean_value', () => {
    const result = plainToInstance(
      RoleFilterChildResponseDto,
      {
        uid: 'child-1',
        title: 'remote_work',
        value: null,
        list_value: [],
        boolean: true,
      },
      { excludeExtraneousValues: true },
    );
    expect(result.boolean_value).toBe(true);
  });
});

describe('RoleResultSummaryDto', () => {
  it('serializes disqualified on RoleResultSummaryDto', () => {
    const result = plainToInstance(
      RoleResultSummaryDto,
      {
        uid: 'result-1',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        disqualified: true,
      },
      { excludeExtraneousValues: true },
    );
    expect(result.disqualified).toBe(true);
  });
});

describe('RoleResultScoreBreakdownDto', () => {
  it('serializes role_filter_id on RoleResultScoreBreakdownDto', () => {
    const result = plainToInstance(
      RoleResultScoreBreakdownDto,
      {
        uid: 'breakdown-1',
        category: 'skills',
        weight: 80,
        applicable: true,
        score: 80,
        role_filter_id: 'filter-1',
      },
      { excludeExtraneousValues: true },
    );
    expect(result.role_filter_id).toBe('filter-1');
  });
});
