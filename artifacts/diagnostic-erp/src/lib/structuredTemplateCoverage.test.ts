/**
 * PRIORITY 2, second half — the Templates screen is the other way a report gets its prose,
 * and it is the one that was actually printing the contradiction.
 *
 * `resolveNormalBootstrapFormat` chooses a Full Report Format. The workspace separately
 * chooses a `structured_report_templates` row and renders ITS sections. The shipped rows
 * are matched by `body_part`, and a Cervical row can be authored to screen the whole
 * spine ("MRI Cervical Spine with Whole Spine Screening", `study_type`
 * SCREENING_WHOLE_SPINE), so the row for a region is not automatically the row whose
 * coverage that region documents.
 *
 * Measured in the real workspace at main (PR #967 + PR #970), on a study booked
 * "MRI Whole Spine Screening" whose recorded move to Cervical Spine had just been
 * hydrated from the draft: opening the study wrote
 *
 *     Screening — Dorsal Spine:  Normal alignment and vertebral marrow signal…
 *     Screening — Lumbosacral Spine: … Conus and cauda equina normal on screening sagittals.
 *     Screening — Cord Signal / Sacrum / Vertebral Marrow
 *
 * into Findings before anyone pressed anything, with provenance `template`, while the
 * printed page (PR #970) said the report documented Cervical Spine. Two mechanisms made
 * it happen and both are under test here: the picker's name-only fallback reached across
 * body parts, and nothing capped a row whose declared coverage was wider than the
 * recorded decision.
 *
 * Nothing edits a row. A template the radiologist picks from the Templates list is their
 * decision and is never filtered here; this governs only what CARE applies by itself.
 */
import { describe, expect, it } from "vitest";
import { pickStructuredTemplateForRegion, type StructuredTemplateRow } from "./pickStructuredTemplate";
import {
  documentedCoverageCeiling,
  type RegionTransitionRecord,
} from "./regionTransition";
import type { SpineCoverageSegment } from "@workspace/report-quality";

