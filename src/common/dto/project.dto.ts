import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ProjectVisibility } from '../../generated/prisma/enums';

export class CreateProjectDto {
  @ApiProperty({ description: 'Project name', example: 'Sanlam' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Project description',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Who can see this project',
    enum: ProjectVisibility,
    default: ProjectVisibility.USER,
    required: false,
  })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @ApiProperty({
    description:
      'Clerk user ids invited to the project (used with INVITE_ONLY visibility)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  users?: string[];
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class ProjectDto {
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

  @ApiProperty({ description: 'Clerk user id of the project owner' })
  @Expose()
  @IsString()
  user_id: string;

  @ApiProperty({ description: 'Clerk organization id the project belongs to' })
  @Expose()
  @IsString()
  organization_id: string;

  @ApiProperty({ description: 'Project name' })
  @Expose()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Project description', required: false })
  @Expose()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Who can see this project',
    enum: ProjectVisibility,
  })
  @Expose()
  @IsEnum(ProjectVisibility)
  visibility: ProjectVisibility;

  @ApiProperty({
    description: 'Clerk user ids invited to the project',
    type: [String],
  })
  @Expose()
  @IsArray()
  @IsString({ each: true })
  users: string[];
}
