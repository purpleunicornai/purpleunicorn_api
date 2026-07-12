import { Inject, Injectable } from '@nestjs/common';
import { ClerkClient, createClerkClient, verifyToken } from '@clerk/backend';
import authConfig from '../../config/auth.config';
import { type ConfigType } from '@nestjs/config';

@Injectable()
export class ClerkService {
  client: ClerkClient;

  constructor(
    @Inject(authConfig.KEY)
    private readonly authConf: ConfigType<typeof authConfig>,
  ) {
    this.client = createClerkClient({
      secretKey: this.authConf.clerkSecret,
    });
  }

  async getUser(userId: string) {
    return this.client.users.getUser(userId);
  }

  async validateToken(token: string) {
    return verifyToken(token, {
      secretKey: this.authConf.clerkSecret,
    });
  }
}