/** The shipped MRI spine rows, same body parts / study types / names. */
const ROWS: StructuredTemplateRow[] = [
  { id: 4, templateName: "MRI LS Spine", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN", isDefault: true },
  { id: 5, templateName: "MRI Cervical Spine", modality: "MRI", bodyPart: "SPINE_CERVICAL", studyType: "PLAIN", isDefault: true },
  { id: 6, templateName: "MRI Dorsal Spine", modality: "MRI", bodyPart: "SPINE_DORSAL", studyType: "PLAIN", isDefault: true },
  { id: 7, templateName: "MRI LS Spine with Whole Spine Screening", modality: "MRI", bodyPart: "SPINE_LS", studyType: "SCREENING_WHOLE_SPINE" },
  { id: 8, templateName: "MRI Cervical Spine with Whole Spine Screening", modality: "MRI", bodyPart: "SPINE_CERVICAL", studyType: "SCREENING_WHOLE_SPINE" },
  { id: 1, templateName: "MRI Brain Plain", modality: "MRI", bodyPart: "BRAIN", studyType: "PLAIN", isDefault: true },
];

/** The same pool with the clinic's own default moved onto the screening row. */
const WIDE_DEFAULT: StructuredTemplateRow[] = ROWS.map((r) =>
  r.id === 8 ? { ...r, isDefault: true } : r.id === 5 ? { ...r, isDefault: false } : r,
);

const seg = (...s: SpineCoverageSegment[]) => new Set<SpineCoverageSegment>(s);
const WHOLE = seg("cervical", "dorsal", "lumbar");

function moved(toRegion: string, fromRegion = "Whole Spine"): RegionTransitionRecord {
  return {
    kind: "care.region_transition.v1",
    fromRegion,
    toRegion,
    retired: [],
    keptAbnormalities: [],
    manualLinesPreserved: 0,
    decidedBy: "Dr Abinash Kumar",
    at: "2026-10-13T04:00:00.000Z",
  };
}

const pick = (
  region: string,
  ceiling: Set<SpineCoverageSegment> | null = null,
  rows: StructuredTemplateRow[] = ROWS,
) => pickStructuredTemplateForRegion(rows, "MR", region, ceiling)?.id ?? null;

describe("the ceiling itself — what the two decisions agree on", () => {
  it("C1 a recorded move narrows; it never widens", () => {
    expect([...documentedCoverageCeiling({
      source: "billed",
      regions: ["Cervical Spine"],
      records: [moved("Cervical Spine")],
    })!]).toEqual(["cervical"]);
  });

  it("C2 the reloaded reading is the booked one, and the record still caps it", () => {
    // The state the browser was in: the control re-read "Whole Spine" from the booking
    // while the recorded move to Cervical Spine sat hydrated in the store.
    const ceiling = documentedCoverageCeiling({
      source: "billed",
      regions: ["Whole Spine"],
      records: [moved("Cervical Spine")],
    });
    expect([...ceiling!].sort()).toEqual(["cervical"]);
  });

  it("C3 no record caps nothing", () => {
    expect(documentedCoverageCeiling({ source: "billed", regions: ["Whole Spine"], records: [] })).toBeNull();
    expect(documentedCoverageCeiling({ source: "auto", regions: ["Cervical Spine"], records: null })).toBeNull();
  });

  it("C4 an explicit region choice caps the report at exactly what was chosen", () => {
    // Widening back out is what the control is FOR, and choosing the whole spine says it
    // explicitly: the ceiling then admits the screening document instead of refusing it.
    expect([...documentedCoverageCeiling({
      source: "override",
      regions: ["Whole Spine"],
      records: [moved("Cervical Spine")],
    })!]).toEqual(["cervical", "dorsal", "lumbar"]);
    // The same control answering "Cervical Spine" declares the cervical spine, not the
    // examination the booking happens to name. The first version of this rule answered
    // "no opinion" for every explicit choice, and the browser measured what that cost:
    // immediately after the radiologist had narrowed the report by hand, Generate applied
    // "MRI Cervical Spine with Whole Spine Screening" and wrote the dorsal and
    // lumbosacral sentences back over the top of it.
    expect([...documentedCoverageCeiling({
      source: "override",
      regions: ["Cervical Spine"],
      records: [moved("Cervical Spine")],
    })!]).toEqual(["cervical"]);
    expect([...documentedCoverageCeiling({
      source: "override",
      regions: ["Cervical Spine", "LS Spine"],
      records: [],
    })!]).toEqual(["cervical", "lumbar"]);
    // A study that is not the spine still gets no spine opinion from this module.
    expect(documentedCoverageCeiling({
      source: "override", regions: ["Brain"], records: [],
    })).toBeNull();
  });

  it("C5 the last record wins, and the selection decides how wide that can be", () => {
    expect([...documentedCoverageCeiling({
      source: "billed",
      regions: ["Cervical Spine", "LS Spine"],
      records: [moved("Whole Spine"), moved("Cervical Spine")],
    })!]).toEqual(["cervical"]);
    // A later move out to the whole spine caps nothing that the current reading already
    // covers — but it cannot widen a report that is still being read as one segment.
    // Widening is the region selection's job, and selecting it is an explicit choice (C4).
    expect([...documentedCoverageCeiling({
      source: "billed",
      regions: ["Cervical Spine"],
      records: [moved("Cervical Spine"), moved("Whole Spine")],
    })!]).toEqual(["cervical"]);
    expect([...documentedCoverageCeiling({
      source: "billed",
      regions: ["Whole Spine"],
      records: [moved("Cervical Spine"), moved("Whole Spine")],
    })!].sort()).toEqual(["cervical", "dorsal", "lumbar"]);
  });

  it("C6 two spine decisions that share nothing leave an empty ceiling, not a wide one", () => {
    const ceiling = documentedCoverageCeiling({
      source: "billed",
      regions: ["LS Spine"],
      records: [moved("Cervical Spine")],
    });
    expect(ceiling).not.toBeNull();
    expect(ceiling!.size).toBe(0);
  });

  it("C7 a non-spine study gets no spine opinion from this module", () => {
    expect(documentedCoverageCeiling({
      source: "billed",
      regions: ["Brain"],
      records: [],
    })).toBeNull();
  });
});

describe("the picker honours the ceiling", () => {
  it("T1 a whole-spine study is never handed another region's dedicated row", () => {
    // There is no SPINE_WHOLE row in this clinic. Falling back to any row whose NAME
    // says "whole spine" selected the LS or the Cervical row — a report whose dedicated
    // sections were one segment's, for an examination that is all three.
    expect(pick("Whole Spine")).toBeNull();
    // …and it is the fallback that did it, not the pool: the rows exist.
    expect(ROWS.filter((r) => /whole spine screening/i.test(r.templateName)).length).toBe(2);
  });

  it("T2 the region's own default still applies, ceiling or no ceiling", () => {
    expect(pick("Cervical Spine")).toBe(5);
    expect(pick("Cervical Spine", seg("cervical"))).toBe(5);
    expect(pick("LS Spine", WHOLE)).toBe(4);
    expect(pick("Dorsal Spine")).toBe(6);
    expect(pick("Brain")).toBe(1);
  });

  it("T3 a cervical report does not take the screening row when a plain one exists", () => {
    // The clinic has made the wide row its Cervical default. Applying it writes
    // "Screening — Dorsal Spine / Lumbosacral Spine / Vertebral Marrow…" — normals for
    // segments this report's own record retired. The plain row says nothing they claim.
    expect(pick("Cervical Spine", seg("cervical"), WIDE_DEFAULT)).toBe(5);
  });

  it("T4 with no recorded decision the clinic's own default still opens", () => {
    // A cervical examination booked WITH whole spine screening documents that coverage in
    // the booking itself. Nothing here overrules a clinic's declared default while no
    // radiologist decision says otherwise.
    expect(pick("Cervical Spine", null, WIDE_DEFAULT)).toBe(8);
  });

  it("T5 a ceiling that covers the screening segments keeps the screening row reachable", () => {
    expect(pick("Cervical Spine", WHOLE, WIDE_DEFAULT)).toBe(8);
    expect(pick("LS Spine", WHOLE, ROWS.map((r) => (r.id === 7 ? { ...r, isDefault: true } : r.id === 4 ? { ...r, isDefault: false } : r)))).toBe(7);
  });

  it("T6 an empty ceiling applies no template rather than a partial one", () => {
    expect(pick("Cervical Spine", seg())).toBeNull();
    expect(pick("LS Spine", seg(), WIDE_DEFAULT)).toBeNull();
  });

  it("T7 refusal never invents: a row of another body part is not a fallback", () => {
    // Every cervical row is capped; the answer is "no template", not the brain or LS one.
    const onlyWideCervical = ROWS.filter((r) => r.id === 8 || r.id === 1);
    expect(pickStructuredTemplateForRegion(onlyWideCervical, "MR", "Cervical Spine", seg("cervical"))).toBeNull();
  });

  it("T8 the modality filter still comes first", () => {
    expect(pickStructuredTemplateForRegion(ROWS, "CT", "Cervical Spine", seg("cervical"))).toBeNull();
  });
});

/**
 * The four automatic sites are what put prose on the page by themselves, so each one has
 * to pass the ceiling. Read out of the shipped source, bounded on the call itself: a
 * refactor that drops the argument must fail here, not in the clinic.
 */
describe("every automatic template application passes the ceiling", () => {
  it("T9 all four call sites of pickStructuredTemplateForRegion carry coverageCeiling", async () => {
    const { readFileSync } = await import("node:fs");
    const file = new URL("../hooks/useReportingStudySetup.ts", import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, "$1");
    const text = readFileSync(file, "utf8");
    const calls = text.split("pickStructuredTemplateForRegion(").slice(1);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      // Bound on the closing parenthesis of the call, not a character budget.
      const args = call.slice(0, call.indexOf(")"));
      expect(args).toContain("coverageCeiling");
    }
    // and the ceiling is computed from the record, not from a second region engine
    expect(text).toContain("documentedCoverageCeiling(");
    expect(text).toContain("regionTransitions");
  });
});
