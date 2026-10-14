import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { RocketReachService } from '../../services/rocket-reach/rocket-reach.service';

@Injectable()
export class CandidateService {
  logger = new Logger(CandidateService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rocketReachService: RocketReachService,
  ) {}

  // use rocket reach to get candidate contact details

  async getCandidateContactDetails(candidateId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        uid: candidateId,
      },
      include: {
        sources: true,
      },
    });
    if (!candidate) {
      throw new RequestException(
        `Candidate with id ${candidateId} not found`,
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
      );
    }

    // here we call the rocket reach service to get the contact details
    if (candidate?.rocketreach_profile_id) {
      // create log, subtract credits, and return the contact details
    }

    const rocketReachPerson =
      await this.rocketReachService.lookupCandidate(candidate);

    if (!rocketReachPerson) {
      throw new RequestException(
        `Candidate with id ${candidateId} not found on RocketReach`,
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
      );
    }

    this.logger.debug(
      `Found ${rocketReachPerson.name}`,
      JSON.stringify(rocketReachPerson, null, 2),
    );
  }
}
