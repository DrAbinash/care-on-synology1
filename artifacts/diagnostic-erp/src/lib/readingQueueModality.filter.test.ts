/**
 * Exclusive Reading Queue modality filter — USG must not include MR, blanks
 * only under All.
 */
import { describe, expect, test } from "vitest";
import { matchesReadingQueueModality } from "./readingQueueModality";

type Seed = { id: string; modality: string };

const SEED: Seed[] = [
  { id: "us-1", modality: "US" },
  { id: "usg-1", modality: "USG" },
  { id: "ob-us", modality: "OB US" },
  { id: "doppler", modality: "DOPPLER" },
  { id: "mr-1", modality: "MR" },
  { id: "mri-1", modality: "MRI" },
  { id: "blank", modality: "" },
  { id: "ot", modality: "OT" },
];

function view(filter: string): string[] {
  return SEED.filter((r) => matchesReadingQueueModality(r.modality, filter)).map((r) => r.id);
}

describe("matchesReadingQueueModality — exclusive family views", () => {
  test("USG view = US-family rows only (no MR, no blank)", () => {
    expect(view("US")).toEqual(["us-1", "usg-1", "ob-us", "doppler"]);
    expect(view("USG")).toEqual(["us-1", "usg-1", "ob-us", "doppler"]);
  });

  test("MRI view = MR-family rows only", () => {
    expect(view("MR")).toEqual(["mr-1", "mri-1"]);
  });

  test("All view = all three buckets including blank/unknown", () => {
    expect(view("all")).toEqual([
      "us-1",
      "usg-1",
      "ob-us",
      "doppler",
      "mr-1",
      "mri-1",
      "blank",
      "ot",
    ]);
  });

  test("blank and OT never appear under a specific modality", () => {
    for (const filter of ["US", "MR", "CT", "XR"]) {
      expect(matchesReadingQueueModality("", filter)).toBe(false);
      expect(matchesReadingQueueModality(null, filter)).toBe(false);
      expect(matchesReadingQueueModality("OT", filter)).toBe(false);
      expect(matchesReadingQueueModality("  ", filter)).toBe(false);
    }
    expect(matchesReadingQueueModality("", "all")).toBe(true);
    expect(matchesReadingQueueModality("OT", "all")).toBe(true);
  });

  test("US filter never matches MR/MRI", () => {
    expect(matchesReadingQueueModality("MR", "US")).toBe(false);
    expect(matchesReadingQueueModality("MRI", "US")).toBe(false);
    expect(matchesReadingQueueModality("MR BRAIN", "US")).toBe(false);
  });

  test("MR filter never matches US/USG", () => {
    expect(matchesReadingQueueModality("US", "MR")).toBe(false);
    expect(matchesReadingQueueModality("USG", "MR")).toBe(false);
  });
});
