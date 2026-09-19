/**
 * Generic S3-compatible object storage adapter (Backblaze B2 via S3 API).
 * Inactive (active:false) when required env vars are missing — methods throw
 * InactiveStorageError. Never logs or embeds secret values.
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
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_BUCKET",
] as const;

export type ObjectStorageEnvName = (typeof REQUIRED_ENV)[number];

/** Full adapter config (includes credentials — never expose via getPublicConfig). */
export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** B2 S3 virtual-host works with endpoint; leave default false (not forcePathStyle). */
  forcePathStyle: false;
}

export interface ObjectStorageObjectMeta {
  key: string;
  size?: number;
  etag?: string;
}

/** Safe-to-log / test config — no secrets. */
export interface ObjectStoragePublicConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: false;
}

/** Minimal client surface used by the adapter (real S3Client or test mock). */
export interface ObjectStorageS3Client {
  send(command: unknown): Promise<unknown>;
  destroy(): void;
}

export type ObjectStorageClientFactory = (args: {
  endpoint: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle: false;
}) => ObjectStorageS3Client;

export interface ObjectStorageAdapterOptions {
  /** Injectable for unit tests / mocks — no network when provided. */
  clientFactory?: ObjectStorageClientFactory;
}

function readRequiredEnv(env: NodeJS.ProcessEnv = process.env):
  | { active: true; config: ObjectStorageConfig }
  | { active: false; missing: string[] } {
  const missing: string[] = [];
  for (const k of REQUIRED_ENV) {
    const v = env[k];
    if (!v || !String(v).trim()) missing.push(k);
  }
  if (missing.length) return { active: false, missing };

  return {
    active: true,
    config: {
      endpoint: String(env.OBJECT_STORAGE_ENDPOINT).trim(),
      region: String(env.OBJECT_STORAGE_REGION).trim(),
      accessKeyId: String(env.OBJECT_STORAGE_ACCESS_KEY_ID).trim(),
      secretAccessKey: String(env.OBJECT_STORAGE_SECRET_ACCESS_KEY).trim(),
      bucket: String(env.OBJECT_STORAGE_BUCKET).trim(),
      forcePathStyle: false,
    },
  };
}

function defaultClientFactory(args: {
  endpoint: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle: false;
}): ObjectStorageS3Client {
  // Do NOT set forcePathStyle — leave SDK default (false) for B2 virtual-host.
  return new S3Client({
    region: args.region,
    endpoint: args.endpoint,
    credentials: args.credentials,
  });
}

export class ObjectStorageAdapter {
  readonly active: boolean;
  readonly missingEnv: readonly string[];
  private readonly config: ObjectStorageConfig | null;
  private readonly clientFactory: ObjectStorageClientFactory;
  private client: ObjectStorageS3Client | null = null;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    options: ObjectStorageAdapterOptions = {},
  ) {
    const parsed = readRequiredEnv(env);
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
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

  private ensureActive(): ObjectStorageConfig {
    if (!this.active || !this.config) {
      const miss = this.missingEnv.length
        ? ` missing: ${this.missingEnv.join(", ")}`
        : "";
      throw new InactiveStorageError(
        `Object storage is inactive (required env vars missing).${miss}`,
      );
    }
    return this.config;
  }

  private getClient(): ObjectStorageS3Client {
    const cfg = this.ensureActive();
    if (!this.client) {
      this.client = this.clientFactory({
        endpoint: cfg.endpoint,
        region: cfg.region,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
        forcePathStyle: false,
      });
    }
    return this.client;
  }

  get bucket(): string {
    return this.ensureActive().bucket;
  }

  /** Public non-secret config for diagnostics / tests. Throws if inactive. */
  getPublicConfig(): ObjectStoragePublicConfig {
    const cfg = this.ensureActive();
    return {
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      forcePathStyle: false,
    };
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    contentType = "application/x-ndjson",
  ): Promise<void> {
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
    const out = (await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    )) as {
      Body?: { transformToByteArray(): Promise<Uint8Array> };
    };
    if (!out.Body) return new Uint8Array(0);
    return out.Body.transformToByteArray();
  }

  async getObjectText(key: string): Promise<string> {
    const bytes = await this.getObjectBytes(key);
    return new TextDecoder("utf-8").decode(bytes);
  }

  async headObject(key: string): Promise<ObjectStorageObjectMeta | null> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    try {
      const out = (await client.send(
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
      )) as { ContentLength?: number; ETag?: string };
      return { key, size: out.ContentLength, etag: out.ETag };
    } catch (err: unknown) {
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      const status =
        err && typeof err === "object" && "$metadata" in err
          ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;
      if (name === "NotFound" || status === 404) return null;
      throw err;
    }
  }

  async listPrefix(prefix: string, maxKeys = 1000): Promise<ObjectStorageObjectMeta[]> {
    const cfg = this.ensureActive();
    const client = this.getClient();
    const out = (await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    )) as {
      Contents?: Array<{ Key?: string; Size?: number; ETag?: string }>;
    };
    return (out.Contents ?? [])
      .filter((o): o is { Key: string; Size?: number; ETag?: string } => Boolean(o.Key))
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

export function createObjectStorageAdapter(
  env: NodeJS.ProcessEnv = process.env,
  options?: ObjectStorageAdapterOptions,
): ObjectStorageAdapter {
  return new ObjectStorageAdapter(env, options);
}

/** @deprecated Alias — prefer ObjectStorageAdapter */
export { ObjectStorageAdapter as S3Adapter };
/** @deprecated Alias — prefer createObjectStorageAdapter */
export const createS3Adapter = createObjectStorageAdapter;
