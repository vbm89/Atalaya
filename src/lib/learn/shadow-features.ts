import type { LearningCase } from "./case";

/**
 * Only fields known at the decision point. Outcome/post-mortem fields are
 * deliberately absent from this type so candidate generation cannot read them.
 */
export type ShadowCaseInput = Pick<
  LearningCase,
  | "episodeId"
  | "assetId"
  | "direction"
  | "kind"
  | "openedAtMs"
  | "openedState"
  | "currentState"
  | "bias4hLabel"
  | "qualityPhase"
  | "volumeRatio15"
  | "volumeAvailable15"
  | "volumeRatio4h"
  | "volumeAvailable4h"
  | "highImpact"
  | "underlyingClosed"
  | "dataStatus"
  | "zoneLow"
  | "zoneHigh"
  | "entry"
  | "sl"
  | "tp1"
  | "tp2"
  | "invalidation"
  | "riskReward"
  | "quality"
  | "slWide"
>;

export interface ShadowFeatureVector {
  assetId: ShadowCaseInput["assetId"];
  direction: ShadowCaseInput["direction"];
  kind: ShadowCaseInput["kind"];
  quality: ShadowCaseInput["quality"];
  plannedRr: number | null;
  highImpact: boolean | null;
  session: "00-08" | "08-16" | "16-24";
  volume15Ratio: number | null;
  volume15Available: boolean | null;
  volume4hRatio: number | null;
  volume4hAvailable: boolean | null;
  dataStatus: string | null;
  underlyingClosed: boolean | null;
  bias4h: string | null;
  setupState: ShadowCaseInput["currentState"];
  openedState: ShadowCaseInput["openedState"];
  qualityPhase: string | null;
  slWide: boolean | null;
  invalidation: number | null;
  zoneWidth: number;
  riskDistance: number | null;
  rewardDistance1: number | null;
  rewardDistance2: number | null;
  rewardRisk1: number | null;
  rewardRisk2: number | null;
}

function positiveFinite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function madridSession(ms: number): ShadowFeatureVector["session"] {
  const h = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ms)),
    10,
  );
  if (h < 8) return "00-08";
  if (h < 16) return "08-16";
  return "16-24";
}

function directionalDistance(
  direction: ShadowCaseInput["direction"],
  from: number,
  to: number,
): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const distance = direction === "buy" ? to - from : from - to;
  return distance > 0 ? distance : null;
}

/** Derives research features from decision-time fields only. */
export function toShadowFeatures(c: ShadowCaseInput): ShadowFeatureVector {
  const zoneWidth = positiveFinite(c.zoneHigh - c.zoneLow) ?? 0;
  const riskDistance = directionalDistance(c.direction, c.entry, c.sl);
  const rewardDistance1 = directionalDistance(c.direction, c.entry, c.tp1);
  const rewardDistance2 = c.tp2 == null ? null : directionalDistance(c.direction, c.entry, c.tp2);

  return {
    assetId: c.assetId,
    direction: c.direction,
    kind: c.kind,
    quality: c.quality,
    plannedRr: c.riskReward,
    highImpact: c.highImpact,
    session: madridSession(c.openedAtMs),
    volume15Ratio: c.volumeRatio15,
    volume15Available: c.volumeAvailable15,
    volume4hRatio: c.volumeRatio4h,
    volume4hAvailable: c.volumeAvailable4h,
    dataStatus: c.dataStatus,
    underlyingClosed: c.underlyingClosed,
    bias4h: c.bias4hLabel,
    setupState: c.currentState,
    openedState: c.openedState,
    qualityPhase: c.qualityPhase,
    slWide: c.slWide,
    invalidation: c.invalidation,
    zoneWidth,
    riskDistance,
    rewardDistance1,
    rewardDistance2,
    rewardRisk1:
      riskDistance != null && rewardDistance1 != null && riskDistance > 0
        ? rewardDistance1 / riskDistance
        : null,
    rewardRisk2:
      riskDistance != null && rewardDistance2 != null && riskDistance > 0
        ? rewardDistance2 / riskDistance
        : null,
  };
}
