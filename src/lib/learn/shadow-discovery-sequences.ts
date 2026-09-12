import { DISCOVERY_SEQUENCE_MAX_GAP_BARS, DISCOVERY_STEP_SEC, type DiscoveryEvent, type DiscoverySequence, type DiscoverySequenceFamily } from "./shadow-discovery-types";

const GRAMMAR: Record<DiscoverySequenceFamily, readonly string[][]> = {
  LEVEL_REACTION_CONFIRM: [
    ["swing_high", "sweep_prior_high", "displacement"],
    ["swing_low", "sweep_prior_low", "displacement"],
  ],
  BREAKOUT_RETEST_CONTINUE: [
    ["range_breakout", "reclaim", "displacement"],
  ],
  SWEEP_RECLAIM_DISPLACE: [
    ["sweep_prior_high", "reclaim", "displacement"],
    ["sweep_prior_low", "reclaim", "displacement"],
  ],
  HTF_CONTEXT_LTF_EVENT: [
    ["bos_down", "sweep_prior_high"],
    ["bos_up", "sweep_prior_low"],
  ],
};

function sameAsset(a: DiscoveryEvent, b: DiscoveryEvent): boolean {
  return a.assetId === b.assetId;
}

function withinGap(a: DiscoveryEvent, b: DiscoveryEvent, maxGap: number): boolean {
  if (b.closeT <= a.closeT) return false;
  const step = DISCOVERY_STEP_SEC[b.tf];
  const bars = (b.closeT - a.closeT) / step;
  return bars > 0 && bars <= maxGap;
}

function matchChain(events: readonly DiscoveryEvent[], kinds: readonly string[], maxGap: number): DiscoveryEvent[][] {
  const byKind = new Map<string, DiscoveryEvent[]>();
  for (const e of events) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const first = byKind.get(kinds[0]!) ?? [];
  const chains: DiscoveryEvent[][] = [];
  for (const seed of first) {
    const chain: DiscoveryEvent[] = [seed];
    let ok = true;
    for (let k = 1; k < kinds.length; k++) {
      const prev = chain[k - 1]!;
      const cands = (byKind.get(kinds[k]!) ?? []).filter(
        (e) => sameAsset(prev, e) && withinGap(prev, e, maxGap),
      );
      const next = cands[0];
      if (!next) {
        ok = false;
        break;
      }
      chain.push(next);
    }
    if (ok) chains.push(chain);
  }
  return chains;
}

/**
 * Controlled grammar only. No cartesian explosion of every event pair.
 * HTF_CONTEXT_LTF_EVENT allows mixed TF (4h then 15m) as long as time is causal.
 */
export function detectSequences(
  events: readonly DiscoveryEvent[],
  maxGap = DISCOVERY_SEQUENCE_MAX_GAP_BARS,
): DiscoverySequence[] {
  const ordered = [...events].sort((a, b) => a.closeT - b.closeT || a.id.localeCompare(b.id));
  const out: DiscoverySequence[] = [];
  for (const family of Object.keys(GRAMMAR) as DiscoverySequenceFamily[]) {
    for (const kinds of GRAMMAR[family]) {
      const mixedTf = family === "HTF_CONTEXT_LTF_EVENT";
      const pool = mixedTf ? ordered : ordered;
      for (const legs of matchChain(pool, kinds, mixedTf ? 32 : maxGap)) {
        if (!mixedTf && legs.some((l) => l.tf !== legs[0]!.tf)) continue;
        if (mixedTf && legs.length >= 2 && legs[0]!.tf === legs[1]!.tf) {
          // still valid on one TF; HTF variant prefers different TF when present
        }
        const last = legs[legs.length - 1]!;
        out.push({ family, assetId: last.assetId, legs, decisionCloseT: last.closeT });
      }
    }
  }
  return out;
}

export const DISCOVERY_SEQUENCE_GRAMMAR = GRAMMAR;
