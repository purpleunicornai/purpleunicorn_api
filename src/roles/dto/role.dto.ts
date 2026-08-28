import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

  @ApiProperty({ description: 'System-generated role summary', required: false })
  @Expose()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ description: 'Clerk user id of who created the role', required: false })
  @Expose()
  @IsOptional()
  @IsString()
  created_by?: string;
}
