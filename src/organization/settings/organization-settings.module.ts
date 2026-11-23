import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../common/database/database.module';
import { ServicesModule } from '../../services/services.module';
import { OrganizationSettingsController } from './organization-settings.controller';

@Module({
  imports: [DatabaseModule, AuthModule, ServicesModule],
  controllers: [OrganizationSettingsController],
})
export class OrganizationSettingsModule {}
