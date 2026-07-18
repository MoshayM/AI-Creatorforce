import { Injectable } from '@nestjs/common';
import { promises as fs, createReadStream, existsSync } from 'fs';
import type { ReadStream } from 'fs';
import * as path from 'path';

/**
 * Local-disk object storage using the same key scheme as R2
 * (assets/{projectId}/{assetId}/v{n}/file.ext). Subclass R2StorageService
 * overrides put/copyIn/flush/ensure/removePrefix to also sync with R2.
 * Switch via STORAGE_BACKEND=r2.
 */
@Injectable()
export class StorageService {
  private readonly root =
    process.env['MEDIA_STORAGE_DIR'] ?? path.join(process.cwd(), 'storage');

  resolve(key: string): string {
    // Keys always use forward slashes; never allow escaping the root
    const safe = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    return path.join(this.root, safe);
  }

  async put(key: string, data: Buffer): Promise<{ absPath: string; sizeBytes: number }> {
    const absPath = this.resolve(key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, data);
    return { absPath, sizeBytes: data.length };
  }

  async copyIn(key: string, sourceAbsPath: string): Promise<{ absPath: string; sizeBytes: number }> {
    const absPath = this.resolve(key);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.copyFile(sourceAbsPath, absPath);
    const stat = await fs.stat(absPath);
    return { absPath, sizeBytes: stat.size };
  }

  exists(key: string): boolean {
    return existsSync(this.resolve(key));
  }

  stream(key: string): ReadStream {
    return createReadStream(this.resolve(key));
  }

  /**
   * Recursively remove everything under a key prefix (asset GC, docs4/09).
   * Requires ≥2 path segments (e.g. `assets/{projectId}/{assetId}`) so a bug
   * can never wipe a whole top-level directory, let alone the root.
   */
  async removePrefix(prefix: string): Promise<void> {
    const clean = prefix.replace(/^[/\\]+|[/\\]+$/g, '');
    if (!clean || clean.split(/[/\\]/).filter(Boolean).length < 2) {
      throw new Error(`removePrefix requires a scoped prefix, got '${prefix}'`);
    }
    await fs.rm(this.resolve(clean), { recursive: true, force: true });
  }

  async list(prefix: string): Promise<Array<{ name: string; sizeBytes: number }>> {
    const dir = this.resolve(prefix);
    if (!existsSync(dir)) return [];
    const names = await fs.readdir(dir);
    const out: Array<{ name: string; sizeBytes: number }> = [];
    for (const name of names) {
      const stat = await fs.stat(path.join(dir, name));
      if (stat.isFile()) out.push({ name, sizeBytes: stat.size });
    }
    return out;
  }

  /**
   * Upload the file at resolve(key) to the remote store.
   * No-op for local driver; R2StorageService overrides this.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async flush(_key: string): Promise<void> {
    // local files are already at their permanent path — nothing to do
  }

  /**
   * Ensure the file at key is available locally. Downloads from remote if absent.
   * Returns true if the file is now available, false if it does not exist anywhere.
   */
  async ensure(key: string): Promise<boolean> {
    return this.exists(key);
  }
}
