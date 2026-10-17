/**
 * The cervical Quick Select catalogue, measured against the cervical normal it
 * is clicked on.
 *
 * Thirty-four boxes replaced one, and a box is only safe if clicking it cannot
 * leave the report denying itself. Every claim here is checked against the real
 * store, the real shipped baseline manifest and the real content pack — not
 * against a fixture — because the thing under test is a sentence a radiologist
 * will sign.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch, tileRowId } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import { MRI_CERVICAL_STANDARD_NORMAL_MANIFEST, MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST } from "./fullReportBaseline";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { extractLevel } from "@/lib/observationSlot";
import { canonicalConceptTokens, normaliseConceptKey } from "@/lib/conceptCanon/conceptCanon";
import { CLINICAL_CONTENT_PACKS } from "@/lib/conceptCanon/contentPacks";
import { levelsForCanalSegment } from "@/lib/spineCanalAp";

function cervicalCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Cervical Spine",
    regions: ["Cervical Spine"],
    source: "auto",
  });
}

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: cervicalCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false,
    isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(cervicalCtx());
}

const CERVICAL_TILES = DEFAULT_QUICK_SELECT_TILES.filter(
  (t) => t.scopeBodyPart === "Cervical Spine" && t.field === "findings",
);

const BASELINE_ROWS = (MRI_CERVICAL_STANDARD_NORMAL_MANIFEST.observations ?? []).filter(
  (o) => o.field === "findings",
);

/**
 * Which of the scaffold's own normal sentences this text denies.
 *
 * The subject is the content pack's alias list, not a synonym table invented
 * here, so a concept the pack renames is caught the same day the pack changes.
 * A clause that denies ("…without nerve root compression.") asserts nothing, so
 * it retires nothing — that is `assertsAbnormality`'s job, the same function the
 * Conclusion picker uses.
 *
 * A sentence that names no disc level cannot falsify a sentence pinned to one:
 * "C5-C6: Neural foramina are patent bilaterally." is about C5-C6, and a
 * study-wide statement about some other site leaves it standing.
 */
function contradictedRows(text: string, rows = BASELINE_ROWS): Set<string> {
  const out = new Set<string>();
  for (const clause of splitToSentences(text)) {
    if (!assertsAbnormality(clause)) continue;
    const hay = normaliseConceptKey(clause);
    const clauseLevel = extractLevel(clause);
    for (const row of rows) {
      const tokens = canonicalConceptTokens(row.concept);
      if (tokens.length === 0) continue;
      if (!tokens.some((tok) => hay.includes(tok))) continue;
      const rowLevel = row.level ?? "";
      if (rowLevel !== "" && rowLevel !== clauseLevel) continue;
      out.add(row.renderedText.trim());
    }
  }
  return out;
}

function applyTile(tile: (typeof CERVICAL_TILES)[number]) {
  const side = /\{side\}/i.test(tile.sentence) ? "right" : undefined;
  const outcome = useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", side ? { side } : {}));
  return { outcome, findings: () => useWorkspace.getState().findingsText };
}

