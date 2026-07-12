import { Global, Module } from '@nestjs/common';
import { ClerkService } from './clerk.service';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  providers: [ClerkService],
  imports: [ConfigModule],
  exports: [ClerkService],
})
export class ClerkModule {}
