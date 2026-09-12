import { authorizeWatchRequest, watchSecret } from "../watch/secret";

const NO_STORE = { "cache-control": "no-store" } as const;

export type DiscoveryWriteRunner = () => Promise<Record<string, unknown>>;

async function defaultDiscoveryIngest(): Promise<Record<string, unknown>> {
  const { getSql } = await import("@/lib/db");
  const { ingestDiscoveryCoverage } = await import("./shadow-discovery");
  const sql = await getSql();
  const result = await ingestDiscoveryCoverage(sql);
  return result as unknown as Record<string, unknown>;
}

export function authorizeDiscoveryWrite(request: Request) {
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
