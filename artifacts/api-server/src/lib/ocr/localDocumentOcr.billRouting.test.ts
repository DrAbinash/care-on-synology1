import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  generateAiForTask: vi.fn(),
  resolveTaskRoute: vi.fn(),
  resolveOllamaVisionForOcr: vi.fn(),
  getGeminiOcrApiKey: vi.fn(),
  configuredTimeoutSeconds: 30,
}));

vi.mock("@workspace/ai-providers", () => ({
  generateAiForTask: h.generateAiForTask,
  resolveTaskRoute: h.resolveTaskRoute,
}));

vi.mock("./ocrProviderResolver", () => ({
  resolveOllamaVisionForOcr: h.resolveOllamaVisionForOcr,
  getGeminiOcrApiKey: h.getGeminiOcrApiKey,
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  geminiOcrBill: vi.fn(),
  geminiOcrInvoice: vi.fn(),
  geminiParseBankStatement: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const select = vi.fn(() => ({
    from: () => ({
      orderBy: () => ({
        limit: () => Promise.resolve([{ seconds: h.configuredTimeoutSeconds }]),
      }),
    }),
  }));
  return { db: { select }, clinicSettingsTable: { ollamaTimeoutSeconds: "ollama_timeout_seconds", id: "id" } };
});

import { ocrBill } from "./localDocumentOcr";

const BILL_JSON = JSON.stringify({
  vendor: "Pikasa",
  date: "2026-10-01",
  amount: 14500,
  gstAmount: 0,
  category: "Medical Supplies",
  paymentMode: "upi",
  confidence: "high",
  confidencePercent: 92,
});

function optionsPassed() {
  return h.generateAiForTask.mock.calls[0][3] as Record<string, unknown>;
}

beforeEach(() => {
  h.generateAiForTask.mockReset();
  h.resolveTaskRoute.mockReset();
  h.getGeminiOcrApiKey.mockReset();
  h.configuredTimeoutSeconds = 30;
  h.resolveOllamaVisionForOcr.mockResolvedValue({ endpointUrl: "http://ollama:11434", model: "qwen3-vl:8b" });
  h.resolveTaskRoute.mockResolvedValue(null);
  h.getGeminiOcrApiKey.mockResolvedValue(null);
  h.generateAiForTask.mockResolvedValue({ success: true, text: BILL_JSON });
});

describe("bill OCR model routing", () => {
  it("uses the model pinned to the bill_ocr task instead of the global vision model", async () => {
    h.resolveTaskRoute.mockResolvedValue({ provider: "ollama", model: "gemma3:12b" });
    const res = await ocrBill("aGVsbG8=", "image/jpeg");
    expect(h.resolveTaskRoute).toHaveBeenCalledWith("bill_ocr");
    expect(optionsPassed().model).toBe("gemma3:12b");
    expect(res.ocrProvider).toBe("ollama");
    expect(res.confidencePercent).toBe(92);
  });

  it("ignores a task route that points at a cloud provider — a photographed bill stays local", async () => {
    h.resolveTaskRoute.mockResolvedValue({ provider: "gemini", model: "gemini-2.0-flash" });
    await ocrBill("aGVsbG8=", "image/jpeg");
    expect(optionsPassed().model).toBe("qwen3-vl:8b");
    expect(optionsPassed().provider).toBe("ollama");
  });

  it("keeps the global vision model when the task route has no model", async () => {
    h.resolveTaskRoute.mockResolvedValue({ provider: "ollama", model: "  " });
    await ocrBill("aGVsbG8=", "image/jpeg");
    expect(optionsPassed().model).toBe("qwen3-vl:8b");
  });
});

describe("bill OCR request timeout", () => {
  it("sends a timeout at all, and never below the vision floor", async () => {
    h.configuredTimeoutSeconds = 30;
    await ocrBill("aGVsbG8=", "image/jpeg");
    expect(optionsPassed().timeoutMs).toBe(90_000);
  });

  it("honours a configured timeout longer than the floor", async () => {
    h.configuredTimeoutSeconds = 180;
    await ocrBill("aGVsbG8=", "image/jpeg");
    expect(optionsPassed().timeoutMs).toBe(180_000);
  });

  it("caps a runaway configured timeout", async () => {
    h.configuredTimeoutSeconds = 10_000;
    await ocrBill("aGVsbG8=", "image/jpeg");
    expect(optionsPassed().timeoutMs).toBe(300_000);
  });
});

describe("bill OCR failure reporting", () => {
  it("names the empty-response failure instead of returning a bare 0%", async () => {
    h.generateAiForTask.mockResolvedValue({ success: true, text: "   " });
    const res = await ocrBill("aGVsbG8=", "image/jpeg");
    expect(res.confidencePercent).toBe(0);
    expect(res.tesseractFallbackSuggested).toBe(true);
    expect(res.failureReason).toContain("OLLAMA_EMPTY_RESPONSE");
  });

  it("reports a reply that is not JSON as unparseable with the reply tail", async () => {
    h.generateAiForTask.mockResolvedValue({ success: true, text: "The vendor is Pikasa and the total is 14500." });
    const res = await ocrBill("aGVsbG8=", "image/jpeg");
    expect(res.failureReason).toContain("BILL_JSON_UNPARSEABLE");
    expect(res.failureReason).toContain("14500.");
  });

  it("passes the engine error through when Ollama reports failure", async () => {
    h.generateAiForTask.mockResolvedValue({ success: false, error: "OLLAMA_UNREACHABLE: connect ECONNREFUSED" });
    const res = await ocrBill("aGVsbG8=", "image/jpeg");
    expect(res.ocrProvider).toBe("none");
    expect(res.failureReason).toContain("OLLAMA_UNREACHABLE");
  });

  it("truncates a long failure reason", async () => {
    h.generateAiForTask.mockResolvedValue({ success: false, error: "x".repeat(900) });
    const res = await ocrBill("aGVsbG8=", "image/jpeg");
    expect(res.failureReason).toHaveLength(300);
  });
});
