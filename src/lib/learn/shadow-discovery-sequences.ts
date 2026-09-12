import { DISCOVERY_SEQUENCE_MAX_GAP_BARS, DISCOVERY_STEP_SEC, type DiscoveryBar, type DiscoveryEvent, type DiscoverySequence, type DiscoverySequenceFamily } from "./shadow-discovery-types";
import { barCloseOf } from "./shadow-discovery-clock";
import { mtfLegsInValidWindows, type Common4Window, type TimeWindow } from "./shadow-discovery-universe";

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

const HTF_CONTEXT_PAIRS = [
  { htfKind: "bos_down" as const, ltfKind: "sweep_prior_high" as const },
  { htfKind: "bos_up" as const, ltfKind: "sweep_prior_low" as const },
];

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
 * Same-TF grammar only. HTF_CONTEXT_LTF_EVENT is NOT matched here —
 * it must go through detectHtfContextSequences → mtfLegsInValidWindows.
 */
export function detectSequences(
  events: readonly DiscoveryEvent[],
  maxGap = DISCOVERY_SEQUENCE_MAX_GAP_BARS,
): DiscoverySequence[] {
  const ordered = [...events].sort((a, b) => a.closeT - b.closeT || a.id.localeCompare(b.id));
  const out: DiscoverySequence[] = [];
  for (const family of Object.keys(GRAMMAR) as DiscoverySequenceFamily[]) {
    if (family === "HTF_CONTEXT_LTF_EVENT") continue;
    for (const kinds of GRAMMAR[family]) {
      for (const legs of matchChain(ordered, kinds, maxGap)) {
        if (legs.some((l) => l.tf !== legs[0]!.tf)) continue;
        const last = legs[legs.length - 1]!;
        out.push({ family, assetId: last.assetId, legs, decisionCloseT: last.closeT });
      }
    }
  }
  return out;
}

function seriesTf(bars: readonly DiscoveryBar[]): DiscoveryBar["tf"] | null {
  const tf = bars[0]?.tf ?? null;
  if (!tf) return null;
  return bars.every((b) => b.tf === tf) ? tf : null;
}

/**
 * MTF sequences: LTF decision in its COMMON_4, HTF context only from
 * bars admitted by mtfLegsInValidWindows (both windows, close <= decision).
 * No closeT-only pairing. No htfContextBars fallback.
 */
export function detectHtfContextSequences(args: {
  events: readonly DiscoveryEvent[];
  htfBars: readonly DiscoveryBar[];
  ltfBars: readonly DiscoveryBar[];
  htfWindow: TimeWindow | Common4Window | null;
  ltfWindow: TimeWindow | Common4Window | null;
}): DiscoverySequence[] {
  const htfTf = seriesTf(args.htfBars);
  const ltfTf = seriesTf(args.ltfBars);
  if (!htfTf || !ltfTf || htfTf === ltfTf) return [];
  const out: DiscoverySequence[] = [];
  for (const pair of HTF_CONTEXT_PAIRS) {
    const ltfs = args.events.filter((e) => e.kind === pair.ltfKind && e.tf === ltfTf);
    const htfs = args.events.filter((e) => e.kind === pair.htfKind && e.tf === htfTf);
    for (const ltf of ltfs) {
      const joined = mtfLegsInValidWindows({
        htf: args.htfBars.filter((b) => b.assetId === ltf.assetId && b.tf === htfTf),
        ltf: args.ltfBars.filter((b) => b.assetId === ltf.assetId && b.tf === ltfTf),
        htfWindow: args.htfWindow,
        ltfWindow: args.ltfWindow,
        decisionClose: ltf.closeT,
      });
      if (!joined.ltf.some((b) => b.t === ltf.openT && barCloseOf(b) === ltf.closeT)) continue;
      const allowedOpen = new Set(joined.htf.map((b) => b.t));
      const htfEv = htfs
        .filter((h) => h.assetId === ltf.assetId && allowedOpen.has(h.openT) && h.closeT <= ltf.closeT)
        .sort((a, b) => b.closeT - a.closeT)[0];
      if (!htfEv) continue;
      out.push({
        family: "HTF_CONTEXT_LTF_EVENT",
        assetId: ltf.assetId,
        legs: [htfEv, ltf],
        decisionCloseT: ltf.closeT,
      });
    }
  }
  return out;
}

export const DISCOVERY_SEQUENCE_GRAMMAR = GRAMMAR;
