import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import type { ResultGeminiUsage } from '../../services/gemini/gemini-usage';
import type { SearchScore } from '../search/research-rescore';
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
import {
  WORK_TYPES,
  WorkType,
  workTypesFromChildren,
} from '../search/work-types';
import { publicFilterMetadata } from '../search/search-progress';

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

  @ApiProperty({
    description:
      'Location rows: how the role may be worked, read from the work_types child (or the legacy remote_work flag). Empty for other categories.',
    enum: WORK_TYPES,
    isArray: true,
  })
  @Expose()
  @Transform(
    ({ obj }: { obj: { category?: string; children?: never[] } }) =>
      obj.category === 'location' ? workTypesFromChildren(obj.children) : [],
    { toClassOnly: true },
  )
  work_types: WorkType[];
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

  @ApiProperty({
    description:
      'The Clerk user of who last ran a search against this filter set',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  search_run_by?: string;

  @ApiProperty({
    description:
      'The Clerk user id of who last ran a search against this filter set',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  search_run_by_id?: string;

  @ApiProperty({ type: () => [RoleFilterItemResponseDto] })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterItemResponseDto)
  role_filter_items: RoleFilterItemResponseDto[];

  @ApiProperty({
    description:
      'Free-form filter-set metadata. criterionExpansions holds the AI OR terms per title and skill seed: { version, generatedAt, model, byCategory: { job_titles?, skills? } }, each group { seed, terms } with the seed first.',
    required: false,
    type: Object,
  })
  @Expose()
  // Passed through untouched: excludeExtraneousValues would otherwise strip
  // the nested keys of this untyped JSON.
  @Transform(
    ({ obj }: { obj: { metadata?: unknown } }) =>
      publicFilterMetadata(obj.metadata),
    {
      toClassOnly: true,
    },
  )
  metadata: Record<string, unknown>;
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

  @ApiProperty({
    description:
      'The filter row this entry scored: requirement (e.g. "CA(SA)"), priority and nonNegotiable, plus researchBefore (its points from search evidence alone) when deep research changed them. Null on rows saved before this was recorded.',
    required: false,
    nullable: true,
    type: Object,
  })
  @Expose()
  @Transform(
    ({ obj }: { obj: { metadata?: unknown } }) => obj.metadata ?? null,
    {
      toClassOnly: true,
    },
  )
  metadata?: ScoreBreakdownCriterion | null;
}

export type ScoreBreakdownCriterion = {
  requirement: string;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
  // This row's points from search evidence alone, when deep research
  // changed them.
  researchBefore?: number;
};

export type RoleResultMatchNotes = {
  matchedBy?: 'location' | 'remote';
  missing?: string[];
  nonNegotiableUnconfirmed?: string[];
  // Set by deep research.
  findings?: { fact: string; sourceUrl: string }[];
  identityConfidence?: 'high' | 'medium' | 'low';
  identityReason?: string;
  // Gemini tokens spent on this result: its share of scoring batches and
  // its own deep research runs. Absent on results saved before this.
  geminiUsage?: ResultGeminiUsage;
  // The fixed algorithm on search evidence alone.
  searchScore?: SearchScore;
};

// The scoring snapshots (searchEvidence, researchEvidence) are internal
// inputs to a re-score, not match notes, so they stay out of responses.
function publicMatchNotes(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  // The raw RocketReach profile holds contact details; they're served from
  // the candidate's own fields, not from match notes.
  const {
    searchEvidence: _search,
    researchEvidence: _research,
    rocketReach: _rocketReach,
    ...notes
  } = metadata as Record<string, unknown>;
  void _search;
  void _research;
  void _rocketReach;
  return notes;
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

  @ApiProperty({
    description:
      'For a disqualified result, the deterministic score it had before the missed non-negotiable zeroed it',
    required: false,
    nullable: true,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  pre_disqualification_score?: number | null;

  @ApiProperty({
    description:
      'The non-negotiable requirement(s) a disqualified candidate missed, named by filter value',
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString({ each: true })
  disqualified_reasons?: string[];

  @ApiProperty({
    description: 'The search page this candidate was found on (1-based)',
    required: false,
  })
  @Expose()
  page?: number;

  @ApiProperty({
    description:
      'Match notes from the search: matchedBy ("location" | "remote") on a split search, missing (criteria not met), nonNegotiableUnconfirmed (a non-negotiable the profile does not show); after deep research also findings, identityConfidence and identityReason; geminiUsage ({ scoring?, research? } token counts with calls) once recorded; searchScore ({ score, rawScore, disqualified, disqualifiedReasons }), the fixed algorithm on search evidence alone, which differs from score when deep research changed it',
    required: false,
    type: Object,
  })
  @Expose()
  @Transform(
    ({ obj }: { obj: { metadata?: unknown } }) =>
      publicMatchNotes(obj.metadata),
    { toClassOnly: true },
  )
  metadata?: RoleResultMatchNotes;

  @ApiProperty({
    description:
      'The AI model used to generate the score and reasoning, e.g. "Flash1.5"',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  ai_model?: string;

  @ApiProperty({
    description:
      'The AI platform used to generate the score and reasoning, e.g. "OpenAI"',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  ai_platform?: string;

  @ApiProperty({
    description: 'The sources used to generate the score and reasoning',
    required: false,
    isArray: true,
    type: () => String,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sources?: string[];
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
