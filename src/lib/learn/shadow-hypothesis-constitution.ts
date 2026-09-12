/**
 * Constitution: a change that can reinterpret data already inside a REGISTERED
 * hypothesis is not a fix — it is a new hypothesis version (new id, new k entry,
 * new registeredAt). K1 geometry stays frozen; this module does not import V1.
 */
export const HYPOTHESIS_CONSTITUTION = Object.freeze({
  geometryChangeRequiresNewId: true,
  parameterChangeRequiresNewId: true,
  universeChangeRequiresNewId: true,
  registeredAtImmutable: true,
  scannerIdentityChangeRequiresNewId: true,
  outcomeRuleChangeRequiresNewId: true,
  reportCohortDisplayIsNotNewVersion: true,
  testsFixturesAreNotNewVersion: true,
  sealingWhenProtocolPassesIsNotNewVersion: true,
  cannotUnseal: true,
  cannotReregisterAfterPeek: true,
});

export type HypothesisChangeKind =
  | "geometry"
  | "parameters"
  | "universe"
  | "registeredAt"
  | "scannerIdentity"
  | "outcomeRule"
  | "statusSeal"
  | "reportCohortDisplay"
  | "testsFixtures"
  | "comments";

const NEW_VERSION: ReadonlySet<HypothesisChangeKind> = new Set([
  "geometry",
  "parameters",
  "universe",
  "registeredAt",
  "scannerIdentity",
  "outcomeRule",
]);

export function requiresNewHypothesisVersion(kind: HypothesisChangeKind): boolean {
  return NEW_VERSION.has(kind);
}

export function classifyHypothesisChange(kind: HypothesisChangeKind): {
  newVersion: boolean;
  reason: string;
} {
  if (kind === "statusSeal") {
    return { newVersion: false, reason: "REGISTERED → SEALED es la apertura única de TEST, no una nueva hipótesis." };
  }
  if (kind === "reportCohortDisplay") {
    return { newVersion: false, reason: "Cambiar qué métricas públicas se muestran (TRAIN vs TEST oculto) no altera candidatos." };
  }
  if (kind === "testsFixtures" || kind === "comments") {
    return { newVersion: false, reason: "Tests o comentarios no reinterpretan datos REGISTERED." };
  }
  return {
    newVersion: true,
    reason: "Este cambio puede reinterpretar datos ya entrados en una hipótesis REGISTERED. Registrar una nueva versión.",
  };
}

export const K1_IDENTITY_FINGERPRINT = Object.freeze({
  id: "K1_FAILED_BREAKOUT_TRAP_15M",
  version: 1,
  timeframe: "15m",
  atrPeriodBars: 14,
  rangeLookbackBars: 16,
  breakoutCloseAtr: 0.1,
  maxFailureBars: 4,
  reclaimClose: "back_inside_prior_range",
  stopPlacement: "failed_extreme_plus_buffer",
  stopBufferAtr: 0.1,
  minRiskAtr: 0.25,
  maxRiskAtr: 2,
  tp1R: 2,
  tp2R: null,
  decision: "close_of_first_failure_reclaim",
  outcomeStarts: "next_closed_bar",
  registeredAt: "2026-09-12T06:30:00Z",
});
