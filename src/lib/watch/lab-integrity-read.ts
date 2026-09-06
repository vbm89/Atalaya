import type { PublicWatchHealth } from "./health";
import type { SqlQuery } from "./store";
import { readWatchHealth, toPublicWatchHealth } from "./health";
import { createPgStore } from "./store";
import {
  LAB_COUNTS_SQL,
  LAB_UNAVAILABLE,
  labUnavailable,
  parseLabCounts,
  tickIntegrityLabel,
  type LabIntegrity,
} from "./lab-integrity";
import { V1_FINGERPRINT_STATUS } from "./v1-fingerprint.generated";

/**
 * V1 integrity is verified at build time by check-v1-sha.mjs. The generated
 * module is bundled with the serverless function, so the lab does not depend
 * on protected source files being present in the runtime filesystem.
 */
export function inspectV1Sha(): "intacta" | "error" | typeof LAB_UNAVAILABLE {
  return V1_FINGERPRINT_STATUS;
}

/**
 * Read-only laboratory snapshot. SELECT only. Never writes. Shadow replay is
 * ephemeral — last replay fields stay unavailable rather than invented.
 */
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

  return {
    tick,
    persistence,
    v1Sha,
    ...counts,
    lastShadowReplayAt: null,
    lastShadowReplayResult: null,
    extraTestN: null,
    lastReplayInsufficient: null,
  };
}

export function failedLabIntegrity(): LabIntegrity {
  return labUnavailable("error");
}
