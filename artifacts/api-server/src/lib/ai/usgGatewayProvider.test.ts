import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the canonical AI provider layer — no real model / DB.
const generateAiForTask = vi.fn();
const resolveTaskRoute = vi.fn();
const loadProviderConfigs = vi.fn();
vi.mock("@workspace/ai-providers", () => ({
  generateAiForTask: (...a: unknown[]) => generateAiForTask(...a),
  resolveTaskRoute: (...a: unknown[]) => resolveTaskRoute(...a),
  loadProviderConfigs: (...a: unknown[]) => loadProviderConfigs(...a),
}));
vi.mock("../logger", () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));

import {
  usgGatewayProvider, buildUsgPrompt, extractJson, coerceSuggestions, USG_AI_TASK_KEY,
} from "./usgGatewayProvider";

beforeEach(() => { generateAiForTask.mockReset(); resolveTaskRoute.mockReset(); loadProviderConfigs.mockReset(); });

describe("usgGatewayProvider — availability reflects real config", () => {
  it("is available when the USG task is routed", async () => {
    resolveTaskRoute.mockResolvedValue({ provider: "ollama", model: "qwen3:14b" });
    expect(await usgGatewayProvider.available()).toBe(true);
    expect(resolveTaskRoute).toHaveBeenCalledWith(USG_AI_TASK_KEY);
  });

  it("is available when any provider is enabled (default fallback)", async () => {
    resolveTaskRoute.mockResolvedValue(null);
    loadProviderConfigs.mockResolvedValue([{ provider: "ollama", isEnabled: true }, { provider: "openai", isEnabled: false }]);
    expect(await usgGatewayProvider.available()).toBe(true);
  });

  it("is NOT available when nothing is routed or enabled", async () => {
    resolveTaskRoute.mockResolvedValue(null);
    loadProviderConfigs.mockResolvedValue([{ provider: "ollama", isEnabled: false }]);
    expect(await usgGatewayProvider.available()).toBe(false);
  });

  it("degrades to unavailable (never throws) on a config error", async () => {
    resolveTaskRoute.mockRejectedValue(new Error("db down"));
    expect(await usgGatewayProvider.available()).toBe(false);
  });
});

describe("usgGatewayProvider — generation via the canonical task", () => {
  it("calls the USG task and coerces the JSON array into raw suggestions", async () => {
    generateAiForTask.mockResolvedValue({ success: true, text: '[{"kind":"impression","text":"Normal study.","rationale":"no abnormal findings","confidence":0.7}]' });
    const out = await usgGatewayProvider.generate({ measurements: [] });
    expect(generateAiForTask).toHaveBeenCalledWith(USG_AI_TASK_KEY, expect.any(String), [], { maxTokens: 1200 });
    expect(out).toEqual([{ kind: "impression", section: null, text: "Normal study.", rationale: "no abnormal findings", confidence: 0.7 }]);
  });

  it("returns [] when the provider call fails", async () => {
    generateAiForTask.mockResolvedValue({ success: false, error: "Provider ollama is not configured." });
    expect(await usgGatewayProvider.generate({})).toEqual([]);
  });

  it("returns [] (never throws) when generation throws", async () => {
    generateAiForTask.mockRejectedValue(new Error("timeout"));
    expect(await usgGatewayProvider.generate({})).toEqual([]);
  });
});

describe("extractJson — tolerant parsing of model output", () => {
  it("strips <think> blocks and code fences", () => {
    const text = '<think>reasoning here</think>\n```json\n[{"kind":"finding","text":"x","rationale":"y","confidence":0.5}]\n```';
    expect(extractJson(text)).toEqual([{ kind: "finding", text: "x", rationale: "y", confidence: 0.5 }]);
  });
  it("returns null for non-JSON prose", () => {
    expect(extractJson("I cannot help with that.")).toBeNull();
  });
  it("accepts an object with a suggestions array", () => {
    expect(extractJson('{"suggestions":[{"kind":"finding","text":"a","rationale":"b","confidence":0.9}]}')).toMatchObject({ suggestions: [{ text: "a" }] });
  });
});

describe("coerceSuggestions — defensive coercion", () => {
  it("drops empty-text entries, clamps confidence, defaults kind", () => {
    const out = coerceSuggestions([
      { kind: "weird", text: "keep", rationale: "r", confidence: 5 },
      { kind: "finding", text: "   ", rationale: "r", confidence: 0.5 },
      { text: "no kind", rationale: "r" },
    ]);
    expect(out).toEqual([
      { kind: "finding", section: null, text: "keep", rationale: "r", confidence: 1 },
      { kind: "finding", section: null, text: "no kind", rationale: "r", confidence: 0.5 },
    ]);
  });
  it("reads a suggestions-wrapped object", () => {
    expect(coerceSuggestions({ suggestions: [{ kind: "impression", text: "t", rationale: "", confidence: 0.3 }] })).toHaveLength(1);
  });
});

describe("buildUsgPrompt", () => {
  it("embeds the context and forbids fetal-sex output", () => {
    const p = buildUsgPrompt({ ac: 200 });
    expect(p).toContain('{"ac":200}');
    expect(p.toLowerCase()).toContain("never state or imply fetal sex");
  });
});
