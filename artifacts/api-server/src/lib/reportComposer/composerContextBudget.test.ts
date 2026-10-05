/**
 * Selected-image Composer context budget — reuses the existing estimator, so
 * these tests pin the ARITHMETIC the radiologist's 3-4 screenshots depend on.
 *
 * The clinic default is num_ctx 4096. CARE's own measured cost is 1076 tokens
 * per key image, so 4 images alone exceed the default window.
 */
import { describe, it, expect } from "vitest";
import {
  COMPOSER_OUTPUT_RESERVE_TOKENS,
  composerPromptTextTokens,
  planComposerVisionContext,
} from "./composerContextBudget";
import {
  EMPIRICAL_TOKENS_PER_VISION_IMAGE,
  PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX,
} from "../ai/contextBudget";

const SYSTEM = "x".repeat(2_000);
const USER = "y".repeat(6_000);

function plan(imageCount: number, configuredNumCtx = 4096) {
  return planComposerVisionContext({ imageCount, systemPrompt: SYSTEM, userPrompt: USER, configuredNumCtx });
}

describe("planComposerVisionContext — 1 to 4 selected key images", () => {
  it("1 image fits the configured 4096 and does not raise it", () => {
    const p = plan(1);
    expect(p.fits).toBe(true);
    expect(p.requiredTokens).toBeLessThanOrEqual(4096);
    expect(p.numCtx).toBe(4096);
    expect(p.estimatedTokens).toBeGreaterThanOrEqual(EMPIRICAL_TOKENS_PER_VISION_IMAGE);
  });

  it("2 images exceed the 4096 default and are raised, not truncated", () => {
    const p = plan(2);
    expect(p.fits).toBe(true);
    expect(p.requiredTokens).toBeGreaterThan(4096);
    expect(p.numCtx).toBe(p.requiredTokens);
    expect(p.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });

  it("3 images raise num_ctx above the 4096 default, inside the ceiling", () => {
    const p = plan(3);
    expect(p.fits).toBe(true);
    expect(p.numCtx).toBeGreaterThan(4096);
    expect(p.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    expect(p.numCtx).toBe(p.requiredTokens);
  });

  it("4 images are the ceiling case and still fit at 8192", () => {
    const p = plan(4);
    expect(p.fits).toBe(true);
    expect(p.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    // The pre-fix default could not hold four images at all.
    expect(p.requiredTokens).toBeGreaterThan(4096);
  });

  it("each additional image costs exactly the existing empirical per-image tokens", () => {
    const one = plan(1).estimatedTokens;
    const four = plan(4).estimatedTokens;
    expect(four - one).toBe(3 * EMPIRICAL_TOKENS_PER_VISION_IMAGE);
  });
});

describe("planComposerVisionContext — never silently truncates clinical input", () => {
  it("fails clearly when images + prompt cannot fit even at the ceiling", () => {
    const hugePrompt = "z".repeat(40_000);
    const p = planComposerVisionContext({
      imageCount: 4,
      systemPrompt: hugePrompt,
      userPrompt: hugePrompt,
      configuredNumCtx: 4096,
    });
    expect(p.fits).toBe(false);
    expect(p.numCtx).toBeLessThanOrEqual(p.ceilingNumCtx);
    expect(p.reason).toMatch(/fewer key images/i);
    // The setting is clamped by resolveComposerRuntime, so telling someone to
    // raise it past the ceiling would be advice that cannot work.
    expect(p.reason).toMatch(/ollama_composer_num_ctx cannot help/i);
    expect(p.reason).toMatch(/clamps it to 8192/i);
    expect(p.maxImagesAtCeiling).toBeLessThan(4);
  });

  it("tells the radiologist how many images DO fit for this report", () => {
    const hugePrompt = "q".repeat(60_000);
    const p = planComposerVisionContext({
      imageCount: 4,
      systemPrompt: "",
      userPrompt: hugePrompt,
      configuredNumCtx: 4096,
    });
    if (!p.fits) {
      expect(p.maxImagesAtCeiling).toBeGreaterThanOrEqual(1);
      expect(p.maxImagesAtCeiling).toBeLessThan(p.requiredTokens / EMPIRICAL_TOKENS_PER_VISION_IMAGE);
    }
    expect(p.fits).toBe(false);
  });

  it("does not invent a context window above the ceiling the composer clamp allows", () => {
    const p = planComposerVisionContext({
      imageCount: 4,
      systemPrompt: "s".repeat(100_000),
      userPrompt: "u".repeat(100_000),
      configuredNumCtx: 2048,
    });
    expect(p.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });
});

describe("planComposerVisionContext — respects the admin's configured value", () => {
  it("never lowers a configured num_ctx that already fits", () => {
    const p = plan(2, 8192);
    expect(p.configuredNumCtx).toBe(8192);
    expect(p.numCtx).toBe(8192);
    expect(p.fits).toBe(true);
  });

  it("a configured value at the ceiling is used verbatim", () => {
    const p = plan(4, PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    expect(p.numCtx).toBe(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    expect(p.ceilingNumCtx).toBe(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });

  it("treats a below-minimum configured value as the 2048 floor, not zero", () => {
    const p = planComposerVisionContext({
      imageCount: 1,
      systemPrompt: "",
      userPrompt: "",
      configuredNumCtx: 512,
    });
    expect(p.configuredNumCtx).toBe(2048);
    expect(p.numCtx).toBeGreaterThanOrEqual(2048);
  });

  it("keeps the output reserve separate from the read budget", () => {
    const p = plan(1);
    expect(p.requiredTokens).toBe(p.estimatedTokens + COMPOSER_OUTPUT_RESERVE_TOKENS);
  });
});

describe("composerPromptTextTokens", () => {
  it("counts both prompts at the existing chars/4 convention", () => {
    expect(composerPromptTextTokens("a".repeat(400), "b".repeat(600))).toBe(250);
  });

  it("tolerates empty prompts", () => {
    expect(composerPromptTextTokens("", "")).toBe(0);
  });
});
