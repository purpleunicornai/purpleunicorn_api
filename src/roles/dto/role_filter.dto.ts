import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

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
      'Fixed category of the filter item: location, job_titles, skills, languages, industry, companies, or education.',
    example: 'location',
  })
  @Expose()
  @IsString()
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
    description: 'Priority of the filter item: "essential" or "optional".',
    example: 'essential',
  })
  @Expose()
  @IsString()
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
}
