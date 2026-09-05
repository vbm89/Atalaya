import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Keep in sync with scripts/check-v1-sha.mjs — canonical pins live there. */
const V1_SHA256: Record<string, string> = {
  "src/lib/trading/engine.ts":
    "c3d53a4f4366add2c8a284d4f068ea5d2826a36e3aa259b460d74b37c36ce618",
  "src/lib/trading/signals.ts":
    "dfb2d2cd188b18daaebed5e843bd8dbefb1e1c6672be86d2092390a8b3bc019b",
  "src/lib/trading/structure.ts":
    "e72ba478f524170c7f6c1c6916e033c3fafb418b874aa33565e32dbd01b54170",
  "src/lib/trading/risk.ts":
    "4aa406c0061149486532e9f787d20c3cc9f845362dd5497fd42b42563b5d385e",
  "src/lib/watch/outcome.ts":
    "fdad185119978866d6bec772091e2d6d0d0af49a5207a7bae061d2d840453c90",
  "src/lib/market/xau-spot.ts":
    "393d01945077190a7745ad7cabc3b87bfb170f55fad82a4189a5ee661c678068",
};

export function inspectV1Sha(): "intacta" | "error" | typeof LAB_UNAVAILABLE {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    for (const [rel, expected] of Object.entries(V1_SHA256)) {
      const actual = createHash("sha256").update(readFileSync(join(root, rel))).digest("hex");
      if (actual !== expected) return "error";
    }
    return "intacta";
  } catch {
    return LAB_UNAVAILABLE;
  }
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
