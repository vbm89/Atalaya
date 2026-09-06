import type { AssetAnalysis, SetupProposal, SetupState } from "../trading/types";
import type { FoldInput } from "./episode";
import { captureEntryGates, type EntryGates } from "./entry-gates";

/**
 * Photograph of what V1 knew at capture time.
 * Never rewritten from live market. Not an engine input.
 * New fields are optional so old rows stay readable (missing → undefined/null).
 */
export interface EpisodeFreeze {
  slotClosePrice: number | null;
  quality: string | null;
  riskReward: number | null;
  dataSource: string | null;
  feedSymbol: string | null;
  instrumentKind: string | null;
  basis: number | null;
  dataStatus: string | null;
  waitReason: string | null;
  highImpact: boolean;
  underlyingClosed: boolean;
  timeframe: "15m";
  setupKind: string | null;
  capturedAtMs: number;
  /** P5.2 — copied from V1 outputs. Absent on pre-P5.2 episodes. */
  bias4hLabel?: string | null;
  missingForEntry?: string | null;
  warnings?: string[] | null;
  qualityPhase?: "preliminar" | "final" | null;
  volumeRatio15?: number | null;
  volumeAvailable15?: boolean | null;
  volumeRatio4h?: number | null;
  volumeAvailable4h?: boolean | null;
  invalidation?: number | null;
  slWide?: boolean | null;
  setupState?: SetupState | null;
  direction?: "buy" | "sell" | null;
  /** Parsed from V1 setup.state + missingForEntry at capture. Absent on old rows. */
  entryGates?: EntryGates | null;
}

function tfVolume(a: AssetAnalysis, tf: "15m" | "4h"): {
  ratio: number | null;
  available: boolean | null;
} {
  const row = a.timeframes.find((t) => t.timeframe === tf);
  if (!row) return { ratio: null, available: null };
  return {
    ratio: row.indicators.volumeRatio,
    available: row.indicators.volumeAvailable,
  };
}

export function freezeFromAnalysis(a: AssetAnalysis, nowMs: number): EpisodeFreeze {
  const setup: SetupProposal | null = a.setup;
  const v15 = tfVolume(a, "15m");
  const v4h = tfVolume(a, "4h");
  return {
    slotClosePrice: a.price,
    quality: setup?.quality ?? null,
    riskReward: setup?.riskReward ?? null,
    dataSource: a.dataSource,
    feedSymbol: a.feedSymbol,
    instrumentKind: a.instrumentKind,
    basis: a.basis,
    dataStatus: a.dataStatus,
    waitReason: a.waitReason,
    highImpact: (setup?.warnings ?? []).some((w) => /impacto|calendario|noticia/i.test(w)),
    underlyingClosed: a.dataStatus === "session_closed",
    timeframe: "15m",
    setupKind: setup?.kind ?? null,
    capturedAtMs: nowMs,
    bias4hLabel: a.bias4hLabel ?? null,
    missingForEntry: setup?.missingForEntry ?? null,
    warnings: setup ? [...setup.warnings] : [],
    qualityPhase: setup?.qualityPhase ?? null,
    volumeRatio15: v15.ratio,
    volumeAvailable15: v15.available,
    volumeRatio4h: v4h.ratio,
    volumeAvailable4h: v4h.available,
    invalidation: setup?.invalidation ?? null,
    slWide: setup?.slWide ?? null,
    setupState: a.setupState,
    direction: setup?.direction ?? null,
    entryGates: captureEntryGates(a.setupState, setup?.missingForEntry ?? null) ?? null,
  };
}

/** Missing keys on old JSON stay null. Never filled from live market. */
export function freezeField<T>(value: T | null | undefined): T | null {
  return value === undefined ? null : value;
}

export function foldInputFromAnalysis(a: AssetAnalysis, nowMs: number): FoldInput {
  return {
    id: a.id,
    setupState: a.setupState,
    setup: a.setup,
    waitReason: a.waitReason,
    digits: a.digits,
    freeze: freezeFromAnalysis(a, nowMs),
  };
}
