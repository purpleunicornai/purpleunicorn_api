import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { DatabaseModule } from '../common/database/database.module';
import { SearchModule } from './search/search.module';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';
import { LogsModule } from '../common/logs/logs.module';

@Module({
  imports: [
    DatabaseModule,
    SearchModule,
    ProjectsModule,
    AuthModule,
    LogsModule,
  ],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
