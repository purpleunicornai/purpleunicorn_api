import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_TERM_LENGTH,
  MAX_TERMS_PER_SEED,
} from '../search/criterion-expansions';
import { WORK_TYPES, WorkType } from '../search/work-types';

export class ChildFilterItemDto {
  @ApiProperty({
    description: 'Unique identifier for the child filter item.',
    example: 'child-filter-item-123',
  })
  @Expose()
  @IsString()
  @IsOptional()
  uid?: string;

  @ApiProperty({
    description:
      'Open-ended label for this child, interpreted per-category (e.g. "province", "company_type", "title_option").',
    example: 'province',
  })
  @Expose()
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Value of the child filter item.',
    example: 'GP',
  })
  @Expose()
  @IsString()
  @IsOptional()
  value?: string;

  @ApiProperty({
    description: 'List of values for the child filter item.',
    example: ['Wits', 'UJ'],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  list_value?: string[];

  @ApiProperty({
    description:
      'Boolean value for the child filter item (e.g. include_dates, use_institution).',
    example: true,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsBoolean()
  boolean_value?: boolean;
}

export class FilterItemDto {
  @ApiProperty({
    description: 'Unique identifier for the filter item.',
    example: 'filter-item-123',
  })
  @Expose()
  @IsString()
  @IsOptional()
  uid?: string;

  @ApiProperty({
    description:
      'Fixed category of the filter item: location, job_titles, skills, languages, industry, companies, education, or experience.',
    example: 'location',
  })
  @Expose()
  @IsString()
  @IsIn([
    'location',
    'job_titles',
    'skills',
    'languages',
    'industry',
    'companies',
    'education',
    'experience',
  ])
  category: string;

  @ApiProperty({
    description:
      'Value for the filter item, when it has a single scalar value.',
    example: 'ZA',
    required: false,
  })
  @Expose()
  @IsString()
  @IsOptional()
  value?: string;

  @ApiProperty({
    description:
      'List of values for the filter item, when it holds multiple values.',
    example: ['React Native', 'Mobile Development'],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  list_value?: string[];

  @ApiProperty({
    description: 'Priority of the filter item: "ESSENTIAL" or "OPTIONAL".',
    example: 'ESSENTIAL',
  })
  @Expose()
  @IsString()
  @IsIn(['ESSENTIAL', 'OPTIONAL'])
  priority: string;

  @ApiProperty({
    description:
      'If true, this filter item is an absolute requirement — a candidate who does not fully match it is disqualified.',
    example: false,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsBoolean()
  non_negotiable?: boolean;

  @ApiProperty({
    description: 'Structured sub-facts for this filter item.',
    type: [ChildFilterItemDto],
    required: false,
  })
  @Expose()
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChildFilterItemDto)
  children?: ChildFilterItemDto[];

  @ApiProperty({
    description:
      'Location rows only: how the role may be worked. REMOTE allows remote candidates; ONSITE or HYBRID mean the location matters. Stored as a work_types child; the remote_work child is kept in sync. Omit to keep the children as sent.',
    enum: WORK_TYPES,
    isArray: true,
    required: false,
    example: ['ONSITE', 'HYBRID'],
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(WORK_TYPES, { each: true })
  work_types?: WorkType[];
}

export class ExpansionGroupDto {
  @ApiProperty({
    description: 'The recruiter title or skill the terms widen.',
    example: 'Finance Manager',
  })
  @Expose()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  seed: string;

  @ApiProperty({
    description: `OR terms for the seed, the seed itself included or not (it is always put first). Up to ${MAX_TERMS_PER_SEED} terms; only the seed means "keep it literal".`,
    type: [String],
    example: ['Finance Manager', 'Head of Finance', 'Financial Controller'],
  })
  @Expose()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_SEED)
  @IsString({ each: true })
  @MaxLength(MAX_TERM_LENGTH, { each: true })
  terms: string[];
}

export class CriterionExpansionsInputDto {
  @ApiProperty({ type: [ExpansionGroupDto], required: false })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpansionGroupDto)
  job_titles?: ExpansionGroupDto[];

  @ApiProperty({ type: [ExpansionGroupDto], required: false })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpansionGroupDto)
  skills?: ExpansionGroupDto[];
}

export class RoleFilterDto {
  @ApiProperty({
    description: 'List of filter items for the role.',
    type: [FilterItemDto],
  })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterItemDto)
  filters: FilterItemDto[];

  @ApiProperty({
    description:
      'Recruiter-edited OR terms. Each group given is saved as-is for its seed and never regenerated; seeds left out reuse their saved group or get a fresh AI one.',
    type: CriterionExpansionsInputDto,
    required: false,
  })
  @Expose()
  @IsOptional()
  @ValidateNested()
  @Type(() => CriterionExpansionsInputDto)
  criterion_expansions?: CriterionExpansionsInputDto;
}
