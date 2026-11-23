import type { ReasoningService } from './reasoning.service';
import {
  DEFAULT_REASONING_MODEL,
  type ReasoningProvider,
} from './reasoning-model';

// A ReasoningService for specs that resolves every org and role to
// `provider` (usually a mocked GeminiService) and `model`.
export function reasoningServiceFor(
  provider: Omit<ReasoningProvider, 'id'>,
  model = DEFAULT_REASONING_MODEL.model,
): ReasoningService {
  const resolved = { provider: provider as ReasoningProvider, model };
  return {
    forOrganization: jest.fn().mockResolvedValue(resolved),
    forRole: jest.fn().mockResolvedValue(resolved),
  } as unknown as ReasoningService;
}
