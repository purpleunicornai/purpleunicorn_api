import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ClerkModule } from './common/clerk/clerk.module';
import { BullModule } from '@nestjs/bullmq';
import { ServicesModule } from './services/services.module';
import { RolesModule } from './roles/roles.module';
import { DatabaseModule } from './common/database/database.module';
import { ProjectsModule } from './projects/projects.module';
import { MiddlewareModule } from './common/middleware/middleware.module';
import { CountriesModule } from './system/config/countries/countries.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL,
        },
      }),
    }),
    MiddlewareModule,
    ConfigModule,
    AuthModule,
    ConfigModule,
    ClerkModule,
    ServicesModule,
    RolesModule,
    DatabaseModule,
    ProjectsModule,
    CountriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
