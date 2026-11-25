import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import {
  requireOrgAdmin,
  requireOrgId,
} from '../../common/utils/organizationUtils';
import CreditsConfig from '../../config/credits.config';
import { RocketReachLookupsService } from '../../services/rocket-reach/rocket-reach-lookups.service';
import { CreditAdjustmentDto, RocketReachLookupsQueryDto } from './credits.dto';
import { CreditsService } from './credits.service';

@ApiTags('Organization Credits')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller()
export class CreditsController {
  constructor(
    private readonly credits: CreditsService,
    private readonly lookups: RocketReachLookupsService,
    @Inject(CreditsConfig.KEY)
    private readonly config: ConfigType<typeof CreditsConfig>,
  ) {}

  // The active org's balance, allowance, reset date and recent ledger rows.
  @Get('organization/credits')
  summary(@CurrentAuth() auth: ClerkAuthContext) {
    return this.credits.summary(requireOrgId(auth));
  }

  // Org admins only. TODO(credits): buy credits through Stripe checkout; on
  // payment, write a PURCHASE ledger row keyed by the Stripe session id.
  @Post('organization/credits/purchase')
  purchase(@CurrentAuth() auth: ClerkAuthContext) {
    requireOrgAdmin(auth);
    throw new RequestException(
      'Buying credits isn’t available yet',
      HttpStatus.NOT_IMPLEMENTED,
      'CREDIT_PURCHASE_NOT_AVAILABLE',
    );
  }

  // Staff only (CREDITS_ADMIN_USER_IDS): adds or removes credits for any
  // org, recorded as an ADJUSTMENT row with the reason and who made it.
  @Post('admin/organizations/:organizationId/credits/adjustments')
  adjust(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreditAdjustmentDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    this.requireStaff(auth);
    return this.credits.adjust({
      organizationId,
      userId: auth.userId,
      amount: dto.amount,
      reason: dto.reason,
    });
  }

  // Staff only: every RocketReach lookup matching the filters (newest
  // first) with totals across all of them, to reconcile against
  // RocketReach's bill.
  @Get('admin/rocketreach/lookups')
  rocketReachLookups(
    @Query() query: RocketReachLookupsQueryDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    this.requireStaff(auth);
    return this.lookups.list({
      organizationId: query.organizationId,
      candidateId: query.candidateId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
    });
  }

  // Purple Unicorn staff (CREDITS_ADMIN_USER_IDS), never an org's own
  // admins.
  private requireStaff(auth: ClerkAuthContext): void {
    if (!this.config.adminUserIds.includes(auth.userId)) {
      throw new RequestException(
        'Only Purple Unicorn staff can do this',
        HttpStatus.FORBIDDEN,
        'CREDITS_ADMIN_REQUIRED',
      );
    }
  }
}
