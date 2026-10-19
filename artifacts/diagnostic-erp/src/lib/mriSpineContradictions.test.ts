import { describe, expect, it } from "vitest";

import {
  LUMBAR_CONTRADICTION_PAIRS,
  contrastDependencyWarning,
  lumbarTextContradictions,
} from "./mriSpineContradictions";
import { defaultSpineSequences, deriveSpineSequencesAvailable } from "./mriSpineSequences";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";

const warn = (findingsText: string, extra: Record<string, unknown> = {}) =>
  lumbarTextContradictions({
    findingsText,
    impressionText: "",
    sequences: deriveSpineSequencesAvailable({ techniqueText: findingsText }),
    numbering: defaultLumbarNumbering(),
    ...extra,
  });

/** The complete approved normal the workspace actually bootstraps — the exact
 * text a browser opening an MRI LS Spine study sees (measured 2026-10-19). */
const LS_STANDARD_NORMAL_FINDINGS = (() => {
  const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === "MRI LS Spine — Normal");
  if (!f) throw new Error("MRI LS Spine — Normal missing from the shipped library");
  return f.findings;
})();

describe("lumbar contradiction validation (spec §39)", () => {
  it("covers every normal-vs-abnormal pair the spec lists", () => {
    const ids = LUMBAR_CONTRADICTION_PAIRS.map((p) => p.id);
    for (const required of [
      "alignment",
      "lordosis",
      "marrow",
      "fracture",
      "discs",
      "canal",
      "foramina",
      "root",
      "conus",
      "cauda",
      "paraspinal",
      "postop",
    ]) {
      expect(ids, `missing rule: ${required}`).toContain(required);
    }
  });

  it("flags normal alignment beside a listhesis", () => {
    const warnings = warn(
      "Lumbar alignment is preserved. There is grade 1 anterolisthesis of L4 on L5.",
    );
    expect(warnings.some((w) => /alignment/i.test(w))).toBe(true);
  });

  it("stays silent on the complete shipped normal the workspace bootstraps (measured 2026-10-19)", () => {
    // Before the denial guard this flagged the alignment pair on the pure
    // normal report: "Normal lumbar lordosis is maintained." sat as the normal
    // side and "No spondylolisthesis is seen." — a DENIAL — matched the
    // abnormal side's bare word. A false banner on every normal report is the
    // one thing an advisory layer must never do.
    const warnings = warn(LS_STANDARD_NORMAL_FINDINGS);
    expect(warnings.filter((w) => /Contradiction in/.test(w))).toEqual([]);
  });

  it("accepts the corrected alignment tile's sentence once the curve normal retires (owner ruling 2026-10-19)", () => {
    // What the page holds after the corrected "Loss of lumbar lordosis" tile is
    // clicked: the lordosis normal is gone, everything else stands, and the
    // owner's neutral wording is on the page. Straightening does not contradict
    // "No spondylolisthesis is seen." — different findings.
    const afterTile = LS_STANDARD_NORMAL_FINDINGS
      .split(/\r?\n/)
      .filter((line) => !line.includes("Normal lumbar lordosis is maintained."))
      .join("\n");
    const warnings = warn(`${afterTile}\nStraightening/loss of normal lumbar lordosis.`);
    expect(warnings.filter((w) => /Contradiction in/.test(w))).toEqual([]);
  });

  it("still flags a genuinely preserved curve beside a stated straightening loss", () => {
    // The true positive the lordosis pair exists for: both claims about the
    // SAME curve on one page.
    const warnings = warn(
      "Normal lumbar lordosis is maintained. Straightening/loss of normal lumbar lordosis.",
    );
    expect(warnings.some((w) => /lumbar lordosis/i.test(w))).toBe(true);
  });

  it("flags a patent canal beside severe stenosis and patent foramina beside severe foraminal stenosis", () => {
    const warnings = warn(
      "Central canal is patent throughout. There is severe central canal stenosis at L4-L5. Neural foramina are patent. There is severe bilateral neural foraminal stenosis at L5-S1.",
    );
    expect(warnings.some((w) => /central canal/i.test(w))).toBe(true);
    expect(warnings.some((w) => /neural foramina/i.test(w))).toBe(true);
  });

  it("flags no-fracture beside an acute fracture, and normal marrow beside Modic change", () => {
    const warnings = warn(
      "No acute compression fracture. Vertebral body heights are normal. There is an acute compression fracture of the L1 vertebral body. Marrow signal intensities are normal throughout. Subchondral Modic Type I degenerative endplate changes are present.",
    );
    expect(warnings.some((w) => /fracture/i.test(w))).toBe(true);
    expect(warnings.some((w) => /marrow/i.test(w))).toBe(true);
  });

  it("flags no-root-compression beside a stated root compression", () => {
    const warnings = warn(
      "No nerve root compression. Right paracentral disc extrusion compressing the descending right S1 nerve root.",
    );
    expect(warnings.some((w) => /nerve roots/i.test(w))).toBe(true);
  });

  it("flags paraspinal normality beside a psoas abscess", () => {
    const warnings = warn(
      "Visualized paraspinal musculature and psoas muscles are unremarkable. Psoas muscle abscess on the left measuring 4 x 3 cm.",
    );
    expect(warnings.some((w) => /paraspinal/i.test(w))).toBe(true);
  });

  it("stays quiet on a coherent report", () => {
    const warnings = warn(
      "Lumbar lordosis is well preserved. Normal lumbar alignment without listhesis. Vertebral body heights and marrow signal intensities are normal. Disc heights and signal intensities are preserved. Central canal is patent. No nerve root compression.",
    );
    expect(warnings).toEqual([]);
  });

  it("warns about sequence-dependent statements without changing anything", () => {
    const findings = "Subchondral marrow edema at L4-L5 with enhancement of the disc.";
    const noSequences = deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2." });
    const warnings = lumbarTextContradictions({
      findingsText: findings,
      impressionText: "",
      sequences: noSequences,
      numbering: defaultLumbarNumbering(),
    });
    expect(warnings.some((w) => /STIR/i.test(w))).toBe(true);
    expect(warnings.some((w) => /contrast/i.test(w))).toBe(true);
    // The text itself is untouched — validation never rewrites.
    expect(findings).toBe("Subchondral marrow edema at L4-L5 with enhancement of the disc.");
  });

  it("does not raise a sequence warning when the sequence exists", () => {
    const warnings = lumbarTextContradictions({
      findingsText: "Subchondral marrow edema at L4-L5.",
      impressionText: "",
      sequences: deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2 and STIR." }),
      numbering: defaultLumbarNumbering(),
    });
    expect(warnings.filter((w) => /STIR/i.test(w))).toEqual([]);
  });

  it("keeps level naming consistent when transitional anatomy is set (spec §5)", () => {
    const warnings = lumbarTextContradictions({
      findingsText: "Broad-based disc protrusion at L5-S1 causing canal narrowing.",
      impressionText: "",
      sequences: defaultSpineSequences(),
      numbering: { mode: "lstv-sacralization", castellvi: "IIa", side: "unilateral", wholeSpineLocalizer: true },
    });
    expect(warnings.some((w) => /level naming/i.test(w))).toBe(true);
    expect(warnings.some((w) => /L5-S1/.test(w))).toBe(true);
    // The same sentence with standard numbering is not a naming problem.
    const clean = lumbarTextContradictions({
      findingsText: "Broad-based disc protrusion at L5-S1 causing canal narrowing.",
      impressionText: "",
      sequences: defaultSpineSequences(),
      numbering: defaultLumbarNumbering(),
    });
    expect(clean.filter((w) => /level naming/i.test(w))).toEqual([]);
  });

  it("asks for the numbering basis when LSTV is set but never stated", () => {
    const warnings = lumbarTextContradictions({
      findingsText: "Disc desiccation at L4-L5 with Modic type 2 changes.",
      impressionText: "",
      sequences: defaultSpineSequences(),
      numbering: { mode: "lstv-sacralization", castellvi: "IIIb", side: "bilateral", wholeSpineLocalizer: true },
    });
    expect(warnings.some((w) => /numbering caution/i.test(w))).toBe(true);
  });

  it("returns nothing for an empty report", () => {
    expect(lumbarTextContradictions({ findingsText: "", impressionText: "" })).toEqual([]);
  });

  it("isolates contrast-dependent wording for the post-operative palette (spec §18)", () => {
    const text = "Recurrent disc herniation shows no enhancement, while surrounding tissue enhances.";
    expect(contrastDependencyWarning(text, deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1/T2." })))
      .toContain("no contrast was administered");
    expect(contrastDependencyWarning(text, deriveSpineSequencesAvailable({ techniqueText: "Post-contrast T1." })))
      .toBeNull();
  });
});
