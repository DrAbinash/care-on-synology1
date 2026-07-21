import { describe, it, expect } from "vitest";
import { applySectionContribution, conflictingSelections, matchTemplateSection, type SectionState } from "./smartFindings";

// The Smart Findings engine's per-finding section transition. A finding's
// contribution changes from prevText → nextText; the section is updated with
// exact-remove + dedupe-merge so replacement, merge, restore-to-normal and —
// critically — manual-edit survival all hold.

const NORMAL: SectionState = { normal: true, text: "Normal disc height and signal. No disc herniation. Neural foramina patent." };

describe("applySectionContribution — replace / restore", () => {
  it("replaces the baseline normal with the finding text on select", () => {
    const out = applySectionContribution(NORMAL, NORMAL.text, null, "Diffuse posterior disc bulge at L4-L5.");
    expect(out).toEqual({ normal: false, text: "Diffuse posterior disc bulge at L4-L5." });
  });

  it("restores the baseline normal when the finding is removed", () => {
    const abnormal: SectionState = { normal: false, text: "Diffuse posterior disc bulge at L4-L5." };
    const out = applySectionContribution(abnormal, NORMAL.text, "Diffuse posterior disc bulge at L4-L5.", null);
    expect(out).toEqual({ normal: true, text: NORMAL.text });
  });

  it("drops a created (non-template) section when it empties", () => {
    const abnormal: SectionState = { normal: false, text: "Severe canal stenosis at L4-L5." };
    expect(applySectionContribution(abnormal, undefined, "Severe canal stenosis at L4-L5.", null)).toBeNull();
  });
});

describe("applySectionContribution — merge multiple findings on one section", () => {
  it("merges a second finding into the same section (deduped)", () => {
    const first = applySectionContribution({ normal: true, text: "Normal." }, "Normal.", null, "Disc bulge at C5-C6.")!;
    const second = applySectionContribution(first, "Normal.", null, "Disc bulge at C6-C7.")!;
    expect(second).toEqual({ normal: false, text: "Disc bulge at C5-C6.\nDisc bulge at C6-C7." });
    // Removing one leaves the other.
    const back = applySectionContribution(second, "Normal.", "Disc bulge at C5-C6.", null)!;
    expect(back).toEqual({ normal: false, text: "Disc bulge at C6-C7." });
  });
});

describe("applySectionContribution — manual edits survive (the key safety rule)", () => {
  it("keeps a hand-typed addition when the finding is re-rendered (property change)", () => {
    // Finding selected → section holds its text.
    const withFinding = applySectionContribution(NORMAL, NORMAL.text, null, "Disc bulge at L4-L5.")!;
    // Radiologist appends a manual clause.
    const edited: SectionState = { normal: false, text: "Disc bulge at L4-L5.\nWith a superimposed annular fissure." };
    // Property chip changes → prev exact text removed, new render merged; the
    // manual clause is NOT part of prev, so it survives.
    const rerendered = applySectionContribution(edited, NORMAL.text, "Disc bulge at L4-L5.", "Moderate disc bulge at L4-L5.")!;
    expect(rerendered.normal).toBe(false);
    expect(rerendered.text).toContain("With a superimposed annular fissure.");
    expect(rerendered.text).toContain("Moderate disc bulge at L4-L5.");
  });

  it("never overwrites an inline-edited sentence (exact removal no-ops)", () => {
    const edited: SectionState = { normal: false, text: "LARGE disc bulge at L4-L5 (edited)." };
    // The engine tries to remove the original render, which no longer matches → no-op.
    const out = applySectionContribution(edited, NORMAL.text, "Disc bulge at L4-L5.", "Disc bulge at L4-L5.")!;
    expect(out.text).toContain("LARGE disc bulge at L4-L5 (edited).");
  });
});

describe("conflictingSelections", () => {
  it("returns same-group, same-study selections to deselect (Fazekas 1 vs 2)", () => {
    const selected = [
      { id: 1, studyType: "Brain", conflictGroup: "fazekas" },
      { id: 2, studyType: "Brain", conflictGroup: "" },
    ];
    expect(conflictingSelections({ id: 3, studyType: "Brain", conflictGroup: "fazekas" }, selected)).toEqual([1]);
  });
  it("no conflict when group is empty", () => {
    expect(conflictingSelections({ id: 3, studyType: "Brain", conflictGroup: "" }, [
      { id: 1, studyType: "Brain", conflictGroup: "fazekas" },
    ])).toEqual([]);
  });
});

describe("matchTemplateSection — keyword/fuzzy section→region matching", () => {
  const LS = [
    "Alignment & Curvature", "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1",
    "Lumbar Vertebral Bodies", "Conus & Cauda Equina",
    "Screening — Cervical Spine", "Screening — Dorsal Spine",
    "Screening — Cord Signal", "Screening — Vertebral Marrow",
  ];

  it("returns null when nothing is provided", () => {
    expect(matchTemplateSection("", LS)).toBeNull();
    expect(matchTemplateSection("L4-L5", [])).toBeNull();
  });

  it("exact match wins", () => {
    expect(matchTemplateSection("L4-L5", LS)).toBe("L4-L5");
    expect(matchTemplateSection("Screening — Cord Signal", LS)).toBe("Screening — Cord Signal");
  });

  it("matches spine levels across spelling variants", () => {
    expect(matchTemplateSection("L4/5", LS)).toBe("L4-L5");
    expect(matchTemplateSection("l4 l5", LS)).toBe("L4-L5");
    expect(matchTemplateSection("L4–L5 disc", LS)).toBe("L4-L5"); // en-dash
    expect(matchTemplateSection("L5/S1", LS)).toBe("L5-S1");
  });

  it("matches on distinctive keywords despite extra words", () => {
    expect(matchTemplateSection("cord signal", LS)).toBe("Screening — Cord Signal");
    expect(matchTemplateSection("vertebral marrow lesion", LS)).toBe("Screening — Vertebral Marrow");
    expect(matchTemplateSection("conus", LS)).toBe("Conus & Cauda Equina");
    expect(matchTemplateSection("cervical", LS)).toBe("Screening — Cervical Spine");
  });

  it("normalized-exact match ignores punctuation/case", () => {
    expect(matchTemplateSection("alignment and curvature", LS)).toBe("Alignment & Curvature");
    expect(matchTemplateSection("LUMBAR VERTEBRAL BODIES", LS)).toBe("Lumbar Vertebral Bodies");
  });

  it("returns null when there is no meaningful overlap", () => {
    expect(matchTemplateSection("orbit", LS)).toBeNull();
    expect(matchTemplateSection("liver", LS)).toBeNull();
  });

  it("does not confuse different spine levels", () => {
    expect(matchTemplateSection("L1-L2", LS)).toBe("L1-L2");
    expect(matchTemplateSection("L2/3", LS)).toBe("L2-L3");
    expect(matchTemplateSection("L2-L3", LS)).not.toBe("L1-L2");
  });
});
