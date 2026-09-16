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

  it("exports exactly 8 owned formats", () => {
    expect(catalog).toHaveLength(8);
    expect(catalog.map((e) => e.name)).toEqual([
      "MRI Brain — Standard Normal",
      "MRI Cervical Spine — Standard Normal",
      "MRI Knee — Standard Normal",
      "MRI Brain — Screening Normal",
      "MRI Cervical Spine — Screening Normal",
      "MRI Dorsal Spine — Screening Normal",
      "MRI LS Spine — Screening Normal",
      "MRI Whole Spine — Screening Normal",
    ]);
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

  it("keeps Whole Spine regional normals on distinct level buckets", () => {
    const whole = catalog.find((e) => e.name === "MRI Whole Spine — Screening Normal")!;
    const levels = new Set(
      whole.manifest.observations
        .filter((o) => o.field === "findings" && o.concept !== SCREENING_LIMITATION_CONCEPT)
        .map((o) => o.level),
    );
    expect(levels).toEqual(new Set(["cervical", "dorsal", "lumbar"]));
  });
});
