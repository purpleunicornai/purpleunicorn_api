import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { FilterItemDto } from './role_filter.dto';

// "Add to another role": the candidate joins each picked role and stays in
// the current one.
export class AddToRolesDto {
  @IsUUID()
  candidateUid: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds: string[];

  // Score against each new role's filters (mock AI in tests only).
  @IsBoolean()
  score: boolean;

  // Added as Shortlisted rather than Reviewing.
  @IsBoolean()
  shortlist: boolean;
}

// "Find more like this": the seed's traits, as edited in the modal.
export class SimilarSearchDto {
  @IsUUID()
  seedCandidateUid: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FilterItemDto)
  traits: FilterItemDto[];

  @IsIn([20, 50, 100])
  limit: number;
}
