import type { LearningCase } from "./case";
import { toShadowFeatures, type ShadowFeatureVector } from "./shadow-features";

/**
 * Research-only Shadow V2 candidate specification.
 *
 * This module deliberately does NOT evaluate candles or outcomes yet. It
 * provides the deterministic, outcome-blind candidate gates that the replay
 * layer can apply once tape data is wired in. V1 is never called or changed.
 */
export type ShadowCandidateReason =
  | "BASELINE_V1"
  | "VOLUME_RELAXED"
  | "TRIGGER_RELAXED"
  | "VOLUME_AND_TRIGGER_RELAXED";

export interface ShadowCandidate {
  episodeId: string;
  reason: ShadowCandidateReason;
  features: ShadowFeatureVector;
}

export interface ShadowReplayPlan {
  /** Candidate variants are hypotheses, not live signals. */
  variants: readonly ShadowCandidateReason[];
  outcomeBlind: true;
  liveSignal: false;
  modifiesV1: false;
}

export const SHADOW_REPLAY_PLAN: ShadowReplayPlan = {
  variants: [
    "BASELINE_V1",
    "VOLUME_RELAXED",
    "TRIGGER_RELAXED",
    "VOLUME_AND_TRIGGER_RELAXED",
  ],
  outcomeBlind: true,
  liveSignal: false,
  modifiesV1: false,
};

/**
 * Converts an existing frozen V1 case into a research candidate. The outcome
 * is intentionally never read here, preventing label leakage.
 */
export function baselineShadowCandidate(c: LearningCase): ShadowCandidate {
  return {
    episodeId: c.episodeId,
    reason: "BASELINE_V1",
    features: toShadowFeatures(c),
  };
}

/**
 * Returns the planned counterfactual variants for a case. These are only
 * labels for replay; no variant is considered better until historical tape
 * proves it with the predefined validation protocol.
 */
export function shadowVariants(c: LearningCase): ShadowCandidate[] {
  const features = toShadowFeatures(c);
  return SHADOW_REPLAY_PLAN.variants.map((reason) => ({
    episodeId: c.episodeId,
    reason,
    features,
  }));
}
