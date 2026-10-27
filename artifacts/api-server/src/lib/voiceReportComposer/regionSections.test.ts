/**
 * Region section vocabulary — the composer's canonical anatomicalSection keys.
 *
 * The LLM path used to receive NO section vocabulary: the JSON schema example
 * showed "disc" and the model free-formed the rest. The production failure is
 * documented in migrations/z_fix_radiology_smart_findings_sections.sql —
 * invented names ("Spinal Canal", "Intervertebral Discs", "Sellar Region")
 * that match no report template section. These contracts pin the fix:
 *
 *   1. every region family has a CLOSED key set, derived from the shipped
 *      vocabularies (server phrase catalog keys + workspace baseline labels);
 *   2. near-miss spellings canonicalize onto the real key;
 *   3. anything else — invented sections, cross-family leakage — collapses to
 *      "" (the report's "Additional Observations" catch-all), never a
 *      literally-named fake section;
 *   4. an unrecognized region means NO opinion: the plan passes through
 *      untouched rather than being stripped by a vocabulary we do not have.
 */
import { describe, expect, it } from "vitest";
import {
  BRAIN_SECTION_KEYS,
  SPINE_SECTION_KEYS,
  canonicalSectionKey,
  normalizePlanSections,
  regionSectionKeys,
  sectionKeysForPrompt,
} from "./regionSections";
import { buildComposerPrompt } from "./contextBuilder";
import type { VoiceChangePlan } from "./schema";

function planWith(...sections: Array<string | undefined>): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: sections.map((s, i) => ({
      concept: `obs_${i}`,
      findingsText: `Finding number ${i}.`,
      ...(s === undefined ? {} : { anatomicalSection: s }),
    })),
    uncertainties: [],
  } as unknown as VoiceChangePlan;
}

describe("regionSectionKeys — closed vocabulary per family", () => {
  it("LS Spine: spine keys only — anatomy keys and baseline labels, no brain leakage", () => {
    const keys = regionSectionKeys("LS Spine")!;
    for (const expected of [
      "alignment", "disc", "discs", "vertebra", "vertebral bodies",
      "canal", "spinal canal", "cord", "spinal cord", "conus",
      "foramina", "neural foramina", "facet", "posterior elements",
    ]) {
      expect(keys).toContain(expected);
    }
    for (const leaked of ["white matter", "brain", "diffusion", "ventricles", "mca"]) {
      expect(keys).not.toContain(leaked);
    }
  });

  it("whole-spine and every spine segment map to the same spine vocabulary", () => {
    expect(regionSectionKeys("MRI Whole Spine — Screening")).toEqual(SPINE_SECTION_KEYS);
    expect(regionSectionKeys("Cervical Spine")).toEqual(SPINE_SECTION_KEYS);
    expect(regionSectionKeys("Cervical Spine")).toContain("c1c2");
    expect(regionSectionKeys("Cervical Spine")).toContain("uncovertebral");
    expect(regionSectionKeys("LS Spine")).toContain("sacroiliac");
  });

  it("Brain: brain keys only — no spine anatomy leaks in", () => {
    const keys = regionSectionKeys("Brain")!;
    for (const expected of [
      "brain", "brain parenchyma", "parenchyma", "white matter", "diffusion",
      "ventricles", "extra-axial spaces", "midline", "basal ganglia",
      "mca", "brainstem", "cerebellum", "posterior fossa",
    ]) {
      expect(keys).toContain(expected);
    }
    for (const leaked of ["disc", "spinal canal", "alignment", "facet", "conus"]) {
      expect(keys).not.toContain(leaked);
    }
  });

  it("unrecognized region → null: no opinion, never a guessed vocabulary", () => {
    expect(regionSectionKeys("Knee")).toBeNull();
    expect(regionSectionKeys("USG Abdomen")).toBeNull();
    expect(regionSectionKeys("")).toBeNull();
    expect(regionSectionKeys(null)).toBeNull();
    expect(regionSectionKeys(undefined)).toBeNull();
  });
});

