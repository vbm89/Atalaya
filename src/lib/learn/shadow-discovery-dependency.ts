/**
 * COMMON_4_STRICT / COMMON_4_CAUSAL classification (A4c).
 *
 * Detector remains on the real series. This module only *labels* already-detected
 * events. FIRST_ONESHOT still uses eventUsedBarsBeforeCommon — do not route it here.
 */
import type { Common4Window } from "./shadow-discovery-universe";
import type {
  DiscoveryCatalogUniverse,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoverySequence,
  DiscoveryWarmupReason,
} from "./shadow-discovery-types";

export interface DiscoveryDependency {
  geometryMinT: number | null;
  stateMinT: number | null;
  usesPreCommonGeometry: boolean;
  usesPreCommonState: boolean;
  warmupReason: DiscoveryWarmupReason[];
  inWindow: boolean;
  strict: boolean;
  causal: boolean;
}

function stateReasonFor(kind: DiscoveryEventKind): DiscoveryWarmupReason | null {
  if (kind === "displacement") return "atr_wilder";
  if (kind === "sweep_prior_high" || kind === "sweep_prior_low") return "last_swing";
  if (kind === "bos_up" || kind === "bos_down") return "last_swing";
  if (kind === "fvg_retested") return "last_fvg";
  return null;
}

function reasonsOf(args: {
  usesPreCommonGeometry: boolean;
  usesPreCommonState: boolean;
  kind: DiscoveryEventKind;
  extra?: DiscoveryWarmupReason[];
}): DiscoveryWarmupReason[] {
  const out: DiscoveryWarmupReason[] = [];
  if (args.usesPreCommonGeometry) out.push("geometry_prefix");
  if (args.usesPreCommonState) {
    const r = stateReasonFor(args.kind);
    if (r) out.push(r);
  }
  for (const x of args.extra ?? []) {
    if (!out.includes(x)) out.push(x);
  }
  return out.length ? out : ["none"];
}

export function classifyEventCommon4(
  event: DiscoveryEvent,
  common: Common4Window,
): DiscoveryDependency {
  const geometryMinT = event.geometryMinT;
  const stateMinT = event.stateMinT;
  if (!common.available || common.fromT == null || common.toT == null || event.tf !== common.tf) {
    return {
      geometryMinT,
      stateMinT,
      usesPreCommonGeometry: true,
      usesPreCommonState: stateMinT != null,
      warmupReason: ["geometry_prefix"],
      inWindow: false,
      strict: false,
      causal: false,
    };
  }
  const inWindow = event.openT >= common.fromT && event.openT <= common.toT;
  const usesPreCommonGeometry = geometryMinT < common.fromT;
  const usesPreCommonState = stateMinT != null && stateMinT < common.fromT;
  const warmupReason = reasonsOf({ usesPreCommonGeometry, usesPreCommonState, kind: event.kind });
  const causal = inWindow && !usesPreCommonGeometry;
  const strict = causal && !usesPreCommonState;
  return {
    geometryMinT,
    stateMinT,
    usesPreCommonGeometry,
    usesPreCommonState,
    warmupReason,
    inWindow,
    strict,
    causal,
  };
}

export function eventInCatalogUniverse(
  dep: DiscoveryDependency,
  universe: DiscoveryCatalogUniverse,
): boolean {
  if (universe === "COMMON_4_STRICT") return dep.strict;
  return dep.causal;
}

export function classifySequenceCommon4(
  seq: DiscoverySequence,
  windows: readonly Common4Window[],
): DiscoveryDependency {
  const legs = seq.legs.map((leg) => {
    const w = windows.find((c) => c.tf === leg.tf);
    if (!w) {
      return classifyEventCommon4(leg, {
        tf: leg.tf,
        available: false,
        fromT: null,
        toT: null,
        days: null,
        assets: [],
        limitingAssets: [],
        n: null,
        unlocksNextTf: false,
        inference: "INSUFFICIENT",
        exploreGrade: "EXPLORE",
      });
    }
    return classifyEventCommon4(leg, w);
  });
  const geometryMinT = legs.reduce<number | null>((m, d) => {
    if (d.geometryMinT == null) return m;
    return m == null ? d.geometryMinT : Math.min(m, d.geometryMinT);
  }, null);
  const stateMinT = legs.reduce<number | null>((m, d) => {
    if (d.stateMinT == null) return m;
    return m == null ? d.stateMinT : Math.min(m, d.stateMinT);
  }, null);
  const usesPreCommonGeometry = legs.some((d) => d.usesPreCommonGeometry || !d.inWindow);
  const usesPreCommonState = legs.some((d) => d.usesPreCommonState);
  const extra: DiscoveryWarmupReason[] = [];
  for (const d of legs) {
    for (const r of d.warmupReason) {
      if (r !== "none" && !extra.includes(r)) extra.push(r);
    }
  }
  if (seq.family === "HTF_CONTEXT_LTF_EVENT") {
    const htfDep = legs[0];
    if (htfDep?.usesPreCommonState && !extra.includes("htf_leg")) extra.push("htf_leg");
  }
  const warmupReason = extra.length ? extra : ["none"];
  const allIn = legs.every((d) => d.inWindow);
  const causal = allIn && !usesPreCommonGeometry && legs.every((d) => d.causal);
  const strict = causal && !usesPreCommonState && legs.every((d) => d.strict);
  return {
    geometryMinT,
    stateMinT,
    usesPreCommonGeometry,
    usesPreCommonState,
    warmupReason,
    inWindow: allIn,
    strict,
    causal,
  };
}

export function filterEventsForUniverse(
  events: readonly DiscoveryEvent[],
  windows: readonly Common4Window[],
  universe: DiscoveryCatalogUniverse,
): DiscoveryEvent[] {
  return events.filter((e) => {
    const w = windows.find((c) => c.tf === e.tf);
    if (!w) return false;
    return eventInCatalogUniverse(classifyEventCommon4(e, w), universe);
  });
}

export function filterSequencesForUniverse(
  sequences: readonly DiscoverySequence[],
  windows: readonly Common4Window[],
  universe: DiscoveryCatalogUniverse,
): DiscoverySequence[] {
  return sequences.filter((s) => eventInCatalogUniverse(classifySequenceCommon4(s, windows), universe));
}
