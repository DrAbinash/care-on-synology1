import { describe, expect, it } from "vitest";
import {
  materializeFormatBaseline,
  validateBaselineManifest,
} from "../fullReportBaseline";
import {
  ownedBaselineCatalog,
  SCREENING_LIMITATION_CONCEPT,
  SCREENING_LIMITATION_TEXT,
} from "./index";

describe("Phase 2 owned baselines", () => {
  const catalog = ownedBaselineCatalog();

  it("exports exactly 15 owned formats", () => {
    expect(catalog).toHaveLength(15);
    expect(catalog.map((e) => e.name)).toEqual([
      "MRI Brain — Standard Normal",
      "MRI Cervical Spine — Standard Normal",
      // Dorsal joined on purpose: it was the one MRI region whose billed normal
      // report had no owned rows, so Generate wrote fourteen sentences nobody could
      // retire ("baselineConcepts": 0).
      "MRI Dorsal Spine — Standard Normal",
      "MRI Knee — Standard Normal",
      // Pelvis and Shoulder joined in the PR #1077 final corrections round: they
      // were the tile-supported MRI examinations with no shipped normal at all,
      // so their hip / rotator-cuff rows are the first owned sentences a click
      // on "Hip effusion" / "Rotator cuff tear" can retire.
      "MRI Pelvis — Normal",
      "MRI Shoulder — Normal",
      "MRI Brain — Screening Normal",
      "MRI Cervical Spine — Screening Normal",
      "MRI Dorsal Spine — Screening Normal",
      "MRI LS Spine — Screening Normal",
      "MRI Whole Spine — Screening Normal",
      // The three identities the coverage audit measured as rows that open a complete
      // normal while owning none of its sentences: the contrast Brain normal (a click
      // on an enhancing-tumour box left "No abnormal enhancement on post-contrast
      // study." under it), the epilepsy Brain normal (the Hippocampal sclerosis box
      // beside "hippocampi are symmetrical with normal signal") and the combined
      // LS + whole-spine screening normal (no scaffold rows at all, so nothing retired).
      "MRI Brain — Normal (Contrast)",
      "MRI Brain — Epilepsy Protocol (Normal)",
      "MRI LS Spine + Whole Spine Screening — Normal",
      // The Dorso-Lumbar standard normal is a different kind of addition: it is the
      // booked region the audit measured as opening NO normal at all (`no-match`), not
      // a row that printed one and owned none of it. It is composed from the shipped
      // `DL_NORMAL_BY_CONCEPT` sentences rather than from the dorsal and LS normals,
      // because a dorso-lumbar report is one examination across the junction.
      "MRI Dorso-Lumbar Spine — Standard Normal",
    ]);
  });

  it("reports ownership counts for each Phase 2 format", () => {
    const counts = Object.fromEntries(
      catalog.map((e) => [e.name, e.manifest.observations.length]),
    );
    expect(counts).toEqual({
      // 16 region normals + the normal impression. 12 → 16 with the Text-to-Report
      // round, which added the sellar/parasellar, paranasal sinus, mastoid air cell and
      // orbit normals the owner's completeness list names and the brain template never
      // stated.
      "MRI Brain — Standard Normal": 17,
      // 8 region normals + 6 disc levels × 6 per-level normals. Six levels, not
      // five: the cervical owned baseline used to stop at C6-C7 while the canvas,
      // `CERVICAL_CANAL_LEVELS` and `mriSpineCanvas.test.ts` all run C2-C3→C7-T1.
      "MRI Cervical Spine — Standard Normal": 45,
      // 10 region normals + the normal impression. No per-level rows: the dorsal
      // standard normal states each claim once for the whole region, which is what
      // its shipped template said.
      "MRI Dorsal Spine — Standard Normal": 11,
      "MRI Knee — Standard Normal": 12,
      // 9 findings rows + the normal impression. The hip joints carry per-side rows
      // (laterality-scoped like the knee's medial/lateral meniscus split), the rest
      // of the pelvis one region-wide row each.
      "MRI Pelvis — Normal": 10,
      // 9 findings rows + the normal impression, the same compact shape. The
      // rotator cuff is ONE row with no laterality: the examined side is
      // study-level context (the knee baseline's examined-knee-side rule).
      "MRI Shoulder — Normal": 10,
      "MRI Brain — Screening Normal": 7,
      "MRI Cervical Spine — Screening Normal": 8,
      "MRI Dorsal Spine — Screening Normal": 8,
      "MRI LS Spine — Screening Normal": 8,
      "MRI Whole Spine — Screening Normal": 17,
      // 9 findings rows + the normal impression. Two of the row's printed sentences are
      // deliberately not among them — the falx/position claim and the reason are written at
      // the gap in `mriBrainContrastNormal.ts`. The two sentences that state no anatomy of
      // their own (the parenchymal-signal claim and the internal auditory canal / CP-angle
      // line) ride in the observation whose anatomy they describe, because a slot for a
      // concept nothing in CARE writes is one no tile can ever contradict.
      "MRI Brain — Normal (Contrast)": 10,
      // 11 findings rows + the normal impression. The mesial temporal paragraph is two
      // slots, not one: signal/architecture and volume/atrophy, which is the axis the
      // canon already draws and what lets the Hippocampal sclerosis box retire both.
      "MRI Brain — Epilepsy Protocol (Normal)": 12,
      // 14 findings rows + the normal impression, region-aware the way the Whole Spine
      // screening baseline is: nine lumbar rows and five screened-section rows, so one
      // `alignment` slot per section instead of three claims competing for one key. The
      // lumbar disc sentence is the gap named in `mriLsWholeSpineScreeningNormal.ts`.
      "MRI LS Spine + Whole Spine Screening — Normal": 15,
      // 7 findings rows + the normal impression: alignment, sagittal curvature,
      // vertebral bodies, no-fracture, canal, cord, conus. Seven, not dorsal-11 plus
      // LS-40, because each claim the junction-spanning exam makes once is one slot.
      "MRI Dorso-Lumbar Spine — Standard Normal": 8,
    });
  });

  it("validates every Phase 2 manifest without missing text or duplicate slots", () => {
    for (const entry of catalog) {
      const format = {
        name: entry.name,
        modality: entry.modality,
        bodyPart: entry.bodyPart,
        findings: entry.findings,
        impression: entry.impression,
        baselineManifest: entry.manifest,
      };
      const result = validateBaselineManifest(format, entry.bodyPart);
      expect(result, entry.name).toEqual({ ok: true, missing: [], duplicateSlots: [] });
    }
  });

  it("includes the exact screening limitation phrase once on each screening format", () => {
    const screening = catalog.filter((e) => e.protocolScope === "Screening");
    expect(screening).toHaveLength(6);
    // The combined LS + whole-spine screening normal is the one screening identity whose
    // limitation the report states in Technique rather than in Findings: the row it came
    // from prints "Limited planar and limited sequence screening of the whole spine was
    // obtained." (preserved as a `techniqueFragments` row), and owning its sentences adds
    // no prose to it. Named and asserted rather than filtered out, so a seventh screening
    // baseline cannot join this set quietly — and the exclusion's own premise is checked.
    const bannerRequired = screening.filter(
      (e) => e.name !== "MRI LS Spine + Whole Spine Screening — Normal",
    );
    expect(bannerRequired).toHaveLength(5);
    for (const entry of bannerRequired) {
      const occurrences = entry.findings.split(SCREENING_LIMITATION_TEXT).length - 1;
      expect(occurrences, entry.name).toBe(1);
      const limitationObs = entry.manifest.observations.filter(
        (o) => o.concept === SCREENING_LIMITATION_CONCEPT,
      );
      expect(limitationObs, entry.name).toHaveLength(1);
      expect(limitationObs[0]!.renderedText).toBe(SCREENING_LIMITATION_TEXT);
    }
    const techniqueCarried = screening.find(
      (e) => e.name === "MRI LS Spine + Whole Spine Screening — Normal",
    )!;
    expect(techniqueCarried.findings).not.toContain(SCREENING_LIMITATION_TEXT);
    expect(techniqueCarried.manifest.observations.filter(
      (o) => o.concept === SCREENING_LIMITATION_CONCEPT,
    )).toHaveLength(0);
    expect(techniqueCarried.technique).toContain("Limited planar and limited sequence screening");
  });

  it("materializes screening_limitation as protected role=screening", () => {
    const brainScreening = catalog.find((e) => e.name === "MRI Brain — Screening Normal")!;
    const patches = materializeFormatBaseline(
      {
        findings: brainScreening.findings,
        impression: brainScreening.impression,
        baselineManifest: brainScreening.manifest,
        bodyPart: brainScreening.bodyPart,
      },
      "Brain",
    );
    const limitation = patches.find((p) => p.observation?.concept === SCREENING_LIMITATION_CONCEPT);
    expect(limitation).toBeTruthy();
    expect(limitation!.protected).toBe(true);
    expect(limitation!.observation?.role).toBe("screening");
  });

  it("keeps Whole Spine regional normals on distinct regions and level buckets", () => {
    const whole = catalog.find((e) => e.name === "MRI Whole Spine — Screening Normal")!;
    const regional = whole.manifest.observations.filter(
      (o) => o.field === "findings" && o.concept !== SCREENING_LIMITATION_CONCEPT,
    );
    const regions = new Set(regional.map((o) => o.region));
    const levels = new Set(regional.map((o) => o.level));
    expect(regions).toEqual(new Set(["Cervical Spine", "Dorsal Spine", "LS Spine"]));
    expect(levels).toEqual(new Set(["cervical", "dorsal", "lumbar"]));
  });
});
