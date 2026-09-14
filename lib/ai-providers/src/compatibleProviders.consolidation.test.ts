import { describe, expect, it } from "vitest";
import {
  assertCloudImageEgress,
  assertVisionCapable,
  COMPATIBLE_PROVIDER_DEFAULTS,
  isCompatibleProviderConfigured,
  listBuiltinModels,
  modelSupportsVision,
} from "./index";

describe("provider-neutral cloud consolidation", () => {
  it("registers deepseek and qwen builtins with verified endpoints", () => {
    expect(COMPATIBLE_PROVIDER_DEFAULTS.deepseek?.baseURL).toBe("https://api.deepseek.com");
    expect(COMPATIBLE_PROVIDER_DEFAULTS.qwen?.baseURL).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    );
    expect(COMPATIBLE_PROVIDER_DEFAULTS.qwen?.defaultModel).toBe("qwen3.7-plus");
  });

  it("lists vision-capable qwen3.7-plus and rejects text-only deepseek-v4-pro", () => {
    expect(modelSupportsVision("qwen", "qwen3.7-plus")).toBe(true);
    expect(assertVisionCapable("deepseek", "deepseek-v4-pro").ok).toBe(false);
    expect(assertVisionCapable("deepseek", "deepseek-v4-flash-vision-exp").ok).toBe(true);
    expect(listBuiltinModels({ provider: "ollama", vision: true }).some((m) => m.model === "qwen3-vl:8b")).toBe(
      true,
    );
  });

  it("denies cloud image egress by default for all cloud vendors equally", () => {
    for (const provider of ["qwen", "deepseek", "openai"]) {
      const r = assertCloudImageEgress({ provider, imageCount: 1, cloudVisionAllowed: false });
      expect(r.ok).toBe(false);
    }
  });

  it("reports cloud providers unconfigured without env keys", () => {
    const prev = {
      d: process.env.DEEPSEEK_API_KEY,
      q: process.env.QWEN_API_KEY,
      o: process.env.OPENAI_API_KEY,
    };
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(isCompatibleProviderConfigured("deepseek")).toBe(false);
    expect(isCompatibleProviderConfigured("qwen")).toBe(false);
    expect(isCompatibleProviderConfigured("openai")).toBe(false);
    if (prev.d !== undefined) process.env.DEEPSEEK_API_KEY = prev.d;
    if (prev.q !== undefined) process.env.QWEN_API_KEY = prev.q;
    if (prev.o !== undefined) process.env.OPENAI_API_KEY = prev.o;
  });
});
