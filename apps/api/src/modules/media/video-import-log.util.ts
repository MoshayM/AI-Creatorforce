import { promises as fsp } from 'fs';
import * as path from 'path';

/**
 * Append one JSON-lines entry to logs/video-import.log at the monorepo root.
 * The API runs from apps/api, so we resolve ../../logs relative to cwd.
 * Never throws — IO errors are swallowed to keep callers clean.
 */
export async function appendVideoImportLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const logsDir = path.resolve(process.cwd(), '../../logs');
    await fsp.mkdir(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'video-import.log');
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    await fsp.appendFile(logPath, line, 'utf8');
  } catch {
    // Swallow all IO errors — logging must never crash the pipeline
  }
}
