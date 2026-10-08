import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CandidateDto } from '../../common/dto/candidate.dto';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Project this role belongs to',
    example: '0c9f9549-2f4c-4725-9be1-2b9a3b816347',
  })
  @IsUUID()
  project_id: string;

  @ApiProperty({ description: 'Role name', example: 'Fullstack Developer' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Role description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class RunSearchDto {}

export class RoleProjectSummaryDto {
  @ApiProperty({ description: 'Project name' })
  @Expose()
  @IsString()
  name: string;
}

export class RoleFilterChildResponseDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Open-ended label, interpreted per-category' })
  @Expose()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  value?: string;

  @ApiProperty({ type: [String], required: false })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  list_value?: string[];

  @ApiProperty({ required: false })
  @Expose({ name: 'boolean' })
  @IsOptional()
  @IsBoolean()
  boolean_value?: boolean;
}

export class RoleFilterItemResponseDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description:
      'Fixed category: location, job_titles, skills, languages, industry, companies, education, or experience',
  })
  @Expose()
  @IsString()
  category: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  value?: string;

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  list_value: string[];

  @ApiProperty({ description: '"ESSENTIAL" or "OPTIONAL"' })
  @Expose()
  @IsString()
  priority: string;

  @ApiProperty({
    description:
      'If true, a candidate who does not fully match this filter is disqualified',
  })
  @Expose()
  @IsBoolean()
  non_negotiable: boolean;

  @ApiProperty({ type: () => [RoleFilterChildResponseDto] })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterChildResponseDto)
  children: RoleFilterChildResponseDto[];
}

export class RoleFilterResponseDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Record creation timestamp' })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({ description: 'Record last updated timestamp' })
  @Expose()
  @IsDateString()
  updated: string;

  @ApiProperty({
    description: 'Whether this filter set has been superseded by a newer one',
  })
  @Expose()
  @IsBoolean()
  archived: boolean;

  @ApiProperty({
    description:
      'When a search was last run against this filter set — unset until the user has run a search on it',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  search_run_date?: string;

  @ApiProperty({ type: () => [RoleFilterItemResponseDto] })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterItemResponseDto)
  role_filter_items: RoleFilterItemResponseDto[];
}

export class RoleResultScoreBreakdownDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description: 'Scoring category, e.g. required_skills, education',
  })
  @Expose()
  @IsString()
  category: string;

  @ApiProperty({ description: 'Maximum points available for this category' })
  @Expose()
  @IsInt()
  weight: number;

  @ApiProperty({
    description: 'Whether this category applied to the role filter',
  })
  @Expose()
  @IsBoolean()
  applicable: boolean;

  @ApiProperty({ description: 'Points earned in this category' })
  @Expose()
  @IsInt()
  score: number;

  @ApiProperty({
    description: 'The role_filters row this breakdown entry was scored against',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsUUID()
  role_filter_id?: string;
}

export class RoleResultSummaryDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Record creation timestamp' })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({ description: 'Record last updated timestamp' })
  @Expose()
  @IsDateString()
  updated: string;

  @ApiProperty({
    description:
      'Deterministic algorithmic match score, weighted by the role filter criteria (0-100)',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  score?: number;

  @ApiProperty({
    description: 'AI-generated match score from Gemini (0-100)',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  ai_score?: number;

  @ApiProperty({
    description: 'AI-generated explanation of the score',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  reasoning?: string;

  @ApiProperty({
    description: 'Skills that matched the role criteria',
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills_matched?: string[];

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  shortlist?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsDateString()
  shortlist_date?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  marked_for_review?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsDateString()
  marked_for_review_date?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  not_suitable?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsDateString()
  not_suitable_date?: string;

  @ApiProperty({ description: 'Set by a human reviewer', required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  relevancy_score?: number;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  rated_by?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  tokens_used?: number;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  tokens_cost?: number;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsUUID()
  filter_id?: string;

  @ApiProperty({ type: () => CandidateDto, required: false })
  @Expose()
  @IsOptional()
  @ValidateNested()
  @Type(() => CandidateDto)
  candidate?: CandidateDto;

  @ApiProperty({
    description: 'Per-category breakdown of the algorithmic score',
    type: () => RoleResultScoreBreakdownDto,
    isArray: true,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleResultScoreBreakdownDto)
  score_breakdown?: RoleResultScoreBreakdownDto[];

  @ApiProperty({
    description:
      'True when the candidate failed a non-negotiable filter and was excluded from ranking',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsBoolean()
  disqualified?: boolean;
}

export class RoleDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Record creation timestamp' })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({ description: 'Record last updated timestamp' })
  @Expose()
  @IsDateString()
  updated: string;

  @ApiProperty({ description: 'Project this role belongs to' })
  @Expose()
  @IsUUID()
  project_id: string;

  @ApiProperty({ description: 'Role name' })
  @Expose()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Role description', required: false })
  @Expose()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'System-generated role summary',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({
    description: 'Clerk user id of who created the role',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  created_by?: string;

  @ApiProperty({
    description:
      'The parent project — only present when fetching a single role',
    type: () => RoleProjectSummaryDto,
    required: false,
  })
  @Expose()
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleProjectSummaryDto)
  project?: RoleProjectSummaryDto;

  @ApiProperty({
    description:
      'Non-archived filter criteria for this role — only present when fetching a single role',
    type: () => [RoleFilterResponseDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterResponseDto)
  role_filters?: RoleFilterResponseDto[];

  @ApiProperty({
    description:
      'Candidate results found for this role — only present when fetching a single role',
    type: () => [RoleResultSummaryDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleResultSummaryDto)
  role_result?: RoleResultSummaryDto[];
}
