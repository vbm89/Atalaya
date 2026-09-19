import assert from "node:assert/strict";
import test from "node:test";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  createObjectStorageAdapter,
  type ObjectStorageClientFactory,
} from "./s3-adapter";
import { InactiveStorageError } from "./types";

const FULL_ENV = {
  OBJECT_STORAGE_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
  OBJECT_STORAGE_REGION: "us-east-005",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key-id",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "super-secret-value",
  OBJECT_STORAGE_BUCKET: "atalaya-dev-storage",
};

test("inactive when OBJECT_STORAGE_* vars missing", () => {
  const store = createObjectStorageAdapter({});
  assert.equal(store.active, false);
  assert.ok(store.missingEnv.includes("OBJECT_STORAGE_ENDPOINT"));
  assert.ok(store.missingEnv.includes("OBJECT_STORAGE_REGION"));
  assert.ok(store.missingEnv.includes("OBJECT_STORAGE_ACCESS_KEY_ID"));
  assert.ok(store.missingEnv.includes("OBJECT_STORAGE_SECRET_ACCESS_KEY"));
  assert.ok(store.missingEnv.includes("OBJECT_STORAGE_BUCKET"));
});

test("inactive methods throw InactiveStorageError listing env NAMES only", async () => {
  const store = createObjectStorageAdapter({
    OBJECT_STORAGE_BUCKET: "only-bucket",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "super-secret-value",
  });
  assert.equal(store.active, false);
  await assert.rejects(() => store.putObject("k", "x"), (err: unknown) => {
    assert.ok(err instanceof InactiveStorageError);
    const msg = String((err as Error).message);
    assert.match(msg, /missing/i);
    assert.match(msg, /OBJECT_STORAGE_ENDPOINT/);
    assert.equal(msg.includes("super-secret-value"), false);
    return true;
  });
  await assert.rejects(() => store.getObjectText("k"), InactiveStorageError);
  await assert.rejects(() => store.listPrefix("p"), InactiveStorageError);
  assert.throws(() => store.getPublicConfig(), InactiveStorageError);
});

test("public config endpoint/region/bucket when all set (no network)", () => {
  const store = createObjectStorageAdapter(FULL_ENV);
  assert.equal(store.active, true);
  assert.deepEqual(store.missingEnv, []);
  const pub = store.getPublicConfig();
  assert.deepEqual(pub, {
    endpoint: "https://s3.us-east-005.backblazeb2.com",
    region: "us-east-005",
    bucket: "atalaya-dev-storage",
    forcePathStyle: false,
  });
  assert.equal(JSON.stringify(pub).includes("super-secret-value"), false);
  store.destroy();
});

test("bucket getter returns configured bucket", () => {
  const store = createObjectStorageAdapter(FULL_ENV);
  assert.equal(store.bucket, "atalaya-dev-storage");
  store.destroy();
});

test("secrets never appear in inactive error messages", async () => {
  const store = createObjectStorageAdapter({
    OBJECT_STORAGE_ENDPOINT: "https://example.invalid",
    OBJECT_STORAGE_REGION: "us-east-005",
    OBJECT_STORAGE_ACCESS_KEY_ID: "key-id",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "super-secret-value",
    // bucket missing → inactive
  });
  assert.equal(store.active, false);
  try {
    await store.putObject("k", "x");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof InactiveStorageError);
    assert.equal(String((err as Error).message).includes("super-secret-value"), false);
  }
});

test("put/get/head/list via mocked clientFactory (no network)", async () => {
  const sent: unknown[] = [];
  const bodies = new Map<string, Uint8Array>();

  const clientFactory: ObjectStorageClientFactory = (args) => {
    assert.equal(args.endpoint, FULL_ENV.OBJECT_STORAGE_ENDPOINT);
    assert.equal(args.region, FULL_ENV.OBJECT_STORAGE_REGION);
    assert.equal(args.forcePathStyle, false);
    assert.equal(args.credentials.accessKeyId, FULL_ENV.OBJECT_STORAGE_ACCESS_KEY_ID);
    return {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof PutObjectCommand) {
          const input = command.input;
          const body = input.Body as Uint8Array;
          bodies.set(String(input.Key), body);
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const key = String(command.input.Key);
          const buf = bodies.get(key) ?? new Uint8Array(0);
          return {
            Body: {
              transformToByteArray: async () => buf,
            },
          };
        }
        if (command instanceof HeadObjectCommand) {
          const key = String(command.input.Key);
          const buf = bodies.get(key);
          if (!buf) {
            const err = Object.assign(new Error("NotFound"), {
              name: "NotFound",
              $metadata: { httpStatusCode: 404 },
            });
            throw err;
          }
          return { ContentLength: buf.byteLength, ETag: '"etag"' };
        }
        if (command instanceof ListObjectsV2Command) {
          const prefix = String(command.input.Prefix ?? "");
          return {
            Contents: [...bodies.entries()]
              .filter(([k]) => k.startsWith(prefix))
              .map(([k, v]) => ({ Key: k, Size: v.byteLength, ETag: '"etag"' })),
          };
        }
        throw new Error(`unexpected command ${String(command)}`);
      },
      destroy() {},
    };
  };

  const store = createObjectStorageAdapter(FULL_ENV, { clientFactory });
  await store.putObject("discovery/XAUUSD/15m/2024-01-01.jsonl", '{"t":1}\n');
  const text = await store.getObjectText("discovery/XAUUSD/15m/2024-01-01.jsonl");
  assert.equal(text, '{"t":1}\n');
  const head = await store.headObject("discovery/XAUUSD/15m/2024-01-01.jsonl");
  assert.ok(head);
  assert.equal(head.key, "discovery/XAUUSD/15m/2024-01-01.jsonl");
  assert.ok((head.size ?? 0) > 0);
  const missing = await store.headObject("nope");
  assert.equal(missing, null);
  const listed = await store.listPrefix("discovery/");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, "discovery/XAUUSD/15m/2024-01-01.jsonl");
  assert.ok(sent.length >= 4);
  store.destroy();
});
