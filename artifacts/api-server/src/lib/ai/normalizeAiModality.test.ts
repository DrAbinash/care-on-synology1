import { describe, it, expect } from "vitest";
import { normalizeAiModality } from "./modalityNormalize";

describe("normalizeAiModality", () => {
  it("collapses MRI family onto MR", () => {
    expect(normalizeAiModality("MRI")).toBe("MR");
    expect(normalizeAiModality("mr")).toBe("MR");
    expect(normalizeAiModality("MR ANGIO")).toBe("MR");
  });
  it("collapses X-ray family onto CR", () => {
    expect(normalizeAiModality("DX")).toBe("CR");
    expect(normalizeAiModality("XR")).toBe("CR");
    expect(normalizeAiModality("X-RAY")).toBe("CR");
  });
  it("collapses ultrasound / Doppler", () => {
    expect(normalizeAiModality("USG")).toBe("US");
    expect(normalizeAiModality("US")).toBe("US");
    expect(normalizeAiModality("Carotid Doppler")).toBe("Doppler");
  });
  it("keeps CT / MG", () => {
    expect(normalizeAiModality("CT")).toBe("CT");
    expect(normalizeAiModality("HRCT")).toBe("CT");
    expect(normalizeAiModality("MG")).toBe("MG");
  });
});
