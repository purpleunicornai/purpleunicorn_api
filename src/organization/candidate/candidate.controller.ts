import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { requireOrgId } from '../../common/utils/organizationUtils';
import { CandidateService } from './candidate.service';

@ApiTags('Organization Candidate')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('organization/candidate')
export class CandidateController {
  constructor(private readonly candidateService: CandidateService) {}

  // The contact details deep research found for this candidate. Free: it
  // reads what's on file and never calls RocketReach.
  @Get(':candidateId/contact-details')
  contactDetails(
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    return this.candidateService.contactDetails(
      requireOrgId(auth),
      candidateId,
    );
  }
}
