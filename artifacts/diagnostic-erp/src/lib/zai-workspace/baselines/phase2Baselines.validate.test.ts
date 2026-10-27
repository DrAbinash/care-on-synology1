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

  it("exports exactly 11 owned formats", () => {
    expect(catalog).toHaveLength(11);
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
    ]);
  });

  it("reports ownership counts for each Phase 2 format", () => {
    const counts = Object.fromEntries(
      catalog.map((e) => [e.name, e.manifest.observations.length]),
    );
    expect(counts).toEqual({
      "MRI Brain — Standard Normal": 13,
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
    expect(screening).toHaveLength(5);
    for (const entry of screening) {
      const occurrences = entry.findings.split(SCREENING_LIMITATION_TEXT).length - 1;
      expect(occurrences, entry.name).toBe(1);
      const limitationObs = entry.manifest.observations.filter(
        (o) => o.concept === SCREENING_LIMITATION_CONCEPT,
      );
      expect(limitationObs, entry.name).toHaveLength(1);
      expect(limitationObs[0]!.renderedText).toBe(SCREENING_LIMITATION_TEXT);
    }
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
