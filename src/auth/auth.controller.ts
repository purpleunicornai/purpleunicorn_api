import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClerkService } from '../common/clerk/clerk.service';
import { CurrentAuth } from './current-auth.decorator';
import type { ClerkAuthContext } from './auth.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private clerkService: ClerkService) {}

  @Get('user')
  async getUser(@CurrentAuth() auth: ClerkAuthContext) {
    return this.clerkService.getUser(auth.userId);
  }
}
