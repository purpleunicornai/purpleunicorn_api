import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';

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
    description: 'Primary platform where the profile was discovered',
    example: 'LinkedIn',
  })
  @Expose()
  @IsString()
  main_source: string;

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
    description: 'List of past employing organisations',
    example: ['Startup Ltd', 'Global Corp'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previous_companies?: string[];

  @ApiProperty({
    description: 'List of historical job titles held',
    example: ['Junior Dev', 'Full Stack Engineer'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previous_titles?: string[];

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
    description: 'Completed levels of formal education',
    example: ["Bachelor's Degree"],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  education_levels?: string[];

  @ApiProperty({
    description: 'Attended academic institutions',
    example: ['University of Oxford'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  education_universities?: string[];

  @ApiProperty({
    description: 'Graduation milestones or dates reached',
    example: ['2020-06-18T00:00:00.000Z'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  graduation_years?: string[];

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
    description: 'Direct link to the root raw candidate profile data mapping',
    example: 'https://linkedin.com',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  original_source_url?: string;

  @ApiProperty({
    description: 'Every distinct platform discovery location history log trace',
    example: ['LinkedIn', 'GitHub X-Ray Search'],
    type: [String],
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sources?: string[];
}
