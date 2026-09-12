import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { CandidateScoringService } from './candidate-scoring.service';
import { ServicesModule } from '../../services/services.module';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [ServicesModule, DatabaseModule],
  exports: [SearchService],
  providers: [SearchService, CandidateScoringService],
})
export class SearchModule {}
