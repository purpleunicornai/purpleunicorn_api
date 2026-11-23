import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { CapturedProfileDto } from './captured-profile.dto';
import { SYNC_BATCH_MAX } from './org-captures';

export class SyncedCaptureDto extends CapturedProfileDto {
  @ApiProperty({ description: 'When the extension captured it (ISO 8601).' })
  @IsDateString()
  capturedAt!: string;
}

export class SyncCapturesDto {
  @ApiProperty({ type: [SyncedCaptureDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SYNC_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => SyncedCaptureDto)
  captures!: SyncedCaptureDto[];
}
