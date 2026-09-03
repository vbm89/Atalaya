import type { LearningCase } from "./case";

/**
 * Research-only feature vector for the future Shadow V2 replay.
 *
 * IMPORTANT:
 * - Never imported by the live V1 watch path.
 * - Does not create, alter or promote signals.
 * - Candidate features are outcome-blind: outcome is deliberately excluded.
 * - V1 remains the source of truth for live signals.
 */
export interface ShadowFeatureVector {
  asset: LearningCase["asset"];
  direction: LearningCase["direction"];
  kind: LearningCase["kind"];
  quality: LearningCase["quality"];
  plannedRr: number | null;
  highImpact: boolean;
  session: LearningCase["session"];

  volume15Ratio: number | null;
  volume15Available: boolean | null;
  volume4hRatio: number | null;
  volume4hAvailable: boolean | null;

  dataStatus: string | null;
  underlyingClosed: boolean;
  bias4h: string | null;
  setupState: string | null;
  qualityPhase: string | null;
  slWide: boolean | null;

  /** Research geometry, normalized so buy/sell are comparable. */
  zoneWidth: number | null;
  riskDistance: number | null;
  rewardDistance1: number | null;
  rewardDistance2: number | null;
  rewardRisk1: number | null;
  rewardRisk2: number | null;
}

function positiveFinite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function directionalDistance(
  direction: LearningCase["direction"],
  from: number,
  to: number,
): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const distance = direction === "buy" ? to - from : from - to;
  return distance > 0 ? distance : null;
}

/**
 * Derives research features from the frozen V1 case only.
 * No outcome field is consulted when building the vector.
 */
export function toShadowFeatures(c: LearningCase): ShadowFeatureVector {
  const zoneWidth = positiveFinite(c.zoneHigh - c.zoneLow);
  const riskDistance = directionalDistance(c.direction, c.entry, c.sl);
  const rewardDistance1 = directionalDistance(c.direction, c.entry, c.tp1);
  const rewardDistance2 = c.tp2 == null ? null : directionalDistance(c.direction, c.entry, c.tp2);

  return {
    asset: c.asset,
    direction: c.direction,
    kind: c.kind,
    quality: c.quality,
    plannedRr: c.plannedRr,
    highImpact: c.highImpact,
    session: c.session,
    volume15Ratio: c.volume15Ratio,
    volume15Available: c.volume15Available,
    volume4hRatio: c.volume4hRatio,
    volume4hAvailable: c.volume4hAvailable,
    dataStatus: c.dataStatus,
    underlyingClosed: c.underlyingClosed,
    bias4h: c.bias4h,
    setupState: c.setupState,
    qualityPhase: c.qualityPhase,
    slWide: c.slWide,
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
