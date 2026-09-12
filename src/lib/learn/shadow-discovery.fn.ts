import { createServerFn } from "@tanstack/react-start";

export const getShadowDiscovery = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { readDiscoveryLab } = await import("./shadow-discovery");
  try {
    const sql = await getSql();
    const result = await readDiscoveryLab(sql);
    return { ok: true as const, ...result };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "discovery unavailable",
    };
  }
});

export const updateShadowDiscoveryCoverage = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { ingestDiscoveryCoverage } = await import("./shadow-discovery");
  try {
    const sql = await getSql();
    const result = await ingestDiscoveryCoverage(sql);
    return { ok: true as const, ...result };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "discovery ingest unavailable",
    };
  }
});
