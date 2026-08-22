import { describe, it, expect } from "vitest";
import {
  buildAiReportingDraftDiagnostics,
  buildParserMeta,
  newAiRequestId,
} from "./aiReportingRequestDiagnostics";

describe("aiReportingRequestDiagnostics", () => {
  it("newAiRequestId returns a uuid-like string", () => {
    const id = newAiRequestId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("buildParserMeta detects FINDINGS/IMPRESSION sections", () => {
    const text = "FINDINGS:\nNormal brain.\n\nIMPRESSION:\nNo acute infarct.";
    const p = buildParserMeta(text, "Normal brain.", "No acute infarct.");
    expect(p.parserSuccess).toBe(true);
    expect(p.hasFindingsSection).toBe(true);
    expect(p.hasImpressionSection).toBe(true);
  });

  it("buildAiReportingDraftDiagnostics is PHI-safe and explains 502 cause fields", () => {
    const diag = buildAiReportingDraftDiagnostics({
      requestId: "req-1",
      worklistId: 42,
      providerName: "ollama",
      model: "qwen3-vl:8b",
      promptLength: 1200,
      startedAt: new Date().toISOString(),
      imageMeta: {
        seriesSelected: 3,
        imagesSelected: 3,
        imageByteSizes: [15001, 16000, 14000],
        totalImageBytes: 45001,
        fetchElapsedMs: 800,
      },
      aiResult: {
        text: "",
        success: false,
        error: "Ollama /api/chat timed out after 30000ms",
        diagnostics: {
          provider: "ollama",
          resolvedEndpoint: "http://172.16.1.140:11434",
          model: "qwen3-vl:8b",
          numberOfImages: 3,
          totalImageBytes: 45001,
          promptLength: 1200,
          startedAt: new Date().toISOString(),
          elapsedMs: 30163,
          httpStatus: null,
          responseLength: 0,
          finishReason: null,
          errorClass: "AbortError",
          errorCode: "TIMEOUT_OR_ABORT",
          errorMessage: "Ollama /api/chat timed out after 30000ms",
          timeoutStage: "provider_http",
          timeoutMsConfigured: null,
        },
      },
      parser: null,
      clinicOllamaTimeoutSeconds: 30,
      totalElapsedMs: 31000,
    });

    expect(diag.success).toBe(false);
    expect(diag.providerReturned).toBe(false);
    expect(diag.resolvedEndpoint).toBe("http://172.16.1.140:11434");
    expect(diag.model).toBe("qwen3-vl:8b");
    expect(diag.numberOfImages).toBe(3);
    expect(diag.imageByteSizes).toEqual([15001, 16000, 14000]);
    expect(diag.errorClass).toBe("AbortError");
    expect(diag.errorCode).toBe("TIMEOUT_OR_ABORT");
    expect(diag.timeoutStage).toBe("provider_http");
    expect(diag.timeoutMsConfigured).toBeNull();
    expect(diag.clinicOllamaTimeoutSeconds).toBe(30);
    expect(diag.timeoutSourcesNote).toContain("num_ctx must be explicit");
    expect(diag.timeoutSourcesNote).toContain("CONTEXT_BUDGET_EXCEEDED");
    expect(JSON.stringify(diag)).not.toMatch(/base64|FINDINGS:|data:image/i);
  });
});
