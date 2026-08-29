import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CandidateDto } from '../../common/dto/candidate.dto';
import { CompanyFilterType, DistanceUnit } from '../../generated/prisma/enums';

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

export class RunSearchDto {
  @ApiProperty({
    description: 'A previously saved role_filters id to run the search with',
    example: '0c9f9549-2f4c-4725-9be1-2b9a3b816347',
  })
  @IsUUID()
  filterId: string;
}

export class RoleProjectSummaryDto {
  @ApiProperty({ description: 'Project name' })
  @Expose()
  @IsString()
  name: string;
}

export class RoleFilterCompanyDto {
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
    description: 'Whether this is a current, past, or excluded company',
    enum: CompanyFilterType,
  })
  @Expose()
  @IsEnum(CompanyFilterType)
  type: CompanyFilterType;

  @ApiProperty({ description: 'Company names', type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  company_names: string[];

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class RoleFilterLocationCityDto {
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

  @ApiProperty({ description: 'City name' })
  @Expose()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiProperty({ enum: DistanceUnit, required: false })
  @Expose()
  @IsOptional()
  @IsEnum(DistanceUnit)
  distance_unit?: DistanceUnit;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  distance_value?: number;
}

export class RoleFilterSummaryDto {
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

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsString()
  country_code?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  remote_work?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  work_authorization_required?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  experience_min_yrs?: number;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  experience_max_yrs?: number;

  @ApiProperty()
  @Expose()
  @IsString()
  title: string;

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  alternative_titles: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  title_levels: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @ApiProperty()
  @Expose()
  @IsInt()
  current_role_min_yrs: number;

  @ApiProperty()
  @Expose()
  @IsInt()
  current_role_max_yrs: number;

  @ApiProperty()
  @Expose()
  @IsInt()
  current_role_tenure_yrs: number;

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  required_skills: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  optional_skills: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_levels: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_universities: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_excluded_universities: string[];

  @ApiProperty({ required: false, nullable: true })
  @Expose()
  @IsOptional()
  @IsDateString()
  education_graduation_min_yr?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Expose()
  @IsOptional()
  @IsDateString()
  education_graduation_max_yr?: string | null;

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  required_languages: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  optional_languages: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  career_growth: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  security_clearance_required: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  diversity: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  other_experience: string[];

  @ApiProperty({ type: [String] })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  sites: string[];

  @ApiProperty({
    description: 'Whether this filter has been superseded by a newer one',
  })
  @Expose()
  @IsBoolean()
  archived: boolean;

  @ApiProperty({ type: () => [RoleFilterCompanyDto] })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterCompanyDto)
  filter_companies: RoleFilterCompanyDto[];

  @ApiProperty({ type: () => [RoleFilterLocationCityDto] })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterLocationCityDto)
  filter_location_cities: RoleFilterLocationCityDto[];
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

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  score?: number;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsBoolean()
  shortlist?: boolean;

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
    type: () => [RoleFilterSummaryDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterSummaryDto)
  role_filters?: RoleFilterSummaryDto[];

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
