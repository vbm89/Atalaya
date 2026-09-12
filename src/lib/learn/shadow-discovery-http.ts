import { timingSafeEqual } from "node:crypto";
import { authorizeWatchRequest, watchSecret } from "../watch/secret";
import type { DiscoveryExploreOnceResult } from "./shadow-discovery-explore-once";

const NO_STORE = { "cache-control": "no-store" } as const;
const MIN_TOKEN_LEN = 16;

export type DiscoveryWriteRunner = () => Promise<Record<string, unknown>>;
export type DiscoveryExploreRunner = () => Promise<DiscoveryExploreOnceResult>;

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** Server-only. Never log, never return, never send to the client. */
export function discoveryExploreToken(): string | null {
  const raw = typeof process === "undefined" ? undefined : process.env.DISCOVERY_EXPLORE_TOKEN;
  const value = raw?.trim() ?? "";
  if (value.length < MIN_TOKEN_LEN) return null;
  return value;
}

async function defaultDiscoveryIngest(): Promise<Record<string, unknown>> {
  const { getSql } = await import("@/lib/db");
  const { ingestDiscoveryCoverage } = await import("./shadow-discovery");
  const sql = await getSql();
  const result = await ingestDiscoveryCoverage(sql);
  return result as unknown as Record<string, unknown>;
}

async function defaultDiscoveryExplore(): Promise<DiscoveryExploreOnceResult> {
  const { getSql } = await import("@/lib/db");
  const { exploreDiscoveryOnce } = await import("./shadow-discovery-explore-once");
  const sql = await getSql();
  return exploreDiscoveryOnce(sql);
}

export function authorizeDiscoveryWrite(request: Request) {
  return authorizeWatchRequest(request);
}

/**
 * Temporary one-shot explore auth.
 * Accepts DISCOVERY_EXPLORE_TOKEN (this route only) or WATCH_SECRET (unchanged).
 * DISCOVERY_EXPLORE_TOKEN must not be used by ingest / other endpoints.
 */
export function authorizeDiscoveryExplore(request: Request):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  const explore = discoveryExploreToken();
  const provided = bearerToken(request);
  if (explore && provided && equal(provided, explore)) return { ok: true };
  if (explore) {
    const watch = authorizeWatchRequest(request);
    if (watch.ok) return watch;
    return { ok: false, status: 401, error: "No autorizado." };
  }
  return authorizeWatchRequest(request);
}

/**
 * UI button origin gate. Stricter than assertSameSiteRequest:
 * missing / none / same-site / cross-site are all 403.
 * Only Sec-Fetch-Site: same-origin may proceed.
 */
export function discoveryUiOrigin(request: Request):
  | { ok: true }
  | { ok: false; status: 403; error: string } {
  const site = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (site !== "same-origin") {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  return { ok: true };
}

export async function handleDiscoveryWrite(
  request: Request,
  run: DiscoveryWriteRunner = defaultDiscoveryIngest,
): Promise<Response> {
  const auth = authorizeDiscoveryWrite(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = await run();
    return Response.json({ ok: true as const, ...result }, { headers: NO_STORE });
  } catch (e) {
    return Response.json(
      { ok: false as const, error: e instanceof Error ? e.message : "discovery ingest unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** Same-origin UI path. Injects WATCH_SECRET server-side; never reads it from the client. */
export async function handleDiscoveryUiWrite(
  request: Request,
  run: DiscoveryWriteRunner = defaultDiscoveryIngest,
): Promise<Response> {
  const origin = discoveryUiOrigin(request);
  if (!origin.ok) {
    return Response.json({ error: origin.error }, { status: origin.status, headers: NO_STORE });
  }
  const secret = watchSecret();
  if (!secret) {
    return Response.json({ error: "WATCH_SECRET no configurado." }, { status: 503, headers: NO_STORE });
  }
  const internal = new Request("http://atalaya.internal/api/shadow/discovery", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  return handleDiscoveryWrite(internal, run);
}

/** Explicit one-shot explore. Never used by GET/lab/ingest/UI coverage button. */
export async function handleDiscoveryExplore(
  request: Request,
  run: DiscoveryExploreRunner = defaultDiscoveryExplore,
): Promise<Response> {
  const auth = authorizeDiscoveryExplore(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = await run();
    const payload = {
      ok: true as const,
      journalId: result.journalId,
      persisted: result.persisted,
      nCommon4: result.nCommon4,
      outcomesSampled: result.catalog.report.outcomesSampled,
      outcomeConsulted: result.catalog.report.journal.outcomeConsulted,
      candidates: result.catalog.report.journal.candidates,
      rankingByExpectancy: result.catalog.report.rankingByExpectancy,
      universe: result.catalog.report.journal.universe,
      cells: result.catalog.cells,
      sequenceCells: result.catalog.sequenceCells,
      sequences: result.catalog.sequences,
      catalogN: result.catalog.catalogN,
      warmupExcludedN: result.catalog.warmupExcludedN,
      warmupTaggedN: result.catalog.warmupTaggedN,
      outsideWindowN: result.catalog.outsideWindowN,
      k1TestExcludedN: result.catalog.k1TestExcludedN,
      detectedN: result.catalog.detectedN,
      eventCounts: result.catalog.report.eventCounts,
      sequenceCounts: result.catalog.report.sequenceCounts,
      journal: result.catalog.report.journal,
    };
    return Response.json(payload, { headers: NO_STORE });
  } catch (e) {
    const already =
      (e instanceof Error && e.name === "DiscoveryExploreAlreadyExecuted") ||
      (e instanceof Error && e.message.startsWith("ALREADY_EXECUTED"));
    if (already) {
      return Response.json(
        { ok: false as const, error: "ALREADY_EXECUTED", code: "ALREADY_EXECUTED" },
        { status: 409, headers: NO_STORE },
      );
    }
    const aborted = e instanceof Error && e.name === "DiscoveryExploreAbort";
    const message = e instanceof Error ? e.message : "discovery explore unavailable";
    return Response.json(
      { ok: false as const, error: message.startsWith("ALREADY_EXECUTED") ? "ALREADY_EXECUTED" : message },
      { status: aborted ? 409 : 500, headers: NO_STORE },
    );
  }
}
