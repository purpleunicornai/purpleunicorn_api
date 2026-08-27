import { Inject, Injectable } from '@nestjs/common';
import { Clerk, verifyToken, type User } from '@clerk/clerk-sdk-node';
import authConfig from '../../config/auth.config.js';
import { type ConfigType } from '@nestjs/config';

@Injectable()
export class ClerkService {
  client: ReturnType<typeof Clerk>;

  constructor(
    @Inject(authConfig.KEY)
    private readonly authConf: ConfigType<typeof authConfig>,
  ) {
    this.client = Clerk({ secretKey: this.authConf.clerkSecret });
  }

  async getSession(sessionId: string) {
    return this.client.sessions.getSession(sessionId);
  }

  async validateToken(token: string) {
    return verifyToken(token, {
      secretKey: this.authConf.clerkSecret,
      issuer: this.authConf.clerkIssuerUrl ?? null,
    });
  }

  async getUser(userId: string): Promise<User> {
    return this.client.users.getUser(userId);
  }
}
