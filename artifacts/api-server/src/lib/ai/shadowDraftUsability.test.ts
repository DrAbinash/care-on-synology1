import { describe, expect, it } from "vitest";
import {
  classifyShadowDraftUsability,
  buildWorklistAiDraftPointer,
  hasUsableClinicalDraft,
} from "./shadowDraftUsability";

describe("classifyShadowDraftUsability", () => {
  it("marks READY when grounded findings exist", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [{ text: "Normal parenchyma" }],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 1,
    });
    expect(u.clinicalStatus).toBe("READY");
    expect(u.usable).toBe(true);
  });

  it("marks READY when impression alone is usable (normal study)", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: ["No significant intracranial abnormality detected on the supplied images."],
      candidateCount: 0,
    });
    expect(u.clinicalStatus).toBe("READY");
    expect(u.usable).toBe(true);
    expect(u.impressionCount).toBe(1);
  });

  it("marks EMPTY for gateway/model empty output — never READY", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 0,
      degraded: true,
      imageCount: 8,
    });
    expect(u.clinicalStatus).toBe("EMPTY");
    expect(u.emptyReason).toBe("degraded_empty");
    expect(u.usable).toBe(false);
  });

  it("marks QUARANTINED when all candidates are withheld", () => {
    const u = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [
        { reasons: ["ungrounded — no valid evidence anchor in the study snapshot"] },
        { reasons: ["ungrounded — no valid evidence anchor in the study snapshot"] },
      ],
      impression: [],
      candidateCount: 2,
    });
    expect(u.clinicalStatus).toBe("QUARANTINED");
    expect(u.quarantinedCount).toBe(2);
    expect(u.quarantineReasonClasses[0]?.count).toBe(2);
  });

  it("buildWorklistAiDraftPointer carries clinicalStatus EMPTY for draftId-19 shape", () => {
    const usability = classifyShadowDraftUsability({
      acceptedFindings: [],
      quarantinedFindings: [],
      impression: [],
      candidateCount: 0,
      degraded: false,
    });
    const pointer = buildWorklistAiDraftPointer({
      draftId: 19,
      version: 1,
      source: "ai_shadow",
      findingsText: "",
      impression: [],
      usability,
      imageCount: 0,
      degraded: false,
    });
    expect(pointer.clinicalStatus).toBe("EMPTY");
    expect(pointer.findingCount).toBe(0);
    expect(hasUsableClinicalDraft({ findingsText: "", impression: [] })).toBe(false);
  });
});

describe("classifyShadowDraftUsability with a named provider failure", () => {
  const empty = {
    acceptedFindings: [],
    quarantinedFindings: [],
    impression: [],
    candidateCount: 0,
  };
  const GENERIC =
    "AI gateway degraded to an empty draft (provider/parse failure) — no usable findings or impression.";

  it("replaces the generic sentence with the budget cause", () => {
    const u = classifyShadowDraftUsability({
      ...empty,
      degraded: true,
      imageCount: 8,
      providerFailure: {
        code: "OUTPUT_BUDGET_EXHAUSTED",
        detail: "num_predict budget exhausted with empty content (eval=4096 num_predict=4096 thinkingLen=4090)",
      },
    });
    expect(u.clinicalStatus).toBe("EMPTY");
    expect(u.emptyReasonLabel).toMatch(/entire answer budget/);
    expect(u.emptyReasonLabel).not.toBe(GENERIC);
    expect(u.providerFailureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
  });

  it("distinguishes an empty answer from an unparseable one", () => {
    const emptyOut = classifyShadowDraftUsability({
      ...empty,
      degraded: true,
      providerFailure: { code: "EMPTY_MODEL_OUTPUT", detail: "provider returned HTTP success with empty model text" },
    });
    const parseFail = classifyShadowDraftUsability({
      ...empty,
      degraded: true,
      providerFailure: { code: "PARSE_FAILED", detail: "model output could not be parsed into usable draft sections" },
    });
    expect(emptyOut.emptyReasonLabel).toMatch(/no text at all/);
    expect(parseFail.emptyReasonLabel).toMatch(/could not be read as a structured draft/);
    expect(emptyOut.emptyReasonLabel).not.toBe(parseFail.emptyReasonLabel);
  });

  it("keeps the generic wording when the provider outcome is not one it can name", () => {
    const u = classifyShadowDraftUsability({
      ...empty,
      degraded: true,
      providerFailure: { code: "UNKNOWN", detail: "unknown provider failure" },
    });
    expect(u.emptyReasonLabel).toBe(GENERIC);
    // The code is still recorded for the technical block — a name we did not
    // understand is not the same as a name we never got.
    expect(u.providerFailureCode).toBe("UNKNOWN");
  });

  it("keeps the generic wording for rows written before failures were named", () => {
    const u = classifyShadowDraftUsability({ ...empty, degraded: true });
    expect(u.emptyReasonLabel).toBe(GENERIC);
    expect(u.providerFailureCode).toBeNull();
  });

  it("does not attribute a provider cause to a draft that had no images", () => {
    const u = classifyShadowDraftUsability({
      ...empty,
      degraded: false,
      imageCount: 0,
      providerFailure: { code: "EMPTY_MODEL_OUTPUT", detail: "should not be shown" },
    });
    expect(u.emptyReasonLabel).toMatch(/No images were available/);
  });

  it("buildWorklistAiDraftPointer persists the named cause without a schema change", () => {
    const usability = classifyShadowDraftUsability({
      ...empty,
      degraded: true,
      imageCount: 6,
      providerFailure: { code: "OUTPUT_BUDGET_EXHAUSTED", detail: "num_predict budget exhausted with empty content (eval=1024 num_predict=1024 thinkingLen=1020)" },
    });
    const pointer = buildWorklistAiDraftPointer({
      draftId: 44,
      version: 2,
      source: "ai_shadow_degraded",
      findingsText: "",
      impression: [],
      usability,
      imageCount: 6,
      degraded: true,
    });
    expect(pointer.providerFailureCode).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(pointer.providerFailureDetail).toContain("eval=1024");
    expect(pointer.emptyReasonLabel).toMatch(/entire answer budget/);
  });
});
