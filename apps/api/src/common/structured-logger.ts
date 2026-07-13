import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';
import { currentCorrelationId } from './correlation.context';

/**
 * Structured JSON logging (Updates/38, risk R-04): one JSON object per line on
 * stdout — machine-parseable so a future aggregator (Loki/ELK/CloudWatch) can
 * ingest without a format migration. Every line carries the request/job
 * correlation ID from AsyncLocalStorage, so API and worker lines for the same
 * incident join on one key.
 *
 * Dev keeps Nest's colorized console output (LOG_FORMAT unset); production —
 * or LOG_FORMAT=json anywhere — switches to JSON lines.
 */

const REDACTED = '[REDACTED]';
// Key-name deny list (Updates/38 "no secrets/PII"): matched case-insensitively
// against object keys anywhere in the payload tree.
const SENSITIVE_KEY = /password|passwd|secret|token|apikey|api_key|authorization|cookie|credential|private/i;

/** Deep-copy `value` with sensitive keys replaced. Pure — exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

/** Build the JSON log line object. Pure — exported for tests. */
export function buildLogEntry(
  level: LogLevel,
  message: unknown,
  context: string | undefined,
  extras: unknown[],
  correlationId: string | undefined,
  now: Date = new Date(),
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    ts: now.toISOString(),
    level,
    ...(context ? { context } : {}),
    msg: typeof message === 'string' ? message : redact(message),
    ...(correlationId ? { correlationId } : {}),
  };
  if (extras.length === 1) entry['detail'] = redact(extras[0]);
  else if (extras.length > 1) entry['detail'] = extras.map((e) => redact(e));
  return entry;
}

export class StructuredLogger implements LoggerService {
  /** Dev fallback: keep Nest's readable colorized output. */
  private readonly pretty =
    process.env['LOG_FORMAT'] !== 'json' && process.env['NODE_ENV'] !== 'production'
      ? new ConsoleLogger()
      : undefined;

  log(message: unknown, ...params: unknown[]) {
    this.write('log', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('verbose', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]) {
    if (this.pretty) {
      // Delegate verbatim — ConsoleLogger understands Nest's (message, ...,
      // context) calling convention and prints the familiar dev format.
      (this.pretty[level] as (m: unknown, ...p: unknown[]) => void)(message, ...params);
      return;
    }
    // Nest convention: the trailing string param is the context; for error()
    // a stack string may precede it.
    const context = typeof params[params.length - 1] === 'string' ? (params.pop() as string) : undefined;
    const entry = buildLogEntry(level, message, context, params, currentCorrelationId());
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }
}
