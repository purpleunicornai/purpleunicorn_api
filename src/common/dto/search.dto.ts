import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Expose, Type } from 'class-transformer';

export class RoleFilterMetadataDto {
  @ApiProperty({
    description: 'Indicates if the configuration parsing is complete',
    example: false,
  })
  @IsBoolean()
  complete: boolean;

  @ApiProperty({
    description: 'System-optimized query string',
    example:
      'A junior mobile developer in London with a minimum of 2 years experience, skilled in React Native and cross-platform development.',
  })
  @IsString()
  refined_prompt: string;

  @ApiProperty({
    description: 'Original raw text query inputted by user',
    example:
      'Mobile developer in london, minimum 2 years exp, react native, cross platform ',
  })
  @IsString()
  original_prompt: string;
}

export class FilterLocationCityDto {
  @ApiProperty({
    description: 'Unique location identifier (UUID v4)',
    example: 'ebc329c3-dbaa-4038-85b2-d1b634430997',
  })
  @IsUUID()
  uid: string;

  @ApiProperty({
    description: 'Location entry creation timestamp',
    example: '2026-08-23T07:56:51.913Z',
  })
  @IsDateString()
  created: string;

  @ApiProperty({
    description: 'Location entry update timestamp',
    example: '2026-08-23T07:56:51.913Z',
  })
  @IsDateString()
  updated: string;

  @ApiProperty({
    description: 'Parent filter collection layout block foreign key link',
    example: '0c9f9549-2f4c-4725-9be1-2b9a3b816347',
  })
  @IsUUID()
  role_filters_id: string;

  @ApiProperty({
    description: 'Target boundary city parameter string',
    example: 'London',
  })
  @Expose()
  @IsString()
  name: string;

  @ApiProperty({
    description:
      'Geographic state, province or region string tag mapping context',
    example: '',
  })
  @Expose()
  @IsString()
  state: string;

  @ApiProperty({
    description:
      'Primary targeted central post code criteria validation format block rules',
    example: '',
  })
  @Expose()
  @IsString()
  postcode: string;

  @ApiProperty({
    description:
      'Radial search bounding distance metrics formatting descriptor systems',
    example: 'KILOMETERS',
  })
  @Expose()
  @IsString()
  distance_unit: string;

  @ApiProperty({
    description:
      'Geographic target scanning boundary radius calculation scope rules',
    example: 0,
  })
  @Expose()
  @IsInt()
  @Min(0)
  distance_value: number;
}
export class RoleFilterDto {
  @ApiProperty({
    description:
      'Unique filter criteria group configuration block id (UUID v4)',
    example: '0c9f9549-2f4c-4725-9be1-2b9a3b816347',
  })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({
    description:
      'Record initialization system metrics audit tracking timestamp',
    example: '2026-08-23T07:56:51.913Z',
  })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({
    description: 'Record evaluation parameters adjustment tracking timestamp',
    example: '2026-08-23T07:56:51.913Z',
  })
  @Expose()
  @IsDateString()
  updated: string;

  @ApiProperty({
    description:
      'Target job role layout processing configuration profile reference mapping identity code link',
    example: 'ba2032ee-2e31-49bc-9be6-fc59245a9306',
  })
  @Expose()
  @IsUUID()
  role_id: string;

  @ApiProperty({
    description:
      'ISO 2-letter operational tracking boundary country mapping context tag standard string codes',
    example: 'GB',
  })
  @Expose()
  @IsString()
  country_code: string;

  @ApiProperty({
    description:
      'Explicit constraint requiring candidates to work out of a physical workspace track',
    example: false,
  })
  @Expose()
  @IsBoolean()
  remote_work: boolean;

  @ApiProperty({
    description:
      'Validation tracking standard identifying if candidates must have valid work authorization context setup',
    example: false,
  })
  @Expose()
  @IsBoolean()
  work_authorization_required: boolean;

  @ApiProperty({
    description:
      'Minimum years boundary line baseline parameter metrics processing limits',
    example: 2,
  })
  @Expose()
  @IsInt()
  @Min(0)
  experience_min_yrs: number;

  @ApiProperty({
    description:
      'Maximum cap threshold metric for experience profiling algorithms',
    example: 0,
  })
  @Expose()
  @IsInt()
  @Min(0)
  experience_max_yrs: number;

  @ApiProperty({
    description:
      'Primary job title identifier parameter string tag parsing rules text context mapping metadata',
    example: 'Mobile Developer',
  })
  @Expose()
  @IsString()
  title: string;

