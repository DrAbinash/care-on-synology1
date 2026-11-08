/**
 * Qwen3-VL-Plus cloud vision provider integration tests.
 *
 * Validates:
 * - Model capability registration (vision support)
 * - Pricing and cost estimation
 * - Provider routing and model validation
 * - Privacy controls (cloud vision requires explicit consent)
 * - Fallback behavior (Ollama remains default)
 */
import { describe, expect, it } from "vitest";
import {
  lookupBuiltinCapability,
  modelSupportsVision,
  assertVisionCapable,
  listBuiltinModels,
  defaultModelForProvider,
  estimateUsageCostUsd,
  listModelPricing,
  validateProviderModel,
  BUILTIN_PROVIDER_CONFIGS,
  OPERATOR_SUPPLIED_IMAGE_SOURCE,
} from "@workspace/ai-providers";
import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { DEFAULT_COMPOSER_PROVIDER } from "./resolveComposerProvider";

describe("Qwen3-VL-Plus model capability", () => {
  it("is registered with vision support", () => {
    const cap = lookupBuiltinCapability("qwen", "qwen3-vl-plus");
    expect(cap).not.toBeNull();
    expect(cap?.supportsVision).toBe(true);
    expect(cap?.isLocal).toBe(false);
    expect(cap?.provider).toBe("qwen");
    expect(cap?.model).toBe("qwen3-vl-plus");
  });

  it("modelSupportsVision returns true for qwen3-vl-plus", () => {
    expect(modelSupportsVision("qwen", "qwen3-vl-plus")).toBe(true);
  });

  it("assertVisionCapable succeeds for qwen3-vl-plus", () => {
    const result = assertVisionCapable("qwen", "qwen3-vl-plus");
    expect(result.ok).toBe(true);
  });

  it("is listed in qwen provider models", () => {
    const qwenModels = listBuiltinModels({ provider: "qwen" });
    const vlPlus = qwenModels.find((m) => m.model === "qwen3-vl-plus");
    expect(vlPlus).toBeDefined();
    expect(vlPlus?.supportsVision).toBe(true);
  });

  it("is NOT the default vision model for qwen (qwen3.7-plus comes first)", () => {
    const defaultVision = defaultModelForProvider("qwen", true);
    expect(defaultVision).toBe("qwen3.7-plus");
  });
});

describe("Qwen3-VL-Plus pricing", () => {
  it("has a pricing row", () => {
    const pricing = listModelPricing();
    const row = pricing.find(
      (r) => r.provider === "qwen" && r.model === "qwen3-vl-plus",
    );
    expect(row).toBeDefined();
    expect(row?.inputPerMillionUsd).toBeGreaterThan(0);
    expect(row?.outputPerMillionUsd).toBeGreaterThan(0);
  });

  it("estimates cost for typical MRI film-page usage (4 images, ~2000 tokens)", () => {
    const cost = estimateUsageCostUsd({
      provider: "qwen",
      model: "qwen3-vl-plus",
      promptTokens: 2000,
      completionTokens: 500,
    });
    expect(cost).not.toBeNull();
    expect(cost).toBeGreaterThan(0);
    expect(cost!).toBeLessThan(0.01);
  });

  it("returns null for unknown model", () => {
    const cost = estimateUsageCostUsd({
      provider: "qwen",
      model: "unknown-model",
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(cost).toBeNull();
  });
});

describe("Qwen3-VL-Plus provider routing", () => {
  it("validates as a known qwen model", () => {
    const result = validateProviderModel("qwen", "qwen3-vl-plus");
    expect(result.ok).toBe(true);
  });

  it("is listed in BUILTIN_PROVIDER_CONFIGS.qwen.defaultModels", () => {
    const qwenConfig = BUILTIN_PROVIDER_CONFIGS.qwen;
    expect(qwenConfig).toBeDefined();
    expect(qwenConfig.defaultModels).toContain("qwen3-vl-plus");
  });

  it("matches the qwen model family pattern", () => {
    const pattern = /^(qwen|qwq)/i;
    expect(pattern.test("qwen3-vl-plus")).toBe(true);
  });
});

describe("Qwen3-VL-Plus privacy controls", () => {
  it("requires API key (fails closed without it)", () => {
    const result = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      cloudApiKeyConfigured: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.safeError).toBe("qwen_api_key_not_configured");
    }
  });

  it("allows text mode when API key is configured", () => {
    const result = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      cloudApiKeyConfigured: true,
    });

    expect(result.ok).toBe(true);
  });

  it("vision mode requires cloudVisionAllowed flag", () => {
    const resultNoFlag = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: false,
      cloudApiKeyConfigured: true,
    });

    expect(resultNoFlag.ok).toBe(false);
    if (!resultNoFlag.ok) {
      expect(resultNoFlag.safeError).toBe("cloud_vision_not_allowed");
    }
  });

  it("vision mode with cloudVisionAllowed requires attestation for patient-derived images", () => {
    const resultNoAttestation = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE"],
    });

    expect(resultNoAttestation.ok).toBe(false);
    if (!resultNoAttestation.ok) {
      expect(resultNoAttestation.safeError).toBe("cloud_image_sources_not_attested");
    }
  });

  it("vision mode passes with cloudVisionAllowed + operator-supplied images (Development mode)", () => {
    const resultDevMode = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: [
        OPERATOR_SUPPLIED_IMAGE_SOURCE,
        OPERATOR_SUPPLIED_IMAGE_SOURCE,
        OPERATOR_SUPPLIED_IMAGE_SOURCE,
        OPERATOR_SUPPLIED_IMAGE_SOURCE,
      ],
      requireAttestation: false,
    });

    expect(resultDevMode.ok).toBe(true);
  });

  it("vision mode passes with cloudVisionAllowed + clinician attestation (Production mode)", () => {
    const resultProdMode = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE"],
      consentAttestedPerRequest: true,
      requireAttestation: true,
    });

    expect(resultProdMode.ok).toBe(true);
  });

  it("rejects vision mode with zero images", () => {
    const result = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 0,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.safeError).toBe("selected_images_empty");
    }
  });

  it("rejects when image source provenance is unverified (empty sources)", () => {
    const result = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: [],
      requireAttestation: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.safeError).toBe("cloud_image_provenance_unverified");
    }
  });
});

describe("Ollama remains default (Qwen3-VL-Plus is optional)", () => {
  it("default composer provider is ollama, not qwen", () => {
    expect(DEFAULT_COMPOSER_PROVIDER).toBe("ollama");
  });

  it("ollama has vision models available", () => {
    const ollamaVision = defaultModelForProvider("ollama", true);
    expect(ollamaVision).not.toBeNull();
    expect(ollamaVision).toBe("qwen3-vl:8b");
  });
});
