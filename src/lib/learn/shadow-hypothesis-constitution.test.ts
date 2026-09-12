import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { K1_PARAMETERS, K1_REGISTERED_AT } from "./shadow-k1-failed-breakout.ts";
import { SHADOW_HYPOTHESIS_REGISTRY } from "./shadow-preregister.ts";
import {
  classifyHypothesisChange,
  HYPOTHESIS_CONSTITUTION,
  K1_IDENTITY_FINGERPRINT,
  requiresNewHypothesisVersion,
  type HypothesisChangeKind,
} from "./shadow-hypothesis-constitution.ts";

describe("hypothesis constitution", () => {
  it("treats geometry, parameters, universe, registeredAt, scanner and outcome as new versions", () => {
    const kinds: HypothesisChangeKind[] = [
      "geometry",
      "parameters",
      "universe",
      "registeredAt",
      "scannerIdentity",
      "outcomeRule",
    ];
    for (const kind of kinds) {
      assert.equal(requiresNewHypothesisVersion(kind), true, kind);
      assert.equal(classifyHypothesisChange(kind).newVersion, true, kind);
    }
  });

  it("does not treat SEAL, TRAIN display, tests or comments as a new version", () => {
    for (const kind of ["statusSeal", "reportCohortDisplay", "testsFixtures", "comments"] as const) {
      assert.equal(requiresNewHypothesisVersion(kind), false, kind);
      assert.equal(classifyHypothesisChange(kind).newVersion, false, kind);
    }
  });

  it("forbids unsealing and re-registering after a peek", () => {
    assert.equal(HYPOTHESIS_CONSTITUTION.cannotUnseal, true);
    assert.equal(HYPOTHESIS_CONSTITUTION.cannotReregisterAfterPeek, true);
    assert.equal(HYPOTHESIS_CONSTITUTION.registeredAtImmutable, true);
  });

  it("K1 v1 identity matches the frozen registry and scanner constants", () => {
    const k1 = SHADOW_HYPOTHESIS_REGISTRY[0]!;
    assert.equal(k1.id, K1_IDENTITY_FINGERPRINT.id);
    assert.equal(k1.version, 1);
    assert.equal(k1.status, "REGISTERED");
    assert.equal(k1.registeredAt, K1_IDENTITY_FINGERPRINT.registeredAt);
    assert.equal(K1_REGISTERED_AT, Math.floor(Date.parse(K1_IDENTITY_FINGERPRINT.registeredAt) / 1000));
    assert.equal(K1_PARAMETERS.timeframe, K1_IDENTITY_FINGERPRINT.timeframe);
    assert.equal(K1_PARAMETERS.rangeLookbackBars, K1_IDENTITY_FINGERPRINT.rangeLookbackBars);
    assert.equal(K1_PARAMETERS.maxFailureBars, K1_IDENTITY_FINGERPRINT.maxFailureBars);
    assert.equal(K1_PARAMETERS.tp1R, K1_IDENTITY_FINGERPRINT.tp1R);
    assert.equal(K1_PARAMETERS.tp2R, K1_IDENTITY_FINGERPRINT.tp2R);
  });
});
