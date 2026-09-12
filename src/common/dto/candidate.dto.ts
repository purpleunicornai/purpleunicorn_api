import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { InstitutionType, SourceType } from '../../generated/prisma/enums';

export class CandidateExperienceDto {
  @ApiProperty({
    description: 'Unique identifier (UUID v4)',
    example: 'd3b07384-d113-4956-a5cc-484b99861e28',
  })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Employer name', example: 'TechCorp UK' })
  @Expose()
  @IsString()
  comapany_name: string;

  @ApiProperty({
    description: 'Employer location',
    example: 'London, UK',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  company_location?: string;

  @ApiProperty({ description: 'Job title held', example: 'Lead Engineer' })
  @Expose()
  @IsString()
  role: string;

  @ApiProperty({
    description: 'Start date of this role',
    example: '2021-01-01T00:00:00.000Z',
  })
  @Expose()
  @IsDateString()
  start_date: string;

  @ApiProperty({
    description: 'End date of this role, if it has ended',
    example: '2023-06-01T00:00:00.000Z',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiProperty({
    description: 'Responsibilities held in this role',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  responsibilities?: string;

  @ApiProperty({
    description: 'Skills used in this role',
    example: ['TypeScript', 'NestJS'],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  skills: string[];
}

export class CandidateEducationDto {
  @ApiProperty({
    description: 'Unique identifier (UUID v4)',
    example: 'd3b07384-d113-4956-a5cc-484b99861e28',
  })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description: 'Institution name',
    example: 'University of Oxford',
  })
  @Expose()
  @IsString()
  institution_name: string;

  @ApiProperty({
    description: 'Kind of institution',
    enum: InstitutionType,
    example: InstitutionType.UNIVERSITY,
  })
  @Expose()
  @IsEnum(InstitutionType)
  institution_type: InstitutionType;

  @ApiProperty({
    description: 'Institution location',
    example: 'Oxford, UK',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  institution_location?: string;

  @ApiProperty({
    description: 'Degree obtained',
    example: "Bachelor's Degree",
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  degree?: string;

  @ApiProperty({
    description: 'Field of study',
    example: 'Computer Science',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  field_of_study?: string;

  @ApiProperty({
    description: 'Start date of study',
    example: '2016-09-01T00:00:00.000Z',
  })
  @Expose()
  @IsDateString()
  start_date: string;

  @ApiProperty({
    description: 'End date of study, if it has ended',
    example: '2020-06-18T00:00:00.000Z',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiProperty({
    description: 'Short summary of this entry',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({
    description: 'Any other relevant information',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  additional_info?: string;
}

export class CandidateSourceDto {
  @ApiProperty({
    description: 'Unique identifier (UUID v4)',
    example: 'd3b07384-d113-4956-a5cc-484b99861e28',
  })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description: 'Title of the source, e.g. the search result title',
    example: 'Jane Doe - Software Engineer - LinkedIn',
  })
  @Expose()
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Name of the platform this source came from',
    example: 'LinkedIn',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    description: 'Link to the source, if one exists',
    example: 'https://www.linkedin.com/in/janedoe',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiProperty({
    description: "Whether this is the candidate's primary source",
    example: true,
  })
  @Expose()
  @IsBoolean()
  main: boolean;

  @ApiProperty({
    description: 'How this source was found',
    enum: SourceType,
    example: SourceType.SEARCH,
  })
  @Expose()
  @IsEnum(SourceType)
  type: SourceType;
}

export class CandidateDto {
  @ApiProperty({
    description: 'Unique identifier (UUID v4)',
    example: 'd3b07384-d113-4956-a5cc-484b99861e28',
  })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description: 'Record creation timestamp',
    example: '2026-08-24T20:51:00.000Z',
  })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({
    description: 'Record last updated timestamp',
    example: '2026-08-24T20:51:00.000Z',
  })
  @Expose()
  @IsDateString()
  updated: string;

  @ApiProperty({
    description: 'First name of the candidate',
    example: 'Jane',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiProperty({
    description: 'Last name of the candidate',
    example: 'Doe',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiProperty({
    description: 'Primary email address',
    example: 'jane.doe@example.com',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({
    description: 'Phone number without country code',
    example: '5550199',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'International country calling code',
    example: '+1',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  country_calling_code?: string;

  @ApiProperty({
    description: 'Timestamp when contact details were last verified',
    example: '2026-05-12T14:30:00.000Z',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  contact_info_last_updated?: string;

  @ApiProperty({
    description: 'RocketReach profile identifier',
    example: 'rr_8472910',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  rocketreach_profile_id?: string;

  @ApiProperty({
    description: 'Current residential city',
    example: 'London',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_location_city?: string;

  @ApiProperty({
    description: 'ISO 2-letter country code',
    example: 'GB',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_location_country_code?: string;

  @ApiProperty({
    description: 'Postal or zip code',
    example: 'TW11 8EE',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_location_postal_code?: string;

  @ApiProperty({
    description: 'Willingness to relocate for work',
    example: true,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsBoolean()
  open_to_relocation?: boolean;

  @ApiProperty({
    description: 'Willingness to work remotely',
    example: true,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsBoolean()
  open_to_remote_work?: boolean;

  @ApiProperty({
    description: 'Current legal right to work status',
    example: 'Citizen',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_work_autorization_status?: string;

  @ApiProperty({
    description: 'Total cumulative years of professional experience',
    example: 6,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  @Min(0)
  experience_years?: number;

  @ApiProperty({
    description: 'Historical list of roles performed',
    example: ['Software Engineer', 'Senior Developer'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  experience_roles?: string[];

  @ApiProperty({
    description: 'Current professional job title',
    example: 'Lead Engineer',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_title?: string;

  @ApiProperty({
    description: 'Current employing organisation',
    example: 'TechCorp UK',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_company?: string;

  @ApiProperty({
    description: 'Current annual base salary amount',
    example: 85000.0,
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsNumber()
  @Min(0)
  current_salary?: number;

  @ApiProperty({
    description: 'ISO currency designation code',
    example: 'GBP',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  current_salary_currency?: string;

  @ApiProperty({
    description: 'Start date of the current employment position',
    example: '2024-01-15T00:00:00.000Z',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  current_role_start_date?: string;

  @ApiProperty({
    description: 'Verified professional skill tags',
    example: ['NestJS', 'TypeScript', 'Prisma', 'PostgreSQL'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiProperty({
    description: 'Spoken and written languages',
    example: ['English (Fluent)', 'Spanish (Conversational)'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiProperty({
    description: 'Diversity, equity, and inclusion category metrics',
    example: ['Veteran', 'Underrepresented Group'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diversity?: string[];

  @ApiProperty({
    description: 'Short professional biography summary',
    example:
      'Results-driven back-end developer specializing in high-performance cloud architectures.',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({
    description: 'URL link to hosted profile avatar asset',
    example: 'https://example.com',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  image_url?: string;

  @ApiProperty({
    description: 'Platforms and links where this candidate was discovered',
    type: () => [CandidateSourceDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandidateSourceDto)
  sources?: CandidateSourceDto[];

  @ApiProperty({
    description:
      'When a deep candidate search last ran for this profile, if ever',
    example: '2026-08-30T12:00:00.000Z',
    required: false,
    nullable: true,
  })
  @Expose()
  @IsOptional()
  @IsDateString()
  enriched_at?: string | null;

  @ApiProperty({
    description: 'Employment history built up from deep candidate searches',
    type: () => [CandidateExperienceDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandidateExperienceDto)
  experience?: CandidateExperienceDto[];

  @ApiProperty({
    description: 'Education history built up from deep candidate searches',
    type: () => [CandidateEducationDto],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandidateEducationDto)
  education?: CandidateEducationDto[];
}
