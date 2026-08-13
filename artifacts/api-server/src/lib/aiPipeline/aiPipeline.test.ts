import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAiPipelineConfig,
  resetAiPipelineConfigCache,
} from "./config";
import { buildModelRegistry, isLikelyTooLargeForRtx3050, entryForMode } from "./modelRegistry";
import { routeAiModel } from "./modelRouter";
import { normalizeOcrText, parseDocumentFromOcr } from "./documentParser";
import { maskIdNumber, redactPhiSnippet, phiSafeOcrLog } from "./phiSafeLog";
import {
  validateDraftReport,
  parseJsonFromModel,
  lateralityPreserved,
  measurementsPreserved,
} from "./schemaValidation";

describe("aiPipeline config", () => {
  beforeEach(() => {
    resetAiPipelineConfigCache();
    delete process.env.OCR_ENGINE;
    delete process.env.AI_MODEL_FAST;
    delete process.env.AI_MODE;
  });

  it("defaults to paddle + gemma3:4b + AUTO + production OCR flags", () => {
    delete process.env.OCR_DEVICE;
    delete process.env.OCR_VISION_FALLBACK;
    delete process.env.OCR_PROFILE;
    delete process.env.AI_CONCURRENCY;
    delete process.env.AI_MODEL_STANDARD;
    const c = loadAiPipelineConfig(true);
    expect(c.ocrEngine).toBe("paddle");
    expect(c.ocrDevice).toBe("cpu");
    expect(c.ocrProfile).toBe("fast");
    expect(c.ocrRetryAccurate).toBe(true);
    expect(c.ocrTesseractFallback).toBe(true);
    expect(c.ocrVisionFallback).toBe(false);
    expect(c.modelFast).toBe("gemma3:4b");
    expect(c.modelStandard).toBe("gemma3:4b");
    expect(c.modelLarge).toBe("gemma3:12b");
    expect(c.modelVision).toBe("qwen3-vl:8b");
    expect(c.ollamaNumCtx).toBe(16384);
    expect(c.ollamaThink).toBe(false);
    expect(c.aiMode).toBe("AUTO");
    expect(c.aiConcurrency).toBe(1);
  });

  it("honors OCR_ENGINE=tesseract rollback", () => {
    process.env.OCR_ENGINE = "tesseract";
    const c = loadAiPipelineConfig(true);
    expect(c.ocrEngine).toBe("tesseract");
  });
});

describe("model registry", () => {
  beforeEach(() => resetAiPipelineConfigCache());

  it("lists fast/standard/large/vision", () => {
    const r = buildModelRegistry();
    expect(r.map((e) => e.id)).toEqual(["fast", "standard", "large", "vision"]);
    expect(entryForMode("DEEP")?.ollamaName).toBe("gemma3:12b");
    expect(entryForMode("OCR_ONLY")).toBeNull();
  });

  it("flags large models for RTX 3050", () => {
    expect(isLikelyTooLargeForRtx3050("gemma3:4b")).toBe(false);
    expect(isLikelyTooLargeForRtx3050("gemma3:12b")).toBe(true);
  });
});

describe("model router", () => {
  beforeEach(() => resetAiPipelineConfigCache());

  it("OCR_ONLY never calls LLM", () => {
    const d = routeAiModel({ mode: "OCR_ONLY", task: "ocr_only" });
    expect(d.useLlm).toBe(false);
    expect(d.sendImages).toBe(false);
    expect(d.model).toBeNull();
  });

  it("routine AUTO prefers gemma3:4b and does not send images", () => {
    const d = routeAiModel({
      mode: "AUTO",
      task: "demographic_extraction",
      ocrConfidence: 0.5, // low — must NOT escalate to 12B
      installedModels: ["gemma3:4b", "gemma3:12b"],
      ollamaReachable: true,
    });
    expect(d.useLlm).toBe(true);
    expect(d.model).toBe("gemma3:4b");
    expect(d.sendImages).toBe(false);
    expect(d.warnings.some((w) => w.includes("low_ocr_confidence"))).toBe(true);
  });

  it("DEEP selects 12B with VRAM warning", () => {
    const d = routeAiModel({
      mode: "DEEP",
      task: "radiology_draft",
      installedModels: ["gemma3:4b", "gemma3:12b"],
      ollamaReachable: true,
    });
    expect(d.model).toBe("gemma3:12b");
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("falls back when requested model missing", () => {
    const d = routeAiModel({
      mode: "DEEP",
      task: "radiology_draft",
      installedModels: ["gemma3:4b"],
      ollamaReachable: true,
    });
    expect(d.model).toBe("gemma3:4b");
    expect(d.warnings.some((w) => w.includes("fell_back"))).toBe(true);
  });

  it("preserves OCR when Ollama unavailable", () => {
    const d = routeAiModel({
      mode: "STANDARD",
      task: "radiology_draft",
      ollamaReachable: false,
    });
    expect(d.useLlm).toBe(false);
    expect(d.warnings).toContain("ollama_unavailable");
  });
});

describe("document parser", () => {
  it("normalizes whitespace and detects sections", () => {
    const raw = "Findings:\nLeft kidney 10 cm\n\n\nImpression:\nNormal study.";
    const n = normalizeOcrText(raw);
    expect(n).not.toMatch(/\n{3,}/);
    const p = parseDocumentFromOcr(raw);
    expect(p.sections.findings).toMatch(/Left kidney/);
    expect(p.sections.impression).toMatch(/Normal/);
    expect(p.lateralityMentions).toContain("left");
  });

  it("preserves page markers in multi-page text", () => {
    const p = parseDocumentFromOcr("--- page 1 ---\nFindings: A\n\n--- page 2 ---\nImpression: B");
    expect(p.normalizedText).toContain("page 1");
    expect(p.normalizedText).toContain("page 2");
  });
});

describe("schema + safety", () => {
  it("requires DRAFT status", () => {
    expect(validateDraftReport({ status: "FINAL", findings: "" }).ok).toBe(false);
    expect(validateDraftReport({ status: "DRAFT", findings: "x", impression: "", advice: "", warnings: [], uncertainty: [], evidenceNotes: [] }).ok).toBe(true);
  });

  it("parses fenced JSON", () => {
    const j = parseJsonFromModel('```json\n{"status":"DRAFT","findings":"ok"}\n```');
    expect((j as { status: string }).status).toBe("DRAFT");
  });

  it("checks laterality and measurements", () => {
    expect(lateralityPreserved("left lobe lesion", "Left lobe lesion noted")).toBe(true);
    expect(lateralityPreserved("left lobe lesion", "Hepatic lesion noted")).toBe(false);
    expect(measurementsPreserved([{ value: "10", unit: "cm" }], "measures 10 cm")).toBe(true);
  });

  it("redacts PHI in logs", () => {
    expect(maskIdNumber("1234 5678 9012")).toMatch(/\*\*\*\*9012$/);
    expect(redactPhiSnippet("Aadhaar 1234 5678 9012")).not.toContain("5678");
    const log = phiSafeOcrLog({ engine: "paddle", meanConfidence: 0.9, charCount: 100 });
    expect(log).not.toHaveProperty("text");
  });
});
