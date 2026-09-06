import { createServerFn } from "@tanstack/react-start";

export const getShadowRadar = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("@/lib/watch/store");
  const { buildShadowRadar } = await import("./shadow-radar");
  const history = await createPgStore(await getSql()).listHistory(200);
  return buildShadowRadar(history);
});
