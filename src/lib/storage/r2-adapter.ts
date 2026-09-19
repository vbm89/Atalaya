/**
 * S3-compatible Cloudflare R2 adapter.
 * Inactive (active:false) when required env vars are missing — methods throw
 * InactiveStorageError. Never logs secret values.
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { InactiveStorageError } from "./types";

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export type R2EnvName = (typeof REQUIRED_ENV)[number] | "R2_ENDPOINT";

export interface R2AdapterConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
}

export interface R2ObjectMeta {
  key: string;
  size?: number;
  etag?: string;
}

function readRequiredEnv(env: NodeJS.ProcessEnv = process.env): {
  active: true;
  config: R2AdapterConfig;
} | {
  active: false;
  missing: string[];
} {
  const missing: string[] = [];
  for (const k of REQUIRED_ENV) {
    const v = env[k];
    if (!v || !String(v).trim()) missing.push(k);
  }
  if (missing.length) return { active: false, missing };

  const accountId = String(env.R2_ACCOUNT_ID).trim();
  const endpoint =
    (env.R2_ENDPOINT && String(env.R2_ENDPOINT).trim()) ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    active: true,
    config: {
      accountId,
      accessKeyId: String(env.R2_ACCESS_KEY_ID).trim(),
      secretAccessKey: String(env.R2_SECRET_ACCESS_KEY).trim(),
      bucket: String(env.R2_BUCKET).trim(),
      endpoint,
    },
  };
}

export class R2Adapter {
  readonly active: boolean;
  readonly missingEnv: readonly string[];
  private readonly config: R2AdapterConfig | null;
  private client: S3Client | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const parsed = readRequiredEnv(env);
    if (!parsed.active) {
      this.active = false;
      this.missingEnv = parsed.missing;
      this.config = null;
      return;
    }
    this.active = true;
    this.missingEnv = [];
    this.config = parsed.config;
  }

  private ensureActive(): R2AdapterConfig {
    if (!this.active || !this.config) {
      const miss = this.missingEnv.length
        ? ` missing: ${this.missingEnv.join(", ")}`
        : "";
      throw new InactiveStorageError(
        `R2 storage is inactive (required env vars missing).${miss}`,
      );
    }
    return this.config;
  }

  private getClient(): S3Client {
    const cfg = this.ensureActive();
    if (!this.client) {
      this.client = new S3Client({
        region: "auto",
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });
    }
    return this.client;
  }

  get bucket(): string {
    return this.ensureActive().bucket;
  }

  async putObject(key: string, body: Uint8Array | string, contentType = "application/x-ndjson"): Promise<void> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async getObjectBytes(key: string): Promise<Uint8Array> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    const out = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );
    if (!out.Body) return new Uint8Array(0);
    const buf = await out.Body.transformToByteArray();
    return buf;
  }

  async getObjectText(key: string): Promise<string> {
    const bytes = await this.getObjectBytes(key);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async headObject(key: string): Promise<R2ObjectMeta | null> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
      return { key, size: out.ContentLength, etag: out.ETag };
    } catch (err: unknown) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
      const status =
        err && typeof err === "object" && "$metadata" in err
          ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
      if (name === "NotFound" || status === 404) return null;
      throw err;
    }
  }

  async listPrefix(prefix: string, maxKeys = 1000): Promise<R2ObjectMeta[]> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    );
    return (out.Contents ?? [])
      .filter((o): o is NonNullable<typeof o> & { Key: string } => Boolean(o.Key))
      .map((o) => ({ key: o.Key, size: o.Size, etag: o.ETag }));
  }

  /** Destroy pooled client if any (no-op when inactive). */
  destroy(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

export function createR2Adapter(env: NodeJS.ProcessEnv = process.env): R2Adapter {
  return new R2Adapter(env);
}
