import { createServerFn } from "@tanstack/react-start";

export const getMarketAnalysis = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runMarketAnalysis } = await import("./run-analysis");
    return runMarketAnalysis(Boolean(data.force));
  });
