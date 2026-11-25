import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

export class CreditAdjustmentDto {
  @ApiProperty({
    description: 'Credits to add (positive) or remove (negative).',
    example: 25,
  })
  @IsInt()
  @NotEquals(0)
  amount!: number;

  @ApiProperty({
    description: 'Why, for the audit trail.',
    example: 'Goodwill credit after outage',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class RocketReachLookupsQueryDto {
  @ApiProperty({ required: false, description: 'Clerk organization id.' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @ApiProperty({
    required: false,
    description: 'From this time (inclusive), ISO 8601.',
    example: '2026-11-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({
    required: false,
    description: 'Up to this time (exclusive), ISO 8601.',
    example: '2026-12-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiProperty({
    required: false,
    description: 'Rows to return, newest first (totals cover every match).',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
