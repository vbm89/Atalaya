import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyShadowEvidence } from "./shadow-evidence.ts";

describe("classifyShadowEvidence", () => {
  it("does not allow a small TEST sample", () => {
    assert.equal(
      classifyShadowEvidence({ cases: 100, extraTestN: 29, hasTrainTestSplit: true, predefined: true, contaminationFree: true }).status,
      "INSUFFICIENT",
    );
  });

  it("marks incomplete methodology exploratory", () => {
    assert.equal(
      classifyShadowEvidence({ cases: 100, extraTestN: 30, hasTrainTestSplit: true, predefined: false, contaminationFree: true }).status,
      "EXPLORATORY",
    );
  });

  it("never marks evidence confirmatory before the promotion protocol", () => {
    assert.equal(
      classifyShadowEvidence({ cases: 100, extraTestN: 30, hasTrainTestSplit: true, predefined: true, contaminationFree: true }).status,
      "EXPLORATORY",
    );
  });
});
