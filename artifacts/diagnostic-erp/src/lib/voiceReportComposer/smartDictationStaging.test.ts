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
import { appendStagedSegment, stagedWordCount } from "./smartDictationSession";

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