describe("the cervical Quick Select catalogue", () => {
  beforeEach(() => reset());

  it("has a real catalogue to measure", () => {
    // Without this the scan below is vacuously true on an empty list — which is
    // exactly how a deleted section reads as a pass.
    expect(CERVICAL_TILES.length).toBeGreaterThanOrEqual(30);
    expect(BASELINE_ROWS.length).toBeGreaterThanOrEqual(44);
  });

  it("no box can be clicked without retiring every normal it denies", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const tile of CERVICAL_TILES) {
      reset();
      const { outcome, findings } = applyTile(tile);
      expect(outcome, `${tile.label} was not applied`).toBe("applied");
      const text = findings();
      const denied = new Set([
        ...contradictedRows(tile.sentence),
        ...contradictedRows(tile.impressionSentence ?? ""),
      ]);
      checked += denied.size;
      for (const row of denied) {
        if (text.includes(row)) offenders.push(`${tile.label} leaves standing: ${row}`);
      }
    }
    // The scan has to be looking at something: measured 23 (box → normal) pairs
    // over 36 boxes on the day this landed, so a matcher that quietly stopped
    // matching drops the number and fails here rather than passing empty.
    expect(checked).toBeGreaterThanOrEqual(23);
    expect(offenders).toEqual([]);
  });

  it("clears a normal it contradicts even when no shared word gives it away", () => {
    // The scan above pairs a box with a normal by the content pack's own words.
    // Five pairs are clinical denials that share no phrase — "T2 hyperintense
    // signal within the cervical cord" does not contain the words "cord signal" —
    // and are retired by the ledger's slot identity or by an explicit
    // `baselineReplaces`. Named here so the judgement is visible and checkable
    // instead of hidden inside a matcher.
    const EXPLICIT: Array<[string, string[]]> = [
      ["Cord signal change", ["Cervical spinal cord signal intensity is normal."]],
      ["Cord compression C5-C6", [
        "No cord compression is seen.",
        "C5-C6: No spinal canal or thecal sac compression is seen.",
      ]],
      ["Cervical syrinx", ["Cervical spinal cord signal intensity is normal."]],
      ["Intramedullary cord lesion", ["Cervical spinal cord signal intensity is normal."]],
    ];
    const offenders: string[] = [];
    let asserted = 0;
    for (const [label, rows] of EXPLICIT) {
      const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
      expect(tile, `no cervical box labelled ${label}`).toBeDefined();
      reset();
      const { outcome, findings } = applyTile(tile!);
      expect(outcome, `${label} was not applied`).toBe("applied");
      for (const row of rows) {
        asserted += 1;
        if (findings().includes(row)) offenders.push(`${label} leaves standing: ${row}`);
      }
    }
    expect(asserted).toBe(5);
    expect(offenders).toEqual([]);
  });

  it("leaves the levels the box does not describe alone", () => {
    // The other half of the claim: a C5-C6 finding must not silence C2-C3.
    reset();
    applyTile(DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation C5-C6")!);
    const text = useWorkspace.getState().findingsText;
    expect(text).toContain("C2-C3: No significant disc bulge or protrusion is seen.");
    expect(text).toContain("C6-C7: No significant disc bulge or protrusion is seen.");
    expect(text).toContain("C7-T1: No significant disc bulge or protrusion is seen.");
    expect(text).not.toContain("C5-C6: No significant disc bulge or protrusion is seen.");
  });

  it("gives the C7-T1 disc the same coverage as the other five", () => {
    // The canvas draws six cervical disc levels and the canal table measures six;
    // the owned normal described five, so a C7-T1 herniation arrived at a report
    // that had never claimed C7-T1 was normal and could not be shown to be.
    expect(levelsForCanalSegment("cervical")).toEqual([
      "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
    const described = new Set(BASELINE_ROWS.map((o) => o.level).filter(Boolean));
    expect([...described].sort()).toEqual(["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"]);
  });

  it("borrows no advice that no Report Format gives", () => {
    // The tile catalogue's standing rule, checked for every box in the product
    // rather than only the new ones: the sentence in Recommendation is copied
    // from a shipped Report Format of the same examination, or it is not written.
    const offenders: string[] = [];
    const crossExamination: string[] = [];
    for (const tile of DEFAULT_QUICK_SELECT_TILES) {
      if (!tile.recommendationSentence) continue;
      const wanted = tile.recommendationSentence.trim();
      const sameExamination = DEFAULT_REPORT_FORMATS.some(
        (f) =>
          f.modality === tile.scopeModality &&
          f.bodyPart === tile.scopeBodyPart &&
          (f.recommendation ?? "").trim() === wanted,
      );
      if (sameExamination) continue;
      // Still a real shipped sentence, just one belonging to another examination.
      if (DEFAULT_REPORT_FORMATS.some((f) => (f.recommendation ?? "").trim() === wanted)) {
        crossExamination.push(tile.label);
        continue;
      }
      offenders.push(`${tile.label} :: ${wanted}`);
    }
    expect(offenders).toEqual([]);
    // One box does this today, and it is named rather than absorbed: `SDH` is a
    // CT tile quoting the MRI subdural format, because the library has no CT
    // subdural Report Format. Inventing one is a content-pack decision, not a
    // tile edit, so the exception is pinned and a second one fails the build.
    expect(crossExamination).toEqual(["SDH"]);
  });

  it("puts a finding in the Conclusion only when the content pack says it belongs there", () => {
    const offenders: string[] = [];
    for (const tile of CERVICAL_TILES) {
      const pack = CLINICAL_CONTENT_PACKS.find((p) => p.concept === tile.concept);
      if (!pack) continue;
      if (tile.impressionSentence && pack.impressionworthyAbnormal !== true) {
        offenders.push(`${tile.label} → ${tile.concept} is not impression-worthy`);
      }
    }
    expect(offenders).toEqual([]);
    // And the rule has something to say: two of the cervical concepts are
    // deliberately without a Conclusion line because the pack does not rank them.
    expect(CERVICAL_TILES.filter((t) => !t.impressionSentence).length).toBeGreaterThanOrEqual(6);
  });

  it("knows every normal it is expected to contradict", () => {
    // A baseline row whose concept the content pack does not carry is invisible to
    // the scan above — `canonicalConceptTokens` returns [] rather than guessing.
    // One such row ships today, and no box in the catalogue touches it; if a
    // second appears, or a box starts contradicting this one, say so here.
    const blind = [...new Set(
      BASELINE_ROWS.filter((o) => canonicalConceptTokens(o.concept).length === 0).map((o) => o.concept),
    )];
    expect(blind).toEqual(["paraspinal"]);
  });

  it("does not keep the normal's own Conclusion once a box has contradicted it", () => {
    // The Findings body retires the level's normal (above), and the Conclusion
    // has to retire the scaffold's normal sentence with it: "No significant disc,
    // canal, foraminal or cord compressive abnormality." printed beside
    // "Disc herniation at C5-C6." is one report answering itself.
    reset();
    const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation C5-C6")!;
    applyTile(tile);
    useWorkspace.getState().generateProfessionalReport(cervicalCtx());
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toContain("Disc herniation at C5-C6.");
    expect(impression).not.toMatch(/No significant disc, canal, foraminal or cord compressive abnormality/);
    expect(impression).not.toMatch(/Normal MRI of the cervical spine/);
  });

  it("restores the normal when the box is deselected", () => {
    // Retirement, not deletion: the same click that took the scaffold's sentence
    // away has to give it back, or a report edited by reflex loses information.
    const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation C5-C6")!;
    reset();
    applyTile(tile);
    expect(useWorkspace.getState().findingsText).not.toContain(
      "C5-C6: No significant disc bulge or protrusion is seen.",
    );
    expect(useWorkspace.getState().removeObservation(tileRowId(tile))).toBe("removed");
    expect(useWorkspace.getState().findingsText).toContain(
      "C5-C6: No significant disc bulge or protrusion is seen.",
    );
  });
});

describe("the scan's own semantics", () => {
  /**
   * The denial arm needs a fixture or it measures nothing, and no box in the
   * cervical catalogue supplies one — none of them denies a concept the scaffold
   * also owns. The shipped lumbar herniation box does: it asserts its own disc
   * contour, and then says "No significant central canal stenosis.", which
   * AGREES with the canal normal instead of contradicting it. Read here both to
   * reach that arm and to put a measured number, not a claim, in the record for
   * the lumbar box that this PR leaves as it ships.
   */
  it("reads a denial as agreement", () => {
    const lsRows = (MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST.observations ?? []).filter(
      (o) => o.field === "findings",
    );
    const herniation = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;
    const denied = [...contradictedRows(herniation.sentence, lsRows)];
    // Measured, in full, the day this landed: one row, the disc contour the box
    // owns. "No significant central canal stenosis." agrees with the canal
    // normal rather than contradicting it, so it is not in the list — remove the
    // denial arm and the canal row appears here and this fails.
    expect(denied).toEqual(["L4-L5: No significant disc bulge or protrusion is seen."]);
    // And the limit of the method, recorded where it can be seen. The same box
    // also writes "mild narrowing of bilateral neural foramina" beside the
    // scaffold's "Neural foramina are patent bilaterally." — a real
    // contradiction that this scan does NOT read, because no alias of
    // `foraminal_stenosis` in the content pack matches that word order. Recall
    // is the pack's vocabulary, not a synonym table invented for the test, so
    // the lumbar box is left as it ships (five suites pin its sentence) and the
    // cervical catalogue is authored one concept per box instead, so that no
    // sentence like this has to be caught after the fact.
    expect(denied.some((row) => /Neural foramina are patent/i.test(row))).toBe(false);
  });

  it("does not read a denial as a reason to retire the row it restates", () => {
    // The scaffold's own sentence, which is exactly the shape of the defect PR C
    // was written for: it carries two disc-contour aliases (`bulge`,
    // `protrusion`), so without the denial arm the scan demands the report retire
    // a line that says nothing abnormal. The content-wide ratchet in
    // `generateProfessionalReport.test.ts` is what keeps that true of every
    // shipped baseline sentence, not of one fixture. Measured, not assumed: the
    // canal sentence below does NOT reach that arm, because no alias of
    // `canal_stenosis` matches "No spinal canal or thecal sac compression" — the
    // same vocabulary limit recorded above, and why this fixture had to be chosen
    // by reading the pack rather than by picking any denial.
    expect([...contradictedRows("C5-C6: No significant disc bulge or protrusion is seen.")]).toEqual([]);
    expect([...contradictedRows("C5-C6: No spinal canal or thecal sac compression is seen.")]).toEqual([]);
  });
});
