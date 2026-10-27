/**
 * The coverage half of the region vocabulary, tested where it is defined.
 *
 * These three functions decide which normal report a study may open with, so they are
 * checked against the shipped catalog's own declarations rather than against a fixture
 * the test invented: what a format documents comes from its body part plus the screening
 * scope the catalog author declared for it, and nothing reads report prose to find out.
 */
import { describe, expect, test } from "vitest";

import {
  coverageExceeds,
  coverageOfRegionLabel,
  coverageUnionOfRegions,
  formatDocumentedCoverage,
  type SpineCoverageSegment,
} from "./reportingRegion";

const seg = (s: Set<SpineCoverageSegment> | null) => (s ? [...s].sort().join("+") : "null");
const set = (...segments: SpineCoverageSegment[]) => new Set<SpineCoverageSegment>(segments);

describe("coverageOfRegionLabel — one label, possibly multi-region", () => {
  test("a single named segment covers that segment only", () => {
    expect(seg(coverageOfRegionLabel("Cervical Spine"))).toBe("cervical");
    expect(seg(coverageOfRegionLabel("LS Spine"))).toBe("lumbar");
    expect(seg(coverageOfRegionLabel("Dorsal Spine"))).toBe("dorsal");
  });

  test("the whole spine is three segments, and Dorso-Lumbar is two", () => {
    expect(seg(coverageOfRegionLabel("Whole Spine"))).toBe("cervical+dorsal+lumbar");
    expect(seg(coverageOfRegionLabel("Dorsolumbar Spine"))).toBe("dorsal+lumbar");
  });

  test("a multi-region label is the union, in either order", () => {
    expect(seg(coverageOfRegionLabel("Cervical Spine + LS Spine"))).toBe("cervical+lumbar");
    expect(seg(coverageOfRegionLabel("LS Spine + Cervical Spine"))).toBe("cervical+lumbar");
  });

  test("nothing, blank and non-spine give no opinion", () => {
    expect(coverageOfRegionLabel(null)).toBeNull();
    expect(coverageOfRegionLabel("   ")).toBeNull();
    expect(coverageOfRegionLabel("Brain")).toBeNull();
    expect(coverageOfRegionLabel("Spine")).toBeNull(); // the bare tab, not a segment
  });
});

describe("formatDocumentedCoverage — what a report format's own body speaks for", () => {
  test("a plain regional normal documents its own region", () => {
    expect(seg(formatDocumentedCoverage({ bodyPart: "Cervical Spine", diagnosisTags: ["normal"] })))
      .toBe("cervical");
    expect(seg(formatDocumentedCoverage({ bodyPart: "LS Spine", protocolScope: "Plain" })))
      .toBe("lumbar");
  });

  test("a screening normal of ONE region still documents only that region", () => {
    // The distinction the clinic depends on: limited-sequence screening of the cervical
    // spine is not whole-spine screening, and must not be treated as if it were.
    expect(seg(formatDocumentedCoverage({ bodyPart: "Cervical Spine", diagnosisTags: ["screening"] })))
      .toBe("cervical");
  });

  test("a declared whole-spine scope widens what the format documents", () => {
    // …from the catalog tag a built-in baseline carries…
    expect(seg(formatDocumentedCoverage({ bodyPart: "LS Spine", diagnosisTags: ["screening", "whole spine"] })))
      .toBe("cervical+dorsal+lumbar");
    // …or from a Templates row's structured study_type.
    expect(seg(formatDocumentedCoverage({ bodyPart: "Cervical Spine", protocolScope: "SCREENING_WHOLE_SPINE" })))
      .toBe("cervical+dorsal+lumbar");
  });

  test("the widening never invents a region the format does not belong to", () => {
    // A brain format is not measured on a spine axis at all.
    expect(formatDocumentedCoverage({ bodyPart: "Brain", diagnosisTags: ["whole spine"] })).toBeNull();
    expect(formatDocumentedCoverage({ bodyPart: null, protocolScope: "Screening" })).toBeNull();
  });

  test("a name that merely mentions screening does not claim the whole spine", () => {
    expect(seg(formatDocumentedCoverage({ bodyPart: "Dorsal Spine", protocolScope: "Screening" })))
      .toBe("dorsal");
  });
});

describe("coverageExceeds — the ceiling test itself", () => {
  test("a subset is within, a superset exceeds", () => {
    expect(coverageExceeds(set("cervical"), set("cervical", "dorsal", "lumbar"))).toBe(false);
    expect(coverageExceeds(set("cervical", "lumbar"), set("cervical"))).toBe(true);
    expect(coverageExceeds(set("cervical"), set("cervical"))).toBe(false);
  });

  test("no opinion on either side excludes nothing", () => {
    // Refusing on a null is how a study ends up with no normal report at all.
    expect(coverageExceeds(null, set("cervical"))).toBe(false);
    expect(coverageExceeds(set("cervical", "dorsal"), null)).toBe(false);
    expect(coverageExceeds(null, null)).toBe(false);
  });

  test("the union a multi-select study acquires", () => {
    expect(seg(coverageUnionOfRegions(["Cervical Spine", "LS Spine", "Brain"]))).toBe("cervical+lumbar");
  });
});
