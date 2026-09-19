/**
 * Archive discovery OHLC as JSONL by asset / tf / UTC day.
 * Streaming / chunked writes; SHA-256 of content; never load full history into RAM.
 */
import { createHash } from "node:crypto";
import type { ArchiveBar, JsonlDayArchiveMeta } from "./types";

const DAY_MS = 86_400_000;

/** Minimal object-storage surface used by day archives (S3-compatible / B2). */
export interface JsonlObjectStore {
  putObject(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  getObjectText(key: string): Promise<string>;
}

/** Object key: discovery/{assetId}/{tf}/{YYYY-MM-DD}.jsonl */
export function discoveryDayObjectKey(assetId: string, tf: string, day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid UTC day (expected YYYY-MM-DD): ${day}`);
  }
  return `discovery/${assetId}/${tf}/${day}.jsonl`;
}

/** UTC calendar day for a bar time. Accepts unix seconds or ms. */
export function utcDayFromT(t: number): string {
  const ms = t > 1e12 ? t : t * 1000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) throw new Error(`Invalid bar t: ${t}`);
  return d.toISOString().slice(0, 10);
}

export function utcDayBoundsMs(day: string): { startMs: number; endMs: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid UTC day: ${day}`);
  }
  const startMs = Date.parse(`${day}T00:00:00.000Z`);
  return { startMs, endMs: startMs + DAY_MS };
}

/** One JSONL line (no trailing newline). Stable field order. */
export function barToJsonlLine(bar: ArchiveBar): string {
  const row: Record<string, unknown> = {
    assetId: bar.assetId,
    tf: bar.tf,
    t: bar.t,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
  };
  if (bar.source != null) row.source = bar.source;
  return JSON.stringify(row);
}

/**
 * Encode bars as JSONL. Processes in chunks so callers can stream pages
 * without concatenating the entire history first.
 */
export function encodeBarsJsonl(
  bars: Iterable<ArchiveBar>,
  chunkSize = 500,
): { text: string; sha256: string; byteSize: number; rowCount: number } {
  const hash = createHash("sha256");
  const parts: string[] = [];
  let rowCount = 0;
  let chunk: string[] = [];

  const flush = () => {
    if (!chunk.length) return;
    const block = chunk.join("\n") + "\n";
    parts.push(block);
    hash.update(block);
    chunk = [];
  };

  for (const bar of bars) {
    chunk.push(barToJsonlLine(bar));
    rowCount += 1;
    if (chunk.length >= chunkSize) flush();
  }
  flush();

  const text = parts.join("");
  const byteSize = Buffer.byteLength(text, "utf8");
  return { text, sha256: hash.digest("hex"), byteSize, rowCount };
}

/** Incremental hasher for streaming page → JSONL without holding all pages. */
export class JsonlShaWriter {
  private readonly hash = createHash("sha256");
  private readonly parts: string[] = [];
  private rowCount = 0;
  private byteSize = 0;

  writeBars(bars: readonly ArchiveBar[]): void {
    if (!bars.length) return;
    const block = bars.map(barToJsonlLine).join("\n") + "\n";
    this.parts.push(block);
    this.hash.update(block);
    this.byteSize += Buffer.byteLength(block, "utf8");
    this.rowCount += bars.length;
  }

  finish(): { text: string; sha256: string; byteSize: number; rowCount: number } {
    return {
      text: this.parts.join(""),
      sha256: this.hash.digest("hex"),
      byteSize: this.byteSize,
      rowCount: this.rowCount,
    };
  }
}

export function parseJsonlBars(text: string): ArchiveBar[] {
  const out: ArchiveBar[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const row = JSON.parse(s) as ArchiveBar;
    out.push(row);
  }
  return out;
}

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Write one UTC-day archive to object storage (chunked encode).
 * Does not load unrelated days.
 */
export async function writeDiscoveryDayArchive(
  store: JsonlObjectStore,
  args: { assetId: string; tf: string; day: string; bars: readonly ArchiveBar[] },
): Promise<JsonlDayArchiveMeta> {
  const objectKey = discoveryDayObjectKey(args.assetId, args.tf, args.day);
  const encoded = encodeBarsJsonl(args.bars);
  await store.putObject(objectKey, encoded.text);
  return {
    objectKey,
    assetId: args.assetId,
    tf: args.tf,
    day: args.day,
    contentSha256: encoded.sha256,
    byteSize: encoded.byteSize,
    rowCount: encoded.rowCount,
  };
}

export async function readDiscoveryDayArchive(
  store: JsonlObjectStore,
  assetId: string,
  tf: string,
  day: string,
): Promise<{ meta: JsonlDayArchiveMeta; bars: ArchiveBar[] }> {
  const objectKey = discoveryDayObjectKey(assetId, tf, day);
  const text = await store.getObjectText(objectKey);
  const bars = parseJsonlBars(text);
  const sha = sha256Utf8(text);
  return {
    bars,
    meta: {
      objectKey,
      assetId,
      tf,
      day,
      contentSha256: sha,
      byteSize: Buffer.byteLength(text, "utf8"),
      rowCount: bars.length,
    },
  };
}
