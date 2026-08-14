import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@workspace/ai-providers", () => ({
  requestStructuredReport: async () => ({ report: {}, degraded: true, provider: null, model: null, modelDigest: null, attempts: 0, detail: "mock" }),
}));

const { buildRadiologyDraftPrompt } = await import("./gatewayInferenceProvider");

describe("overnight MRI grounded prompt", () => {
  const prompt = buildRadiologyDraftPrompt({
    studyInstanceUid: "1.2.840.test",
    modality: "MR",
    images: [{ imageData: "x", seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1 }],
    imageAnchors: [{ seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1 }],
  });

  it("labels output as AI DRAFT only", () => {
    expect(prompt).toMatch(/AI DRAFT/i);
    expect(prompt).toMatch(/NEVER a final report/i);
  });

  it("forbids invented demographics, measurements, contrast, restriction, sequences, recommendations", () => {
    expect(prompt).toMatch(/Do NOT invent patient demographics/i);
    expect(prompt).toMatch(/Do NOT invent measurements/i);
    expect(prompt).toMatch(/Bright T1 alone is NOT proof of contrast/i);
    expect(prompt).toMatch(/DWI hyperintensity alone without ADC/i);
    expect(prompt).toMatch(/Do NOT invent sequence names/i);
    expect(prompt).toMatch(/Do NOT add generic recommendations/i);
    expect(prompt).toMatch(/AIIMS\/Apollo/i);
    expect(prompt).toMatch(/Do NOT expose chain-of-thought/i);
    expect(prompt).toMatch(/indeterminate\/not assessable/i);
    expect(prompt).toMatch(/LIMITED REVIEW/i);
  });

  it("keeps evidence-anchor requirement", () => {
    expect(prompt).toMatch(/evidence anchor/i);
    expect(prompt).toContain("1.2.s");
  });
});