  @ApiProperty({
    description:
      'Array of secondary alternative variation target parsing synonyms',
    example: [
      'Mobile Engineer',
      'Mobile Software Engineer',
      'React Native Developer',
      'Cross-Platform Developer',
    ],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  alternative_titles: string[];

  @ApiProperty({
    description:
      'Sought seniority career stage ranking categorization track values',
    example: ['Junior'],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  title_levels: string[];

  @ApiProperty({
    description:
      'List of specific targeted roles requirements rules sets descriptors codes mapping arrays',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @ApiProperty({
    description:
      'Minimum required years mapping limit evaluation constraints for current roles data metrics tracking fields',
    example: 0,
  })
  @Expose()
  @IsInt()
  @Min(0)
  current_role_min_yrs: number;

  @ApiProperty({
    description:
      'Maximum tracking context capability constraint caps tracking boundary thresholds values calculations structures for current roles fields',
    example: 0,
  })
  @Expose()
  @IsInt()
  @Min(0)
  current_role_max_yrs: number;

  @ApiProperty({
    description:
      'Minimum current continuous organization structural alignment threshold calculations values metrics baseline counters flags',
    example: 0,
  })
  @Expose()
  @IsInt()
  @Min(0)
  current_role_tenure_yrs: number;

  @ApiProperty({
    description:
      'Non-negotiable critical core domain technology qualification tag standard frameworks elements processing tokens arrays mapping tracking keys',
    example: ['React Native', 'Cross-platform development'],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  required_skills: string[];

  @ApiProperty({
    description:
      'Secondary target optional technical capabilities background items reference tags tokens parsing logs collections',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  optional_skills: string[];

  @ApiProperty({
    description:
      'Academic certifications classifications matrix target options filters rules',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_levels: string[];

  @ApiProperty({
    description:
      'Target institutions profile sourcing evaluation tracking constraints mapping arrays log indicators lists',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_universities: string[];

  @ApiProperty({
    description:
      'Blacklisted educational institutions excluded from direct automation workflow calculations processing pipelines indicators arrays tracking mappings',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  education_excluded_universities: string[];

  @ApiProperty({
    description:
      'Minimum academic degree completion timeline year indicator markers evaluation target parameters settings criteria mapping',
    example: null,
    required: false,
    nullable: true,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  education_graduation_min_yr: number | null;

  @ApiProperty({
    description:
      'Maximum academic validation lifecycle window timeline caps parameters metric calculations target criteria trackers config mapping flags',
    example: null,
    required: false,
    nullable: true,
  })
  @Expose()
  @IsOptional()
  @IsInt()
  education_graduation_max_yr: number | null;

  @ApiProperty({
    description:
      'Languages mandatory for candidate evaluation workflow validation execution requirements tracking indexes fields blocks values',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  required_languages: string[];

  @ApiProperty({
    description:
      'Secondary language background profiles context target values mapping lists filters settings configurations tracks layout properties items metrics processing',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  optional_languages: string[];

  @ApiProperty({
    description:
      'Career path projection constraints matching trajectory maps tokens lists properties evaluations logs variables references data rules objects',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  career_growth: string[];

  @ApiProperty({
    description:
      'Security verification standard ratings mandatory benchmarks items checklist flags arrays tracking criteria data indexes components identifiers properties definitions structures mappings',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  security_clearance_required: string[];

  @ApiProperty({
    description:
      'Inclusion policy analytics assessment indicators benchmarks metric parameters items logging groups datasets options setups structures',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  diversity: string[];

  @ApiProperty({
    description:
      'Alternative career sector track validation tracking blocks definitions guidelines references items variables metrics scopes components processing logs mapping criteria tags array datasets layout specifications settings configuration values parameters elements indices tracking properties objects rules lists models data collections structures profiles indicators properties schemas structures blueprints',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  other_experience: string[];

  @ApiProperty({
    description:
      'Web location parameters source identifiers indexes properties collections layout mappings indicators structural components trackers options listings arrays processing guidelines data configuration criteria variables datasets rules metrics',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  sites: string[];

  @ApiProperty({
    description:
      'Internal analytical text logging parser metadata processing indicators structural framework parameters records blocks mapping metrics data layouts configuration context settings',
    type: () => RoleFilterMetadataDto,
  })
  @Expose()
  @ValidateNested()
  @Type(() => RoleFilterMetadataDto)
  metadata: RoleFilterMetadataDto;

  @ApiProperty({
    description:
      'Blacklisted companies excluded from pipeline automation evaluations data items profiles rules structural tracking configurations arrays maps listing logs elements processing parameters reference guidelines tracking identifiers',
    example: [],
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  filter_companies: string[];

  @ApiProperty({
    description:
      'Target geographic operational boundaries tracking configurations layouts elements rules arrays specifications references log indices datasets identifiers items listings mapping properties parameters indicators metrics variables processing indicators components charts profiles structural data data blocks blueprints modules',
    type: () => [FilterLocationCityDto],
  })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterLocationCityDto)
  filter_location_cities: FilterLocationCityDto[];
}
