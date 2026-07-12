import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ClerkModule } from './common/clerk/clerk.module';

@Module({
  imports: [ConfigModule, AuthModule, ConfigModule, ClerkModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
