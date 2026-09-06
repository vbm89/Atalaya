import type { SqlQuery } from "./store";
import { readWatchHealth, toPublicWatchHealth } from "./health";
import { createPgStore } from "./store";
import { LAB_COUNTS_SQL, LAB_UNAVAILABLE, labUnavailable, parseLabCounts, tickIntegrityLabel, type LabIntegrity } from "./lab-integrity";
import { V1_FINGERPRINT_STATUS } from "./v1-fingerprint.generated";
import { MIN_TEST_N, evidenceLabelFor } from "@/lib/learn/shadow-analysis";
import { getLatestShadowReplayReport } from "@/lib/learn/shadow-replay-store";

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

  const latest = await getLatestShadowReplayReport(sql);
  const extraTestN = latest?.extraTestN ?? null;
  const evidence = latest ? latest.evidenceLabel : evidenceLabelFor("INSUFFICIENT", 0);
  const lastShadowReplayResult = latest
    ? `Evidencia ${evidence} · EXTRA TEST ${extraTestN}/${MIN_TEST_N} · metodología ${latest.methodologyVersion}`
    : `Evidencia ${evidence} · mínimo EXTRA TEST ${MIN_TEST_N} · sin replay persistido`;

  return {
    tick,
    persistence,
    v1Sha,
    ...counts,
    lastShadowReplayAt: latest?.generatedAt ?? null,
    lastShadowReplayResult,
    extraTestN,
    lastReplayInsufficient: extraTestN == null || extraTestN < MIN_TEST_N,
  };
}

export function failedLabIntegrity(): LabIntegrity {
  return labUnavailable("error");
}
