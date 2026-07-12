import { Module } from '@nestjs/common';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';
import { AuthController } from './auth.controller';

@Module({
  providers: [ClerkAuthGuard],
  exports: [ClerkAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
