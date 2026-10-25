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

@Module({
  imports: [
    DatabaseModule,
    SearchModule,
    ServicesModule,
    ProjectsModule,
    AuthModule,
    LogsModule,
  ],
  controllers: [RolesController],
  providers: [RolesService, JobSpecImportService],
})
export class RolesModule {}
