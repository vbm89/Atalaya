import { authorizeWatchRequest } from "../watch/secret";

export function authorizeDiscoveryWrite(request: Request) {
  return authorizeWatchRequest(request);
}

export async function handleDiscoveryWrite(request: Request): Promise<Response> {
  const auth = authorizeDiscoveryWrite(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status, headers: { "cache-control": "no-store" } });
  }
  const { getSql } = await import("@/lib/db");
  const { ingestDiscoveryCoverage } = await import("./shadow-discovery");
  try {
    const sql = await getSql();
    const result = await ingestDiscoveryCoverage(sql);
    return Response.json({ ok: true as const, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json(
      { ok: false as const, error: e instanceof Error ? e.message : "discovery ingest unavailable" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
