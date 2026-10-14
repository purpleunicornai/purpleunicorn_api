import { Controller, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { requireOrgId } from '../../common/utils/organizationUtils';
import { CandidateService } from './candidate.service';

@ApiTags('Organization Candidate')
@ApiBearerAuth('bearer')
//@UseGuards(ClerkAuthGuard)
@Controller('organization/candidate')
export class CandidateController {
  logger = new Logger(CandidateController.name);

  constructor(private readonly candidateService: CandidateService) {}

  @Post(':candidateId/contact-details')
  getCandidateContactDetails(
    @Param('candidateId') candidateId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    // const orgId = requireOrgId(auth);
    // this.logger.debug(
    //   `Fetching contact details for candidate ${candidateId} in organization ${orgId}`,
    // );
    return this.candidateService.getCandidateContactDetails(candidateId);
  }
}
