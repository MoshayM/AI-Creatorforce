import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Correlation IDs (docs4/32 + /02 + /38): every request and job carries an
 * ID that survives across the gateway → service → worker path so one incident
 * can be traced end-to-end. Kept in its own AsyncLocalStorage (separate from
 * the AI usage context, which has a different lifetime: a job's usage context
 * spans retries; its correlation ID does not change).
 */
const storage = new AsyncLocalStorage<{ correlationId: string }>();

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

const HEADER = 'x-correlation-id';
// Accept only sane client-supplied IDs; anything else gets replaced so log
// pipelines can't be polluted by attacker-controlled strings.
const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Express middleware: adopt or mint the ID, echo it on the response. */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header(HEADER);
  const correlationId = supplied && VALID_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader(HEADER, correlationId);
  runWithCorrelationId(correlationId, () => next());
}
