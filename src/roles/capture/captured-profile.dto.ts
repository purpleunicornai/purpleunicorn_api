import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

// What the Chrome extension read off one linkedin.com/in/ page. The
// extension parses LinkedIn's DOM; everything but the URL and name is
// best-effort, so every other field is optional.
export class CapturedExperienceDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(200)
  company!: string;

  // candidate_experience needs a start date, so rows without one are dropped
  // by the extension before sending.
  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CapturedEducationDto {
  @IsString()
  @MaxLength(200)
  institution!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  degree?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fieldOfStudy?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CapturedProfileDto {
  @ApiProperty({ example: 'https://www.linkedin.com/in/thandiwe-nkosi' })
  @IsString()
  @MaxLength(500)
  linkedinUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  about?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentCompany?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CapturedExperienceDto)
  experience?: CapturedExperienceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CapturedEducationDto)
  education?: CapturedEducationDto[];
}
