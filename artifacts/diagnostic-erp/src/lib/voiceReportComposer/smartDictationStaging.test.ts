/**
 * @vitest-environment node
 *
 * Hybrid Smart Dictation v1 — STAGING pure contracts.
 *
 * The hybrid split: words land on screen the moment they are dictated
 * (zero inference — the transcript is plain text), and the 14B model is
 * called ONCE per Compose press, not once per utterance. These are the
 * pure accumulation rules the staging buffer obeys.
 */
import { describe, expect, it } from "vitest";
import {
  appendStagedSegment,
  normalizeAutoComposeSeconds,
  stagedWordCount,
} from "./smartDictationSession";

describe("appendStagedSegment — accumulate while speaking", () => {
  it("first segment becomes the buffer", () => {
    expect(appendStagedSegment("", "Loss of lumbar lordosis.")).toBe(
      "Loss of lumbar lordosis.",
    );
  });

  it("further segments join with a single space", () => {
    expect(
      appendStagedSegment("Loss of lumbar lordosis.", "Disc desiccation at L4-5 and L5-S1."),
    ).toBe("Loss of lumbar lordosis. Disc desiccation at L4-5 and L5-S1.");
  });

  it("an exactly identical re-emit never duplicates the words", () => {
    // STT finalizers can re-emit the completed capture and React effects
    // can re-fire — neither may double what the radiologist said.
    const once = appendStagedSegment("", "Diffuse disc bulge at L4-L5.");
    expect(appendStagedSegment(once, "Diffuse disc bulge at L4-L5.")).toBe(once);
  });

  it("a repeated finding that is NOT the whole buffer still lands", () => {
    // Re-dictating one finding inside a longer dictation is the
    // radiologist's emphasis, not a re-emit — it must be kept.
    const buf = appendStagedSegment("", "Disc desiccation at L4-5.");
    const grown = appendStagedSegment(buf, "Diffuse disc bulge at L4-5.");
    expect(grown).toBe("Disc desiccation at L4-5. Diffuse disc bulge at L4-5.");
  });

  it("whitespace-only segments change nothing", () => {
    expect(appendStagedSegment("Loss of lordosis.", "   ")).toBe("Loss of lordosis.");
    expect(appendStagedSegment("", "\n\t ")).toBe("");
  });

  it("inner whitespace runs are collapsed so the buffer stays readable", () => {
    expect(appendStagedSegment("", "Disc  desiccation\n at   L4-5.")).toBe(
      "Disc desiccation at L4-5.",
    );
  });
});

describe("stagedWordCount — the Compose button's N", () => {
  it("empty buffer has zero words", () => {
    expect(stagedWordCount("")).toBe(0);
    expect(stagedWordCount("   ")).toBe(0);
  });

  it("counts words across accumulated segments", () => {
    const buf = appendStagedSegment(
      appendStagedSegment("", "Loss of lumbar lordosis."),
      "Disc desiccation at L4-5.",
    );
    // "Loss of lumbar lordosis." = 4, "Disc desiccation at L4-5." = 4
    expect(stagedWordCount(buf)).toBe(8);
  });
});

describe("normalizeAutoComposeSeconds — the pause knob (v1 ships OFF)", () => {
  it("the shipped default is OFF: unknown, missing or garbage values normalise to 0", () => {
    expect(normalizeAutoComposeSeconds(undefined)).toBe(0);
    expect(normalizeAutoComposeSeconds(null)).toBe(0);
    expect(normalizeAutoComposeSeconds("fast")).toBe(0);
    expect(normalizeAutoComposeSeconds({})).toBe(0);
    expect(normalizeAutoComposeSeconds(-3)).toBe(0);
    expect(normalizeAutoComposeSeconds(NaN)).toBe(0);
  });

  it("the four owner options pass through (numbers or their string forms)", () => {
    for (const v of [0, 3, 5, 8]) {
      expect(normalizeAutoComposeSeconds(v)).toBe(v);
      expect(normalizeAutoComposeSeconds(String(v))).toBe(v);
    }
  });

  it("values outside the option list fall back to OFF, not to a nearest guess", () => {
    // Deliberately strict: a corrupted localStorage value must never turn
    // auto-compose on at an untested delay — it turns it off.
    expect(normalizeAutoComposeSeconds(1)).toBe(0);
    expect(normalizeAutoComposeSeconds(4)).toBe(0);
    expect(normalizeAutoComposeSeconds(120)).toBe(0);
    expect(normalizeAutoComposeSeconds("10")).toBe(0);
  });
});
