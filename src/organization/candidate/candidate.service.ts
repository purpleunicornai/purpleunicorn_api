import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';

export type ContactDetails = {
  candidateId: string;
  email: string | null;
  phone: string | null;
  rocketReachProfileId: string | null;
  contactInfoUpdatedAt: string | null;
};

// A candidate's contact details as they're on file. Deep research is what
// fetches them from RocketReach (and is what's charged); reading them here
// is free and never calls RocketReach.
@Injectable()
export class CandidateService {
  constructor(private readonly prisma: PrismaService) {}

  // Only a candidate on one of the org's own results.
  async contactDetails(
    organizationId: string,
    candidateId: string,
  ): Promise<ContactDetails> {
    const found = await this.prisma.candidate.findFirst({
      where: {
        uid: candidateId,
        role_results: {
          some: { role: { project: { organization_id: organizationId } } },
        },
      },
      select: {
        uid: true,
        email: true,
        phone: true,
        rocketreach_profile_id: true,
        contact_info_last_updated: true,
      },
    });
    if (!found) {
      throw new RequestException(
        'Candidate not found',
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
      );
    }
    return {
      candidateId: found.uid,
      email: found.email,
      phone: found.phone,
      rocketReachProfileId: found.rocketreach_profile_id,
      contactInfoUpdatedAt:
        found.contact_info_last_updated?.toISOString() ?? null,
    };
  }
}
