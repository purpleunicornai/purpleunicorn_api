// Request handler used by api/index.ts on Vercel. The Nest app is cached
// on the module for the life of the isolate — see createApp.
import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './bootstrap';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await createApp();
  app.getHttpAdapter().getInstance()(req, res);
}
