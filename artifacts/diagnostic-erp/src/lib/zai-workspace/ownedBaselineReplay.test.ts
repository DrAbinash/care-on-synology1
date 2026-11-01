/**
 * The clinic's OWN thirteen owned baselines survive the replay intact.
 *
 * The owner's release condition (2026-11-01) was "Confirm that all 13 existing single-sentence
 * baselines remain unchanged." Measured against `radiology_snippets` where `type='report_format'`
 * and a `baseline_manifest` exists, there are 13 such rows — and NONE of them is single-sentence:
 * every one carries exactly one Impression observation stating TWO OR THREE sentences
 * (`tmp/rig/j59-impression-observation-census.mjs`). The condition as written was therefore
 * checking a fact that does not hold; what matters is the same thing one level up, so this file
 * pins it for each real row:
 *
 *   every Impression sentence the row authored is still on the report after an automatic pass,
 *   the Impression and Findings do not move at all between the press and the pass, and the
 *   screening rows keep the coverage sentence that stops a screening study reading as diagnostic.
 *
 * The rows are the committed fixture, captured 2026-11-01, not hand-written stand-ins: a proof
 * about "all 13" has to read the 13. Twelve are the clinic's own library rows; row 62 is the
 * combined Brain + Cervical Spine normal this work authored for the rig
 * (`tmp/rig/seed-combined-normal.mjs`, revision `synthetic.brain-cspine.v4`) — named here because
 * it is the one row in the fixture a production library does not yet carry.
 *
 * Reading the 13 is what found the second half of the defect. The sweep guard (a replay may not
 * withdraw a sentence a live row stands behind) was not enough: a replayed FINDINGS row reaches
 * the impression field with no Impression text of its own, recognised the screening rows'
 * coverage sentence as one it owns, and evicted it with nothing to write back — so the sentence
 * was gone before the sweep ran. `patchField` now refuses eviction on a replay outright. Measured
 * with `tmp/rig/j80-dump-baselines.mjs` + this file: 6 of the 13 lost a sentence on `main`, 5
 * still lost one with the sweep guard alone, and none loses one with both.
 */
import { describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { ReportFormat } from "@/lib/zai-workspace/types";
import baselines from "./__fixtures__/ownedReportBaselines.json";

type Row = typeof baselines.rows[number];

/** The examination each owned row speaks for. #62 is the pair; the rest are one region. */
const regionsFor = (row: Row): string[] =>
  row.sourceRowId === 62 ? ["Brain", "Cervical Spine"] : [row.bodyPart ?? "Brain"];

const asGeneratorCtx = (regions: string[]) => {
  const c = buildReportingStudyContext({
    modality: "MR", studyDescription: `MRI ${regions.join(" + ")}`, regions,
    source: regions.length > 1 ? "override" : "billed",
  });
  return {
    modality: c.modality, region: c.region, regions: c.regions, source: c.source,
    protocolName: c.protocolName, studyDescription: c.studyDescription,
  };
};

const formatFor = (row: Row): ReportFormat => ({
  id: `f-${row.sourceRowId}`, name: row.label, modality: row.modality ?? "MR",
  bodyPart: row.bodyPart, isCompleteNormal: true,
  findings: row.findingsText ?? "", impression: row.impressionText ?? "",
  technique: row.techniqueText ?? "",
  baselineManifest: row.manifest as unknown as ReportFormat["baselineManifest"],
} as unknown as ReportFormat);

const sentences = (t: string) => t.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);

function cleanCanvas(formats: ReportFormat[], regions: string[]) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: "",
    fieldProvenance: {}, appliedPathologyPatches: [], patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, mergePreviewOpen: false, pendingPathologyPatch: null,
    pendingFormatIds: [], pendingFormatOverwrite: null, pendingNormalReplacement: null,
    isFinalized: false, isFinalizing: false, isDirty: false, impressionOrderFrozen: false,
    regionTransitions: [], reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: `MRI ${regions.join(" + ")}`, regions,
      source: regions.length > 1 ? "override" : "billed",
    }),
    reportFormats: formats, reportFormatPickerOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    normalLinesRemovedByRadiologist: [], impressionNeedsRefresh: false,
  });
}

const rows = baselines.rows;

