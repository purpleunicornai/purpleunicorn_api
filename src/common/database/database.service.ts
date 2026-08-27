import { Injectable } from '@nestjs/common';

import { PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class DatabaseService {
  prisma: PrismaService;

  constructor(
    private prismaHealth: PrismaHealthIndicator,
    private prismaService: PrismaService,
  ) {
    this.prisma = prismaService;
  }

  async checkDatabaseHealth() {
    return await this.prismaHealth.pingCheck('database', this.prisma);
  }
}