describe("canonicalSectionKey — exact spelling variants canonicalize, inventions collapse", () => {
  it("exact keys pass through untouched", () => {
    expect(canonicalSectionKey("disc", SPINE_SECTION_KEYS)).toBe("disc");
    expect(canonicalSectionKey("white matter", BRAIN_SECTION_KEYS)).toBe("white matter");
  });

  it("case, punctuation and separator variants map onto the canonical key", () => {
    expect(canonicalSectionKey("Spinal Canal", SPINE_SECTION_KEYS)).toBe("spinal canal");
    expect(canonicalSectionKey("SPINAL CANAL", SPINE_SECTION_KEYS)).toBe("spinal canal");
    expect(canonicalSectionKey("VERTEBRAL BODIES", SPINE_SECTION_KEYS)).toBe("vertebral bodies");
    expect(canonicalSectionKey("Nerve-Root", SPINE_SECTION_KEYS)).toBe("nerve_root");
    expect(canonicalSectionKey("nerve root", SPINE_SECTION_KEYS)).toBe("nerve_root");
    expect(canonicalSectionKey("Extra-Axial Spaces", BRAIN_SECTION_KEYS)).toBe("extra-axial spaces");
  });

  it("invented and near-miss sections collapse to the catch-all — no fuzzy matching", () => {
    // The three documented production offenders plus a vocabulary-near-miss.
    expect(canonicalSectionKey("Sellar Region", BRAIN_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("Spinal Canal Measurements", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("Intervertebral Discs", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("discs and ligaments", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey(undefined, SPINE_SECTION_KEYS)).toBe("");
  });

  it("cross-family keys are strangers: brain anatomy has no place in a spine plan", () => {
    expect(canonicalSectionKey("white matter", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("orbit", SPINE_SECTION_KEYS)).toBe("");
    expect(canonicalSectionKey("disc", BRAIN_SECTION_KEYS)).toBe("");
  });
});

describe("normalizePlanSections — the emitted plan carries canonical sections only", () => {
  it("canonicalizes variants and collapses inventions, keeping absent fields absent", () => {
    const plan = normalizePlanSections(
      planWith("disc", "Spinal Canal", "Sellar Region", undefined),
      "LS Spine",
    );
    const sections = plan.observations.map((o) => o.anatomicalSection);
    expect(sections).toEqual(["disc", "spinal canal", "", undefined]);
    // The findings text — the radiologist's actual words — is untouched.
    expect(plan.observations[2]?.findingsText).toBe("Finding number 2.");
  });

  it("custom phrase sections join the allowed vocabulary — authored words stay dictatable", () => {
    const plan = normalizePlanSections(
      planWith("My Custom Section"),
      "LS Spine",
      ["My Custom Section"],
    );
    expect(plan.observations[0]?.anatomicalSection).toBe("My Custom Section");
  });

  it("unrecognized region passes the plan through UNTOUCHED (same reference)", () => {
    const plan = planWith("disc", "Anything At All");
    expect(normalizePlanSections(plan, "Knee")).toBe(plan);
  });

  it("non-observation plan fields ride along unchanged", () => {
    const plan = {
      operation: "report_change_plan" as const,
      observations: [{ concept: "x", findingsText: "X.", anatomicalSection: "disc" }],
      removeConflictingBaselineConcepts: ["baseline_x"],
      impressionCandidates: ["Impression."],
      uncertainties: ["u"],
      clarificationRequired: null,
    } as unknown as VoiceChangePlan;
    const out = normalizePlanSections(plan, "LS Spine");
    expect(out.removeConflictingBaselineConcepts).toEqual(["baseline_x"]);
    expect(out.impressionCandidates).toEqual(["Impression."]);
    expect(out.uncertainties).toEqual(["u"]);
    expect(out.clarificationRequired).toBeNull();
  });
});

describe("buildComposerPrompt — the prompt teaches the region's sections", () => {
  const ctx = {
    transcript: "Disc desiccation with canal stenosis.",
    region: "LS Spine",
    modality: "MR",
  };

  it("LS Spine prompt lists the spine section vocabulary", () => {
    const prompt = buildComposerPrompt(ctx, "");
    expect(prompt).toContain("Region sections");
    expect(prompt).toContain("spinal canal");
    expect(prompt).toContain("alignment");
    expect(prompt).toContain("posterior elements");
  });

  it("Brain prompt lists the brain section vocabulary", () => {
    const prompt = buildComposerPrompt(
      { ...ctx, region: "Brain" },
      "",
    );
    expect(prompt).toContain("Region sections");
    expect(prompt).toContain("white matter");
    expect(prompt).toContain("ventricles");
  });

  it("impression-only prompts carry no section vocabulary (no observations emitted)", () => {
    const prompt = buildComposerPrompt(
      { ...ctx, generateImpressionOnly: true, findingsText: "Findings." },
      "",
    );
    expect(prompt).not.toContain("Region sections");
  });

  it("unrecognized region: no section line — the model is not handed a guessed anatomy", () => {
    const prompt = buildComposerPrompt({ ...ctx, region: "Knee" }, "");
    expect(prompt).not.toContain("Region sections");
  });
});

describe("sectionKeysForPrompt — compact line for the prompt budget", () => {
  it("joins the region's keys with commas", () => {
    const line = sectionKeysForPrompt("LS Spine")!;
    expect(line).toContain("alignment");
    expect(line).toContain("spinal canal");
    expect(line).not.toContain("white matter");
  });

  it("null for unknown regions", () => {
    expect(sectionKeysForPrompt("Knee")).toBeNull();
  });
});
