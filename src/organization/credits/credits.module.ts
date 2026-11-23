import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ServicesModule } from '../../services/services.module';
import { DatabaseModule } from '../../common/database/database.module';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';

@Module({
  imports: [DatabaseModule, AuthModule, ServicesModule],
  providers: [CreditsService],
  controllers: [CreditsController],
  exports: [CreditsService],
})
export class CreditsModule {}
