import { describe, expect, it } from "vitest";

import {
  VISION_TRIAL_ALLOWED_MIMES,
  VISION_TRIAL_MAX_IMAGE_CHARS,
  VISION_TRIAL_MAX_IMAGES,
  normalizeTrialImageSet,
} from "./trialImageSet";

/**
 * The defect this retires: `POST /vision-trial` used to map each browser-supplied picture,
 * drop the ones that failed the mime or size test, and then `.slice(0, 6)` the survivors.
 * An operator who pasted seven pictures got an answer for six, and the response said
 * `imageCount: 6` — the same number the prompt then tells the model ("Image count: 6",
 * `providers/deepseekVisionTrial.ts:139`). Nothing in the exchange said pictures had gone
 * missing, on the one screen whose job is to decide whether a model can see at all.
 *
 * The comparison route had already solved this and documented the rule in its own comment:
 * "Returns null when the set is rejected as a whole, never a shortened list"
 * (`routes/aiComparison.ts:44-46`). These cases hold `/vision-trial` to the same contract.
 *
 * Deliberately a no-database suite: `reportComposerRouter` pulls in the job queue, the compose
 * engine and `@workspace/db`, which is why the sibling
 * `routes/reportComposer.visionTrialGate.test.ts` is a static guard. Extracting the rule into a
 * pure function means the behaviour itself can be asserted rather than inferred from source text.
 */

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/";
const PNG = "iVBORw0KGgoAAAANSUhEUg==";
const WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function image(over: Record<string, unknown> = {}) {
  return { mimeType: "image/jpeg", base64: JPEG, ...over };
}

describe("normalizeTrialImageSet — the trial never runs on fewer pictures than were asked for", () => {
  it("accepts a valid jpeg/png/webp set and keeps each entry's label and filename", () => {
    const r = normalizeTrialImageSet([
      { mimeType: "image/jpeg", base64: JPEG, label: "axial 3", filename: "3.jpg" },
      { mimeType: "image/png", base64: PNG },
      { mimeType: "image/webp", base64: WEBP },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map((i) => i.mimeType)).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(r.images[0].label).toBe("axial 3");
    expect(r.images[0].filename).toBe("3.jpg");
  });

  it("refuses a seventh picture instead of quietly sending six", () => {
    const seven = Array.from({ length: 7 }, () => image());
    const r = normalizeTrialImageSet(seven);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The operator has to be told which rule bit, and on how many pictures.
    expect(r.reason).toMatch(/at most 6 images/i);
    expect(r.suppliedCount).toBe(7);
    expect(r.acceptedCount).toBe(0);
  });

  it("refuses an unsupported type instead of dropping it from the set", () => {
    const r = normalizeTrialImageSet([image(), image({ mimeType: "image/tiff" })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/image\/tiff/);
    expect(r.reason).toMatch(/jpeg, png or webp/);
    expect(r.droppedIndexes).toEqual([1]);
  });

  it("refuses an oversized picture instead of dropping it", () => {
    const tooBig = "A".repeat(VISION_TRIAL_MAX_IMAGE_CHARS + 1);
    const r = normalizeTrialImageSet([image(), image({ base64: tooBig })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain(String(VISION_TRIAL_MAX_IMAGE_CHARS));
    expect(r.droppedIndexes).toEqual([1]);
  });

  it("refuses an empty or non-string payload instead of silently shortening the set", () => {
    for (const bad of ["", "   ", null, undefined, 42]) {
      const r = normalizeTrialImageSet([image(), image({ base64: bad as unknown })]);
      expect(r.ok, `base64=${JSON.stringify(bad)}`).toBe(false);
      if (r.ok) continue;
      expect(r.droppedIndexes).toEqual([1]);
    }
  });

  it("treats a missing or non-array images field as no pictures, exactly as before", () => {
    for (const raw of [undefined, null, "jpeg", 7, {}]) {
      const r = normalizeTrialImageSet(raw);
      expect(r.ok, `raw=${JSON.stringify(raw)}`).toBe(true);
      if (!r.ok) continue;
      expect(r.images).toEqual([]);
    }
  });

  it("accepts exactly the ceiling — six is allowed, seven is not", () => {
    const six = Array.from({ length: VISION_TRIAL_MAX_IMAGES }, () => image());
    expect(normalizeTrialImageSet(six).ok).toBe(true);
    expect(normalizeTrialImageSet([...six, image()]).ok).toBe(false);
  });

  it("defaults an omitted mimeType to jpeg, as the route already did", () => {
    const r = normalizeTrialImageSet([{ base64: JPEG }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images[0].mimeType).toBe("image/jpeg");
  });

  it("caps label and filename length rather than rejecting the study over a long name", () => {
    const r = normalizeTrialImageSet([
      image({ label: "L".repeat(400), filename: "f".repeat(400) }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images[0].label).toHaveLength(80);
    expect(r.images[0].filename).toHaveLength(120);
  });

  it("reports what was supplied even when the very first picture is the bad one", () => {
    const r = normalizeTrialImageSet([image({ mimeType: "application/pdf" }), image()]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.suppliedCount).toBe(2);
    expect(r.droppedIndexes).toEqual([0]);
  });

  it("exposes the ceilings the route states to its caller", () => {
    expect(VISION_TRIAL_MAX_IMAGES).toBe(6);
    expect(VISION_TRIAL_ALLOWED_MIMES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(VISION_TRIAL_MAX_IMAGE_CHARS).toBe(3_500_000);
  });
});
