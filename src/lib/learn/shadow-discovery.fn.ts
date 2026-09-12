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
  const { getRequest } = await import("@tanstack/react-start/server");
  const { handleDiscoveryUiWrite } = await import("./shadow-discovery-http");
  const request = getRequest();
  if (!request) {
    return { ok: false as const, error: "Forbidden." };
  }
  const res = await handleDiscoveryUiWrite(request);
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false as const,
      error: typeof body.error === "string" ? body.error : "Forbidden.",
    };
  }
  return { ok: true as const, ...body };
});
