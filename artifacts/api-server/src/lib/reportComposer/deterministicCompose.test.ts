/**
 * The no-model fallback draft (deterministicCompose) is what the clinic gets when
 * Ollama is off, unconfigured, or has just failed. It assembles an Impression from
 * the observations the radiologist already supplied — it must not lose any of them.
 *
 * These cases pin that: the Impression carries every supplied contribution, in the
 * order supplied, and the Findings/Impression pair cannot disagree about how many
 * abnormalities the study has.
 */
import { describe, expect, it } from "vitest";
import { deterministicComposeFromSnapshot } from "./deterministicCompose";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import { validateComposerOutput } from "./validateOutput";

/** Nine LS-spine abnormalities: more than any cap the fallback could impose. */
const OBSERVATIONS = [
  { concept: "disc_desiccation_l5_s1", findingsText: "L5-S1 disc desiccation.", impressionText: "L5-S1 disc desiccation." },
  { concept: "disc_bulge_l4_l5", findingsText: "L4-L5 diffuse disc bulge.", impressionText: "L4-L5 diffuse disc bulge." },
  { concept: "canal_stenosis_l4_l5", findingsText: "L4-L5 canal stenosis.", impressionText: "L4-L5 canal stenosis." },
  { concept: "foraminal_narrowing_l5_s1", findingsText: "L5-S1 bilateral foraminal narrowing.", impressionText: "L5-S1 bilateral foraminal narrowing." },
  { concept: "lf_hypertrophy_l4_l5", findingsText: "Ligamentum flavum hypertrophy at L4-L5.", impressionText: "Ligamentum flavum hypertrophy at L4-L5." },
  { concept: "facet_arthropathy_l4_l5", findingsText: "L4-L5 facet arthropathy.", impressionText: "L4-L5 facet arthropathy." },
  { concept: "spondylolisthesis_l5_s1", findingsText: "Grade 1 anterolisthesis of L5 on S1.", impressionText: "Grade 1 anterolisthesis of L5 on S1." },
  { concept: "thecal_sac_compression", findingsText: "Thecal sac compression at L4-L5.", impressionText: "Thecal sac compression at L4-L5." },
  { concept: "conus_signal", findingsText: "Conus medullaris shows normal signal.", impressionText: "Normal conus medullaris signal." },
].map((o) => ({ ...o, source: "quick-select" as const, region: "LS Spine" }));

function snap(overrides: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    reportTitle: "MRI LS SPINE PLAIN",
    technique: "Multiplanar multisequence MRI of the lumbar spine.",
    findings: "",
    impression: "",
    recommendation: "",
    observations: OBSERVATIONS,
    ...overrides,
  });
}

describe("deterministic fallback Impression keeps every supplied observation", () => {
  it("FULL_REPORT with no impression carries all nine contributions", () => {
    const draft = deterministicComposeFromSnapshot(snap(), "FULL_REPORT");
    for (const o of OBSERVATIONS) {
      expect(draft.impression, `impression omitted the supplied "${o.impressionText}"`).toContain(o.impressionText);
    }
  });

  it("IMPRESSION with no impression carries all nine contributions", () => {
    const draft = deterministicComposeFromSnapshot(snap(), "IMPRESSION");
    for (const o of OBSERVATIONS) {
      expect(draft.impression, `impression omitted the supplied "${o.impressionText}"`).toContain(o.impressionText);
    }
  });

  it("an observation without an impression contribution still reaches it from findingsText", () => {
    const s = parseComposerSnapshot({
      region: "LS Spine",
      findings: "",
      impression: "",
      recommendation: "",
      observations: [
        { concept: "a", findingsText: "First supplied finding.", source: "quick-select" },
        { concept: "b", findingsText: "Second supplied finding.", source: "quick-select" },
        { concept: "c", findingsText: "Third supplied finding.", source: "quick-select" },
        { concept: "d", findingsText: "Fourth supplied finding.", source: "quick-select" },
        { concept: "e", findingsText: "Fifth supplied finding.", source: "quick-select" },
        { concept: "f", findingsText: "Sixth supplied finding.", source: "quick-select" },
        { concept: "g", findingsText: "Seventh supplied finding.", source: "quick-select" },
      ],
    });
    const draft = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    for (const o of s.observations) expect(draft.impression).toContain(o.findingsText);
  });

  it("Findings and Impression report the same set of abnormalities", () => {
    const draft = deterministicComposeFromSnapshot(snap(), "FULL_REPORT");
    for (const o of OBSERVATIONS) {
      expect(draft.findings, `findings missing "${o.findingsText}"`).toContain(o.findingsText);
      expect(draft.impression, `impression missing "${o.impressionText}"`).toContain(o.impressionText);
    }
  });

  it("contributions keep their supplied order", () => {
    const draft = deterministicComposeFromSnapshot(snap(), "FULL_REPORT");
    const positions = OBSERVATIONS.map((o) => draft.impression.indexOf(o.impressionText));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("deterministic fallback behaviour the fix must not disturb", () => {
  it("returns a supplied impression untouched, however many observations arrive", () => {
    const supplied = "Degenerative changes of the lumbar spine.";
    const draft = deterministicComposeFromSnapshot(snap({ impression: supplied }), "FULL_REPORT");
    expect(draft.impression).toBe(supplied);
  });

  it("still marks the draft as a deterministic fallback and validates clean", () => {
    const s = snap();
    const draft = deterministicComposeFromSnapshot(s, "FULL_REPORT");
    expect(draft.warnings).toEqual(["deterministic_fallback"]);
    // Nothing here is invented: every sentence came from the snapshot, so the
    // grounding validator must still accept the longer Impression.
    expect(validateComposerOutput(s, draft).ok).toBe(true);
  });
});
