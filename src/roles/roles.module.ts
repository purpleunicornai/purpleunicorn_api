import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { ServicesModule } from '../services/services.module';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [ServicesModule, DatabaseModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
