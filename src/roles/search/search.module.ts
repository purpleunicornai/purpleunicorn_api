import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { ServicesModule } from '../../services/services.module';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [ServicesModule, DatabaseModule],
  exports: [SearchService],
  providers: [SearchService],
})
export class SearchModule {}
