import type { SqlQuery } from "./store";
import { readWatchHealth, toPublicWatchHealth } from "./health";
import { createPgStore } from "./store";
import { LAB_COUNTS_SQL, LAB_UNAVAILABLE, labUnavailable, parseLabCounts, tickIntegrityLabel, type LabIntegrity } from "./lab-integrity";
import { V1_FINGERPRINT_STATUS } from "./v1-fingerprint.generated";
import { MIN_TEST_N, evidenceLabelFor } from "@/lib/learn/shadow-analysis";

export function inspectV1Sha(): "intacta" | "error" | typeof LAB_UNAVAILABLE {
  return V1_FINGERPRINT_STATUS;
}

export async function readLabIntegrity(sql: SqlQuery, nowMs: number): Promise<LabIntegrity> {
  const v1Sha = inspectV1Sha();
  let tick = LAB_UNAVAILABLE;
  let persistence: LabIntegrity["persistence"] = LAB_UNAVAILABLE;
  try {
    const store = createPgStore(sql);
    const health = await readWatchHealth(store, nowMs);
    const pub = toPublicWatchHealth(health, nowMs, { persistence: "ok" });
    tick = tickIntegrityLabel(pub);
    persistence = "OK";
  } catch {
    persistence = "error";
  }

  let counts = parseLabCounts(null);
  try {
    const rows = await sql.query<Record<string, unknown>>(LAB_COUNTS_SQL);
    counts = parseLabCounts(rows[0]);
  } catch {
    counts = parseLabCounts(null);
  }

  // The current lab database does not persist a replay report. Keep the
  // historical fields unavailable rather than reconstructing or inventing it.
  // MIN_TEST_N is nevertheless exposed through the evidence label so the UI
  // has a stable methodological threshold.
  const extraTestN = null;
  const evidence = evidenceLabelFor("INSUFFICIENT", extraTestN ?? 0);

  return {
    tick,
    persistence,
    v1Sha,
    ...counts,
    lastShadowReplayAt: null,
    lastShadowReplayResult: `Evidencia ${evidence} · mínimo EXTRA TEST ${MIN_TEST_N}`,
    extraTestN,
    lastReplayInsufficient: true,
  };
}

export function failedLabIntegrity(): LabIntegrity {
  return labUnavailable("error");
}
