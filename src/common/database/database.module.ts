import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { PrismaService } from './prisma.service.js';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [DatabaseService, PrismaService],
  exports: [DatabaseService, PrismaService],
  imports: [TerminusModule, ConfigModule],
})
export class DatabaseModule {}
