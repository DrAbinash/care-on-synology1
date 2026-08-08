import { describe, it, expect, vi, beforeEach } from "vitest";
import { assessOcrQuality } from "./ocrQuality";
import { parseIdCardTextServer, idFieldsToOcrResult } from "./idCardTextFromOcr";

describe("ocrQuality", () => {
  it("flags low mean confidence", () => {
    const q = assessOcrQuality({
      meanConfidence: 0.5,
      lineConfidences: [0.4, 0.5, 0.6],
      text: "enough characters here for the check",
      lowConfidenceThreshold: 0.8,
    });
    expect(q.isLowQuality).toBe(true);
    expect(q.reasons.some((r) => r.includes("mean_confidence"))).toBe(true);
  });

  it("flags suspiciously small text", () => {
    const q = assessOcrQuality({
      meanConfidence: 0.95,
      lineConfidences: [0.95],
      text: "hi",
    });
    expect(q.isLowQuality).toBe(true);
    expect(q.reasons).toContain("suspiciously_small_text");
  });

  it("passes clean high-confidence OCR", () => {
    const q = assessOcrQuality({
      meanConfidence: 0.92,
      lineConfidences: [0.9, 0.91, 0.95],
      text: "GOVERNMENT OF INDIA\nName: Test\nAddress: Somewhere",
    });
    expect(q.isLowQuality).toBe(false);
  });
});

describe("idCardTextFromOcr", () => {
  it("extracts S/O name and aadhaar", () => {
    const text = [
      "GOVERNMENT OF INDIA",
      "Aadhaar",
      "Name: Ramesh Kumar",
      "S/O: Suresh Kumar",
      "DOB: 01/02/1980",
      "Gender: Male",
      "Address: Village Example, Dist Test, State XX 123456",
      "1234 5678 9012",
    ].join("\n");
    const f = parseIdCardTextServer(text);
    expect(f.guardianName.toLowerCase()).toContain("suresh");
    expect(f.documentType).toBe("Aadhaar");
    expect(f.idNumber.replace(/\s/g, "")).toBe("123456789012");
    const r = idFieldsToOcrResult(f, { ocrProvider: "paddle", meanConfidence: 0.9 });
    expect(r.ocrProvider).toBe("paddle");
    expect(r.confidencePercent).toBeGreaterThanOrEqual(85);
  });
});

describe("ocrOrchestrator paddle unreachable", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OCR_ENGINE = "paddle";
    process.env.OCR_WORKER_URL = "http://127.0.0.1:1";
  });

  it("suggests tesseract fallback when worker unreachable", async () => {
    const { resetAiPipelineConfigCache } = await import("../aiPipeline/config");
    resetAiPipelineConfigCache();
    const { orchestrateDocumentOcr } = await import("./ocrOrchestrator");
    const r = await orchestrateDocumentOcr({
      buffer: Buffer.from("not-an-image"),
      filename: "x.jpg",
      mimeType: "image/jpeg",
    });
    expect(r.ok).toBe(false);
    expect(r.tesseractFallbackSuggested).toBe(true);
    expect(r.pathUsed).toMatch(/unreachable|error/);
  });

  it("OCR_ENGINE=tesseract rollback never calls paddle", async () => {
    process.env.OCR_ENGINE = "tesseract";
    const { resetAiPipelineConfigCache } = await import("../aiPipeline/config");
    resetAiPipelineConfigCache();
    const { orchestrateDocumentOcr } = await import("./ocrOrchestrator");
    const r = await orchestrateDocumentOcr({ buffer: Buffer.from("x") });
    expect(r.pathUsed).toBe("rollback:tesseract");
    expect(r.tesseractFallbackSuggested).toBe(true);
  });
});
