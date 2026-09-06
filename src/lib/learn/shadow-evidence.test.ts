import { describe, expect, it } from "vitest";
import { classifyShadowEvidence } from "./shadow-evidence";

describe("classifyShadowEvidence", () => {
  it("does not allow a small TEST sample", () => {
    expect(classifyShadowEvidence({ cases: 100, extraTestN: 29, hasTrainTestSplit: true, predefined: true, contaminationFree: true }).status).toBe("INSUFFICIENT");
  });

  it("marks incomplete methodology exploratory", () => {
    expect(classifyShadowEvidence({ cases: 100, extraTestN: 30, hasTrainTestSplit: true, predefined: false, contaminationFree: true }).status).toBe("EXPLORATORY");
  });

  it("requires all gates before confirmatory", () => {
    expect(classifyShadowEvidence({ cases: 100, extraTestN: 30, hasTrainTestSplit: true, predefined: true, contaminationFree: true }).status).toBe("CONFIRMATORY");
  });
});
