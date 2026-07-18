import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { promises as fsp, createReadStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import type { Readable } from 'stream';
import * as path from 'path';
import { StorageService } from './storage.service';

/**
 * Cloudflare R2 storage driver (S3-compatible).
 * Extends StorageService so all callers remain unchanged.
 *
 * Write-through strategy:
 *  - put() / copyIn() → write locally AND upload to R2
 *  - flush(key)       → upload local file to R2 (for FFmpeg output paths)
 *  - ensure(key)      → if not local, download from R2; returns availability
 *  - removePrefix()   → delete from R2 AND local staging
 *  - list()           → authoritative listing from R2
 *
 * Environment variables (all required when STORAGE_BACKEND=r2):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET          (default: creatorforce-assets)
 *   R2_PUBLIC_URL      (optional — base URL for public asset serving)
 */
@Injectable()
export class R2StorageService extends StorageService {
  private readonly log = new Logger(R2StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  readonly publicBaseUrl: string | null;

  constructor() {
    super();
    const accountId = process.env['R2_ACCOUNT_ID'];
    if (!accountId) throw new Error('R2_ACCOUNT_ID is required when STORAGE_BACKEND=r2');

    this.bucket = process.env['R2_BUCKET'] ?? 'creatorforce-assets';
    this.publicBaseUrl = process.env['R2_PUBLIC_URL'] ?? null;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env['R2_ACCESS_KEY_ID']!,
        secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
      },
    });
  }

  /** Returns the public CDN URL for a key, if R2_PUBLIC_URL is configured. */
  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  /** Write buffer locally and upload to R2. */
  override async put(key: string, data: Buffer): Promise<{ absPath: string; sizeBytes: number }> {
    const result = await super.put(key, data);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentLength: data.length,
    }));
    return result;
  }

  /** Copy file locally and upload to R2 (streaming multipart for large files). */
  override async copyIn(key: string, sourceAbsPath: string): Promise<{ absPath: string; sizeBytes: number }> {
    const result = await super.copyIn(key, sourceAbsPath);
    await this._uploadFile(key, result.absPath);
    return result;
  }

  /**
   * Upload the file already at resolve(key) (e.g. written by FFmpeg) to R2.
   * Called by the supervisor worker after a render completes.
   */
  override async flush(key: string): Promise<void> {
    const localPath = this.resolve(key);
    if (!existsSync(localPath)) {
      this.log.warn(`flush(${key}): local file not found — skipping R2 upload`);
      return;
    }
    await this._uploadFile(key, localPath);
    this.log.debug(`flush(${key}): uploaded to R2`);
  }

  /**
   * Ensure the file is available locally.
   * Downloads from R2 on cache miss. Returns false if the key does not exist in R2.
   */
  override async ensure(key: string): Promise<boolean> {
    if (existsSync(this.resolve(key))) return true;

    let response: GetObjectCommandOutput;
    try {
      response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      const code = (err as { name?: string }).name;
      if (code === 'NoSuchKey' || code === 'NotFound') return false;
      throw err;
    }

    const absPath = this.resolve(key);
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await pipeline(response.Body as Readable, createWriteStream(absPath));
    this.log.debug(`ensure(${key}): downloaded from R2`);
    return true;
  }

  /**
   * Delete all objects under a prefix from R2 (batch) and local staging.
   * Requires ≥2 path segments for safety (same guard as base class).
   */
  override async removePrefix(prefix: string): Promise<void> {
    const clean = prefix.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
    if (!clean || clean.split('/').filter(Boolean).length < 2) {
      throw new Error(`removePrefix requires a scoped prefix, got '${prefix}'`);
    }

    // Collect all matching keys in R2
    const toDelete: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: clean + '/',
        ContinuationToken: continuationToken,
      }));
      for (const obj of res.Contents ?? []) {
        if (obj.Key) toDelete.push(obj.Key);
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    // Batch delete (R2 limit: 1000 per request)
    for (let i = 0; i < toDelete.length; i += 1000) {
      await this.s3.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: toDelete.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }));
    }
    if (toDelete.length) this.log.debug(`removePrefix(${clean}): deleted ${toDelete.length} object(s) from R2`);

    // Also purge local staging
    await super.removePrefix(prefix);
  }

  /** List objects from R2 (authoritative across all instances). */
  override async list(prefix: string): Promise<Array<{ name: string; sizeBytes: number }>> {
    const clean = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const res = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: clean + '/',
    }));
    return (res.Contents ?? []).map((obj) => ({
      name: path.basename(obj.Key ?? ''),
      sizeBytes: obj.Size ?? 0,
    }));
  }

  /** Check R2 for key existence (async HeadObject). Use ensure() in render paths instead. */
  async existsInR2(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  private async _uploadFile(key: string, absPath: string): Promise<void> {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(absPath),
      },
    });
    await upload.done();
  }
}
