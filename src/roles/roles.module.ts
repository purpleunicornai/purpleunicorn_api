import { CandidateActionsService } from './candidate-actions.service';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { JobSpecImportService } from './job-spec-import.service';
import { DatabaseModule } from '../common/database/database.module';
import { SearchModule } from './search/search.module';
import { ServicesModule } from '../services/services.module';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';
import { LogsModule } from '../common/logs/logs.module';
import { CreditsModule } from '../organization/credits/credits.module';
import { PaidResearchService } from './research/paid-research.service';
import { ROLE_SEARCH_QUEUE } from './search-jobs/role-search-job';
import { RoleSearchController } from './search-jobs/role-search.controller';
import { RoleSearchJobsService } from './search-jobs/role-search-jobs.service';
import { RoleSearchProcessor } from './search-jobs/role-search.processor';
import { ExtensionController } from './capture/extension.controller';
import { ProfileCaptureService } from './capture/profile-capture.service';
import { OrgCapturesService } from './capture/org-captures.service';

@Module({
  imports: [
    DatabaseModule,
    SearchModule,
    ServicesModule,
    ProjectsModule,
    AuthModule,
    LogsModule,
    CreditsModule,
    BullModule.registerQueue({
      name: ROLE_SEARCH_QUEUE,
      forceDisconnectOnShutdown: true,
    }),
  ],
  controllers: [RolesController, RoleSearchController, ExtensionController],
  providers: [
    RolesService,
    CandidateActionsService,
    JobSpecImportService,
    PaidResearchService,
    RoleSearchJobsService,
    RoleSearchProcessor,
    ProfileCaptureService,
    OrgCapturesService,
  ],
})
export class RolesModule {}
