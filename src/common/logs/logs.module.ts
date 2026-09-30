import { Module } from '@nestjs/common';
import { LogsService } from './logs.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
