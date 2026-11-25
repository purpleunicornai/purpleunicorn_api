import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import {
  RocketReachLookupPurpose,
  type candidate,
  type candidate_source,
  type organization_credits,
} from '../../generated/prisma/client';
import {
  periodResetsAt,
  type RocketReachPlan,
} from '../../organization/credits/credit-ledger';
import { CreditsService } from '../../organization/credits/credits.service';
import { RocketReachLookupsService } from '../../services/rocket-reach/rocket-reach-lookups.service';
import {
  personOf,
  RocketReachService,
  type RocketReachLookup,
  type RocketReachPerson,
} from '../../services/rocket-reach/rocket-reach.service';
import { SearchService } from '../search/search.service';

type ResearchableCandidate = candidate & { sources: candidate_source[] };

export type ResearchQuote = {
  // What the run will deduct: the cost of one run, RocketReach included.
  credits: number;
  // How the run will get RocketReach's profile (information only; it
  // doesn't change the price).
  rocketReach: RocketReachPlan;
  balance: number;
  sufficient: boolean;
  periodResetsAt: string;
};

// How this run gets RocketReach's profile, if at all.
export type RocketReachSource =
  | { kind: 'none' }
  | { kind: 'cached'; profile: RocketReachPerson }
  | { kind: 'lookup' };

type Run = {
  organizationId: string;
  userId: string;
  roleId: string;
  roleResultId: string;
  candidate: ResearchableCandidate | null;
};

// Deep research, paid for in credits: one request that researches the open
// web and looks the candidate up on RocketReach, for one price. Quoted up
// front and charged before it runs. The whole credit comes back when the run
// fails, or when it succeeds but a new RocketReach lookup finds nothing,
// errors or times out. A recent RocketReach profile reused from cache is
// still charged. Both refunds use the same part ("all"), so a charge is
// refunded at most once. Every RocketReach lookup it makes (or saves by
// reusing a recent one) is logged.
@Injectable()
export class PaidResearchService {
  private readonly logger = new Logger(PaidResearchService.name);

  constructor(
    private readonly credits: CreditsService,
    private readonly searchService: SearchService,
    private readonly rocketReach: RocketReachService,
    private readonly lookups: RocketReachLookupsService,
  ) {}

  async quote(
    organizationId: string,
    candidate: ResearchableCandidate | null,
    now = new Date(),
  ): Promise<ResearchQuote> {
    const subject = researchable(candidate);
    const source = await this.rocketReachSource(subject, now);
    const credits = this.credits.costPerRun;
    const balance = await this.credits.balance(organizationId, now);
    return {
      credits,
      rocketReach: source.kind,
      balance,
      sufficient: balance >= credits,
      periodResetsAt: periodResetsAt(now).toISOString(),
    };
  }

  // Charges (402 when the balance is short), then researches. A failed run
  // is refunded in full and rethrown; a RocketReach miss is refunded in full
  // and the research returned.
  async research(run: Run) {
    const subject = researchable(run.candidate);
    const source = await this.rocketReachSource(subject);
    const charge = await this.credits.charge({
      organizationId: run.organizationId,
      userId: run.userId,
      roleId: run.roleId,
      roleResultId: run.roleResultId,
      candidateId: subject.uid,
      rocketReach: source.kind,
    });

    const lookup =
      source.kind === 'lookup' ? this.rocketReach.lookup(subject) : undefined;
    const profile =
      source.kind === 'cached'
        ? Promise.resolve(source.profile)
        : lookup?.then(personOf);

    let researched: Awaited<ReturnType<SearchService['deepSearchCandidate']>>;
    try {
      researched = await this.searchService.deepSearchCandidate(
        subject.uid,
        run.roleId,
        true,
        { rocketReach: profile },
      );
    } catch (error) {
      const refund = await this.refundSafely(charge, {
        credits: -charge.amount,
        part: 'all',
        reason: 'Deep research failed',
      });
      await this.logRocketReach(run, subject, source, lookup, charge, refund);
      throw error;
    }

    const refund = rocketReachMissed(source, await lookup)
      ? await this.refundSafely(charge, {
          credits: -charge.amount,
          part: 'all',
          reason: 'RocketReach found nothing',
        })
      : null;
    await this.logRocketReach(run, subject, source, lookup, charge, refund);
    return researched;
  }

  // RocketReach runs when it's enabled and there's something to look the
  // candidate up by; a profile research stored recently is reused instead.
  private async rocketReachSource(
    candidate: ResearchableCandidate,
    now = new Date(),
  ): Promise<RocketReachSource> {
    if (!this.rocketReach.enabled || !this.rocketReach.canLookUp(candidate)) {
      return { kind: 'none' };
    }
    const profile = await this.lookups.recentProfile(candidate.uid, now);
    return profile ? { kind: 'cached', profile } : { kind: 'lookup' };
  }

  private async logRocketReach(
    run: Run,
    candidate: ResearchableCandidate,
    source: RocketReachSource,
    lookup: Promise<RocketReachLookup> | undefined,
    charge: organization_credits,
    refund: organization_credits | null = null,
  ): Promise<void> {
    const result = await lookup;
    const logged =
      source.kind === 'cached'
        ? {
            outcome: 'cached' as const,
            profileId: String(source.profile.id ?? '') || null,
          }
        : result && result.outcome !== 'skipped'
          ? result
          : null;
    if (!logged) return;
    try {
      await this.lookups.record({
        organizationId: run.organizationId,
        userId: run.userId,
        candidateId: candidate.uid,
        roleId: run.roleId,
        roleResultId: run.roleResultId,
        purpose: RocketReachLookupPurpose.DEEP_RESEARCH,
        lookup: logged,
        chargeEntryId: charge.uid,
        refundEntryId: refund?.uid,
      });
    } catch (error) {
      this.logger.error(
        `RocketReach lookup log failed for candidate=${candidate.uid}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A refund that fails is logged rather than thrown, so it can't replace
  // the research outcome the caller reports.
  private async refundSafely(
    ...args: Parameters<CreditsService['refund']>
  ): Promise<organization_credits | null> {
    try {
      return await this.credits.refund(...args);
    } catch (error) {
      this.logger.error(
        `Credit refund failed for charge=${args[0].uid} (${args[1].part}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

// A new lookup that came back empty-handed. A cached profile always has
// data, and a run that never looked RocketReach up (disabled, nothing to
// look up by) has nothing to miss.
export function rocketReachMissed(
  source: RocketReachSource,
  lookup: RocketReachLookup | undefined,
): boolean {
  return (
    source.kind === 'lookup' &&
    (lookup?.outcome === 'not_found' ||
      lookup?.outcome === 'error' ||
      lookup?.outcome === 'pending_timeout')
  );
}

// Research searches on the candidate's name, so a result without a named
// candidate can't be researched (or charged for).
function researchable(
  candidate: ResearchableCandidate | null,
): ResearchableCandidate {
  const named = [candidate?.first_name, candidate?.last_name].some((part) =>
    part?.trim(),
  );
  if (!candidate || !named) {
    throw new RequestException(
      'This result has no named candidate to research',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'CANDIDATE_NOT_RESEARCHABLE',
    );
  }
  return candidate;
}
