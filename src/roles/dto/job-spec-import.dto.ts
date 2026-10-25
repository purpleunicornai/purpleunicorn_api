import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { RoleFilterItemResponseDto } from './role.dto';

export class ImportJobSpecDto {
  @ApiProperty({
    description:
      'Raw job spec text, when pasted directly rather than uploaded as a file.',
    required: false,
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({
    description:
      'Base64-encoded file contents, when uploading a file instead of pasting text. Requires file_name so the server knows how to decode it.',
    required: false,
  })
  @IsOptional()
  @IsString()
  file_base64?: string;

  @ApiProperty({
    description:
      'Original file name, including extension (.pdf, .docx, or .txt) — used to determine how to decode file_base64.',
    required: false,
    example: 'job-spec.pdf',
  })
  @IsOptional()
  @IsString()
  file_name?: string;
}

export class JobSpecImportResponseDto {
  @ApiProperty({ description: 'Unique identifier (UUID v4)' })
  @Expose()
  @IsUUID()
  uid: string;

  @ApiProperty({ description: 'Record creation timestamp' })
  @Expose()
  @IsDateString()
  created: string;

  @ApiProperty({
    description:
      'The resolved job spec text the AI parsed — either the pasted text, or the text extracted from the uploaded file.',
    required: false,
  })
  @Expose()
  @IsOptional()
  @IsString()
  original_text?: string;

  @ApiProperty({ description: 'The AI model used to parse this job spec' })
  @Expose()
  @IsOptional()
  @IsString()
  ai_model_used?: string;

  @ApiProperty({ required: false })
  @Expose()
  @IsOptional()
  @IsInt()
  tokens_used?: number;

  @ApiProperty({
    description:
      "Draft filter items for the user to review/edit before saving them as this role's filters",
    type: () => [RoleFilterItemResponseDto],
  })
  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleFilterItemResponseDto)
  role_filter_items: RoleFilterItemResponseDto[];
}
