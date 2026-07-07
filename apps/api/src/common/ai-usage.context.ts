import { AsyncLocalStorage } from 'async_hooks';

/**
 * Attribution context for AI provider calls (Ai-video edit.md §12.2.8
 * per-video cost breakdown). The supervisor wraps each job dispatch and the
 * copilot wraps each chat turn; the shared aiClient's global usage listener
 * (UsageLedgerService) reads whatever context is active when a call lands —
 * no per-call plumbing through the services in between.
 */
export interface AiUsageContext {
  userId?: string;
  jobId?: string;
  projectId?: string;
  importedVideoId?: string;
}

const storage = new AsyncLocalStorage<AiUsageContext>();

export function runWithAiContext<T>(ctx: AiUsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentAiContext(): AiUsageContext | undefined {
  return storage.getStore();
}