describe("every owned Full Report baseline the clinic ships", () => {
  it("is thirteen rows, each with exactly one multi-sentence Impression observation", () => {
    expect(rows).toHaveLength(13);
    for (const row of rows) {
      const impressions = (row.manifest.observations ?? []).filter((o) => o.field === "impression");
      expect(impressions, `#${row.sourceRowId} ${row.label}`).toHaveLength(1);
      expect(sentences(impressions[0].renderedText ?? "").length,
        `#${row.sourceRowId} ${row.label} states one sentence, not several`)
        .toBeGreaterThan(1);
    }
  });

  it("keeps every authored Impression sentence through a second automatic pass", () => {
    for (const row of rows) {
      const before = useWorkspace.getState();
      try {
        const regions = regionsFor(row);
        cleanCanvas([formatFor(row)], regions);
        const press = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(regions));
        expect(press.status, `#${row.sourceRowId} ${row.label} never built its normal`).toBe("generated");
        const afterPress = {
          impression: useWorkspace.getState().impressionText,
          findings: useWorkspace.getState().findingsText,
          technique: useWorkspace.getState().techniqueText,
        };
        const pass = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(regions), {
          automatic: true, requireOwnedApprovedNormal: true,
        });
        expect(pass.status, `#${row.sourceRowId} ${row.label} refused the automatic pass`).toBe("generated");
        const s = useWorkspace.getState();
        // Nothing disappeared, and nothing moved: the pass that follows a normal report is a
        // rebuild, not an edit.
        const authored = (row.manifest.observations ?? []).filter((o) => o.field === "impression")
          .flatMap((o) => sentences(o.renderedText ?? ""));
        for (const sentence of authored) {
          expect(s.impressionText, `#${row.sourceRowId} ${row.label} lost "${sentence}" on replay`)
            .toContain(sentence);
        }
        expect(s.impressionText, `#${row.sourceRowId} ${row.label} rewrote the Impression`)
          .toBe(afterPress.impression);
        expect(s.findingsText, `#${row.sourceRowId} ${row.label} rewrote the Findings`)
          .toBe(afterPress.findings);
        expect(s.techniqueText, `#${row.sourceRowId} ${row.label} rewrote the Technique`)
          .toBe(afterPress.technique);
        expect(s.findingsText.split("\n").map((l) => l.trim()).filter(Boolean),
          `#${row.sourceRowId} ${row.label} duplicated a Findings line`)
          .toEqual([...new Set(s.findingsText.split("\n").map((l) => l.trim()).filter(Boolean))]);
      } finally {
        useWorkspace.setState(before);
      }
    }
  });

  it("keeps the coverage sentence the five screening rows state their limitation with", () => {
    const screening = rows.filter((r) => /Screening/i.test(r.label ?? ""));
    expect(screening.length).toBeGreaterThan(0);
    let rowsWithALimitation = 0;
    for (const row of screening) {
      const before = useWorkspace.getState();
      try {
        const regions = regionsFor(row);
        cleanCanvas([formatFor(row)], regions);
        useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(regions));
        useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(regions), {
          automatic: true, requireOwnedApprovedNormal: true,
        });
        const impression = useWorkspace.getState().impressionText;
        // The row's OWN limitation statement, not any sentence that happens to contain the
        // word "screening" — the first version of this test passed while the report had lost
        // the coverage sentence, because "Normal MRI cervical spine screening." matched it.
        const authoredLimitation = (row.manifest.observations ?? [])
          .filter((o) => o.field === "impression")
          .flatMap((o) => sentences(o.renderedText ?? ""))
          .filter((s) => /limited/i.test(s));
        // Not every row whose NAME says screening states its limitation in the Impression — the
        // combined row says "on screening" and says nothing about sequences. The claim this test
        // makes is about rows that DO state it, so a row that doesn't is skipped, not failed.
        if (authoredLimitation.length === 0) continue;
        rowsWithALimitation += 1;
        for (const s of authoredLimitation) {
          expect(impression, `#${row.sourceRowId} ${row.label} no longer says the study was limited`)
            .toContain(s);
        }
      } finally {
        useWorkspace.setState(before);
      }
    }
    expect(rowsWithALimitation, "the fixture's screening rows no longer state a limitation")
      .toBe(5);
  });
});
