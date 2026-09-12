import { createServerFn } from "@tanstack/react-start";

export const getShadowDiscovery = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { runDiscoveryLab } = await import("./shadow-discovery");
  try {
    const sql = await getSql();
    const result = await runDiscoveryLab(sql);
    return { ok: true as const, ...result };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "discovery unavailable",
    };
  }
});
