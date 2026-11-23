import { Module } from '@nestjs/common';
import { CandidateService } from './candidate.service';
import { CandidateController } from './candidate.controller';
import { LogsModule } from '../../common/logs/logs.module';
import { DatabaseModule } from '../../common/database/database.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [LogsModule, DatabaseModule, AuthModule],
  providers: [CandidateService],
  controllers: [CandidateController],
})
export class CandidateModule {}
