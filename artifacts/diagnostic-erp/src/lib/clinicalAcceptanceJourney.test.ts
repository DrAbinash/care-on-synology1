/**
 * CLINICAL ACCEPTANCE — EXECUTABLE (owner directive 2026-10-19: "Actually run the
 * acceptance scenarios. Do not merely change their status strings.")
 *
 * The acceptance specification (lib/db/src/clinicalAcceptanceSpec.ts) holds twenty
 * cases as DATA, every one `specified-not-executed`, and its own test suite enforces
 * that single-member status union — widening it is a Stage C act the owner has not
 * ratified, so this file does NOT touch it. What it does instead is EXECUTE the
 * journeys against the real engine — the real store, the real shipped tiles, the
 * real Mode A entry the workspace debounce calls, the real server envelope compose
 * and the real PDF generator — and name, in each title, the spec case and the
 * owner's TEST number it discharges. A case that needs the dormant v4 catalogue to
 * exist (T3's combination rule, T8's parameter snapshot, T10's
 * requires_only_members, T19's publication versioning) is honestly out of reach of
 * the current engine and is not claimed here.
 *
 * HOW A STUDY OPENS, as the live workspace opens it: Mode A is on by default, the
 * normal bootstrap applies the resolver's own approved normal format, and the
 * debounced pass composes through `composeInstantReport` — the same entry this
 * suite drives. For examinations whose only normals are un-approved prose (CT, XR,
 * MG today have no approved baseline manifest), Mode A correctly declines to build
 * automatically (instantReport A2), so those journeys start from the format the
 * radiologist applies — exactly what the format button does.
 *
 * The ten priority journeys are the owner's own list, on MRI lumbar spine:
 * open a normal report; select abnormalities; watch Findings and Impression
 * update; edit freely; save, reopen, print. This is the mission's definition of
 * done, executed.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS as FORMATS, type ReportFormat } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import type { QuickSelectParameterValues } from "./zai-workspace/quickSelectParameterContract";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { extractCareObservationLedger } from "./observationLedger";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { createInstrumentedPdf } from "./testSupport/instrumentedPdf";
import {
  buildCareStructuredJsonPatch,
  composeStructuredJsonColumn,
} from "../../../api-server/src/lib/structuredJsonColumn";

const LS_NORMAL_FORMAT = FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const CT_NORMAL = FORMATS.find((f) => f.name === "CT Brain — Normal")!;
const XR_NORMAL = FORMATS.find((f) => f.name === "XR LS Spine — Normal")!;
const MG_BIRADS2 = FORMATS.find((f) => f.name === "MG Breast — BI-RADS 2 (Benign)")!;

function tile(label: string): QuickSelectTile {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

const LORDOSIS = tile("Loss of lumbar lordosis");
const BULGE = tile("Disc herniation L4-L5");
const LF = tile("LF hypertrophy L4-L5");

type Ctx = ReturnType<typeof buildReportingStudyContext>;

/** The workspace's clinical shell, reset the way opening a study resets it. */
function resetShell(ctx: Ctx): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: ctx,
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [], isFinalized: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {},
    regionTransitions: [],
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null,
    appliedPatternMarkers: [],
  });
}

/**
 * Open a study the way the workspace opens it. When `autoCompose` is true this is
 * the Mode A journey — the debounced `composeInstantReport` pass builds the
 * complete approved normal with no format pressed and no network call. When it is
 * false the radiologist applies the format themselves (the format button), which
 * is the only honest start for examinations without an approved baseline.
 */
function openStudy(ctx: Ctx, format?: ReportFormat, autoCompose = true): void {
  resetShell(ctx);
  if (autoCompose) {
    const decision = useWorkspace.getState().composeInstantReport(ctx, false);
    expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
  } else {
    useWorkspace.getState().applyFormatById(format!.id);
  }
}

const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function openLumbarStudy(): void {
  openStudy(lsCtx());
}

function click(tileToClick: QuickSelectTile, params?: QuickSelectParameterValues): void {
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tileToClick, "findings", params),
  );
  if (outcome !== "applied") throw new Error(`${tileToClick.label} click was ${outcome}`);
}

const S = () => useWorkspace.getState();
const findingsOf = () => S().findingsText;
const impressionOf = () => S().impressionText;
const sentencesOf = (text: string): string[] =>
  splitToSentences(text).map(normalizeForDedupe).filter(Boolean).sort();
const has = (sentence: string) => normalizeForDedupe(findingsOf()).includes(normalizeForDedupe(sentence));

/** The Quick Select row id for a concept — the row the strip's deselect uses. */
const qsRowIdByConcept = (concept: string): string => {
  const row = S().appliedPathologyPatches.find(
    (p) => !p.stale && p.observation?.concept === concept && String(p.id).startsWith("qf-"),
  );
  if (!row) throw new Error(`no clicked Quick Select row for concept ${concept}`);
  return row.id;
};

/** The Mode A pass the debounce runs — the live entry, not the raw engine. */
const recompose = () => S().composeInstantReport(lsCtx(), false);

describe("clinical acceptance journeys — executed against the real engine", () => {
  describe("MRI lumbar spine — the ten priority journeys (structurally discharges spec T1, T4, T6, T7, T12, T13, T14, T18, T20)", () => {
    it("TEST 1 / spec T1: opening the study composes the complete normal report, deterministically", () => {
      openLumbarStudy();
      // Correct examination title, appropriate editable technique.
      expect(S().appliedFormatReportTitle).toBe("MRI LUMBOSACRAL SPINE");
      expect(S().techniqueText).toMatch(/MRI lumbo-sacral spine on 3T/);
      // Complete anatomy-specific normal findings: general + every level, each once.
      expect(has("Normal lumbar lordosis is maintained.")).toBe(true);
      expect(has("Conus medullaris terminates at L1 and appears normal.")).toBe(true);
      for (const level of ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]) {
        expect(has(`${level}: Intervertebral disc signal is preserved.`), `${level} disc signal normal missing`).toBe(true);
        expect(has(`${level}: No significant disc bulge or protrusion is seen.`), `${level} contour normal missing`).toBe(true);
        expect(has(`${level}: Neural foramina are patent bilaterally.`), `${level} foramina normal missing`).toBe(true);
      }
      // Appropriate normal impression; recommendations are present, not boilerplate.
      expect(impressionOf()).toBe("Normal MRI of the lumbosacral spine. No significant disc, canal, foraminal or neural compressive abnormality.");
      expect(S().recommendationText).toMatch(/Clinical correlation/);
      expect(S().recommendationText).not.toMatch(/^No recommendations\.?$/i);
      // Every normal prints once, and the second pass writes nothing (idempotent).
      const all = sentencesOf(findingsOf());
      expect(new Set(all).size).toBe(all.length);
      const before = findingsOf();
      const second = recompose();
      expect(second.action).toBe("compose");
      expect(findingsOf()).toBe(before);
    });

    it("TEST 2: selecting loss of lumbar lordosis changes only the alignment claim", () => {
      openLumbarStudy();
      const before = sentencesOf(findingsOf());
      click(LORDOSIS);
      const after = sentencesOf(findingsOf());
      const removed = before.filter((s) => !after.includes(s));
      const added = after.filter((s) => !before.includes(s));
      // Only the alignment normal retires; only the lordosis claim arrives.
      expect(removed).toEqual([normalizeForDedupe("Normal lumbar lordosis is maintained.")]);
      expect(added).toEqual(sentencesOf("Straightening/loss of normal lumbar lordosis."));
      // Every other normal is untouched, and the impression no longer calls the
      // study normal over a selected abnormality.
      expect(has("Lumbar vertebral bodies demonstrate normal height and marrow signal.")).toBe(true);
      expect(has("L4-L5: Intervertebral disc signal is preserved.")).toBe(true);
      expect(impressionOf()).not.toMatch(/^Normal MRI of the lumbosacral spine/);
      // Owner ruling 2026-10-19: the alignment tile pushes no routine physiotherapy;
      // the Recommendation field keeps the normal study's advice and stays editable.
      expect(S().recommendationText).not.toMatch(/physiotherapy/i);
      expect(S().recommendationText).toMatch(/Clinical correlation/);
    });

    it("TEST 3 / spec T6: the L4-L5 disc bulge prints at its level and leaves other levels alone", () => {
      openLumbarStudy();
      click(BULGE);
      // The correct disc-level finding appears.
      expect(has(BULGE.sentence)).toBe(true);
      // The L4-L5 contour normal it contradicts is retired; no other level's is.
      expect(has("L4-L5: No significant disc bulge or protrusion is seen.")).toBe(false);
      for (const level of ["L1-L2", "L2-L3", "L3-L4", "L5-S1"]) {
        expect(has(`${level}: No significant disc bulge or protrusion is seen.`), `${level} contour normal was retired`).toBe(true);
      }
      expect(has("Normal lumbar lordosis is maintained.")).toBe(true);
      // The impression states the finding, and the study-normal claim is gone.
      expect(impressionOf()).toMatch(/Disc herniation at L4-L5/);
      expect(impressionOf()).not.toMatch(/^Normal MRI of the lumbosacral spine/);
    });

    it("TEST 4 / spec T7: ligamentum flavum hypertrophy coexists with the disc bulge", () => {
      openLumbarStudy();
      click(BULGE);
      click(LF);
      expect(has(BULGE.sentence)).toBe(true);
      expect(has(LF.sentence)).toBe(true);
      // The LF claim retires only its own normal.
      expect(has("Ligamentum flavum is not hypertrophied.")).toBe(false);
      expect(impressionOf()).toMatch(/Disc herniation at L4-L5/);
      expect(impressionOf()).toMatch(/Ligamentum flavum hypertrophy at L4-L5/);
      // No duplicate impression statements.
      const lines = impressionOf().split(/\n+/).map((l) => l.trim()).filter(Boolean);
      expect(new Set(lines.map(normalizeForDedupe)).size).toBe(lines.length);
    });

    it("TEST 5 / spec T12: deselecting the bulge restores its normal; the hypertrophy remains", () => {
      openLumbarStudy();
      click(BULGE);
      click(LF);
      useWorkspace.getState().removeObservation(qsRowIdByConcept("disc_contour"));
      recompose();
      // The bulge is gone; its level's contour normal is back; the hypertrophy stays.
      expect(has(BULGE.sentence)).toBe(false);
      expect(has("L4-L5: No significant disc bulge or protrusion is seen.")).toBe(true);
      expect(has("Ligamentum flavum is not hypertrophied.")).toBe(false);
      expect(has(LF.sentence)).toBe(true);
      expect(impressionOf()).not.toMatch(/Disc herniation at L4-L5/);
      expect(impressionOf()).toMatch(/Ligamentum flavum hypertrophy at L4-L5/);
    });

    it("TEST 6 / spec T14: the reverse selection order produces the clinically equivalent report", () => {
      const journeys: string[][] = [];
      for (const order of [[BULGE, LF], [LF, BULGE]]) {
        openLumbarStudy();
        click(order[0]!);
        click(order[1]!);
        journeys.push(sentencesOf(findingsOf()));
      }
      expect(journeys[1], "both click orders must carry the same findings sentences").toEqual(journeys[0]);
    });

    it("TEST 7 / spec T13: a manual finding edit survives the next Quick Select click and pass", () => {
      openLumbarStudy();
      const manualLine = "Small Schmorl node at the superior endplate of L2, typed by the radiologist.";
      useWorkspace.getState().setField("findings", manualLine, { source: "manual" });
      click(LF);
      expect(has(manualLine), "the manual sentence must survive the click untouched").toBe(true);
      expect(has(LF.sentence)).toBe(true);
      recompose();
      expect(has(manualLine), "and it must survive the Mode A pass too").toBe(true);
    });

    it("TEST 8 / spec T13: a manually authored Impression is never silently overwritten", () => {
      openLumbarStudy();
      const ownLine = "Clinical correlation advised for the radiculopathy described.";
      useWorkspace.getState().setField("impression", ownLine, { source: "manual" });
      click(LF);
      // The doctor's line survives, and the tile's own conclusion joins it.
      expect(impressionOf()).toContain(ownLine);
      expect(impressionOf()).toMatch(/Ligamentum flavum hypertrophy at L4-L5/);
      recompose();
      expect(impressionOf(), "the Mode A pass respects the doctor's authorship too").toContain(ownLine);
      expect(impressionOf()).not.toMatch(/^Normal MRI of the lumbosacral spine/);
    });

    it("TEST 9 / spec T18: save, close, reopen — same clinical meaning and same selections", () => {
      openLumbarStudy();
      click(BULGE);
      click(LF);
      const beforeFindings = sentencesOf(findingsOf());
      const beforeImpression = sentencesOf(impressionOf());
      const beforeTechnique = S().techniqueText;
      const beforeRecommendation = S().recommendationText;
      const beforeFindingsText = findingsOf();
      const beforeImpressionText = impressionOf();
      // "Same selections" means the Quick Select rows the strip lights up — the
      // baseline scaffold rows are the engine's own bookkeeping, and the shipped
      // hydration reconcile marks a scaffold row stale when its words are already
      // retired from the prose (flagged, never auto-deleted), which is not a
      // change of clinical meaning.
      const selectedIds = () => S().appliedPathologyPatches
        .filter((p) => !p.stale && String(p.id).startsWith("qf-"))
        .map((p) => p.observation?.concept ?? "").sort();
      const beforeSelected = selectedIds();

      // saveDraft's envelope → the real server compose → the jsonb column.
      const ledger = useWorkspace.getState().serializeObservationLedger();
      const column = JSON.parse(JSON.stringify(
        composeStructuredJsonColumn({ existing: null, ...buildCareStructuredJsonPatch({ observationLedger: ledger }) }),
      ));

      // Close the study: a fresh shell; the composed normal comes back on reopen.
      openLumbarStudy();
      expect(has(BULGE.sentence), "sanity: the fresh study does not carry the prior selections").toBe(false);

      // Reopen, in the order the reopen effect works: the draft's saved prose first
      // (setEditorContent, exactly as useDraftPersistence restores the field texts),
      // then the stored column's ledger hydrated onto that prose, then the Mode A
      // pass the workspace runs after it.
      useWorkspace.getState().setEditorContent({
        findings: beforeFindingsText,
        impression: beforeImpressionText,
        recommendation: beforeRecommendation,
        technique: beforeTechnique,
        clinicalHistory: "",
      });
      const hydrated = useWorkspace.getState().hydrateObservationLedger(
        extractCareObservationLedger(column),
      );
      expect(hydrated.ok, `hydration failed: ${JSON.stringify(hydrated)}`).toBe(true);
      recompose();

      expect(sentencesOf(findingsOf())).toEqual(beforeFindings);
      expect(sentencesOf(impressionOf())).toEqual(beforeImpression);
      expect(S().techniqueText).toBe(beforeTechnique);
      expect(selectedIds()).toEqual(beforeSelected);
      // No duplicate findings, no unexpectedly restored normal, no conclusion.
      const all = sentencesOf(findingsOf());
      expect(new Set(all).size).toBe(all.length);
      expect(has(BULGE.sentence)).toBe(true);
      expect(has("L4-L5: No significant disc bulge or protrusion is seen."), "the retired normal stays retired").toBe(false);
      expect(impressionOf()).not.toMatch(/CONCLUSION/i);
    });

    it("TEST 10: preview and print render the professional report with its clinical meaning", () => {
      openLumbarStudy();
      click(BULGE);
      click(LF);
      const inst = createInstrumentedPdf({ unit: "mm", format: "a4", orientation: "portrait" });
      generateReportPDF(
        {
          patientName: "ACCEPTANCE PATIENT",
          age: "46 Y",
          sex: "F",
          uhid: "ACC-UHID-1",
          accessionNumber: "ACC-1001",
          studyDate: "20261019",
          referringDoctor: "Dr Referrer",
          reportTitle: "MRI LUMBOSACRAL SPINE",
          findings: findingsOf(),
          impression: impressionOf(),
          recommendation: S().recommendationText,
        },
        DEFAULT_PRINT_SETTINGS,
        { name: "TEST DIAGNOSTICS", address: "TEST ADDRESS", phone: "TEST PHONE", email: "t@e.com" },
        { save: false, doc: inst.doc },
      );
      const page = inst.drawnTexts.map((t) => t.text.trim());
      const whole = page.join("\n");
      // Identity: the right patient, the right examination, on the printed page.
      expect(whole).toContain("ACCEPTANCE PATIENT");
      expect(whole).toContain("ACC-1001");
      expect(whole).toContain("MRI LUMBOSACRAL SPINE");
      // Clinical meaning: the selected abnormality, its impression, its advice.
      expect(whole).toContain("Ligamentum flavum hypertrophy at L4-L5.");
      expect(whole).toMatch(/IMPRESSION:/);
      expect(page.some((t) => /Disc herniation at L4-L5/.test(t))).toBe(true);
      // No conclusion section, no contradicted normal.
      expect(page.filter((t) => t.toUpperCase().includes("CONCLUSION"))).toEqual([]);
      expect(whole).not.toContain("L4-L5: No significant disc bulge or protrusion is seen.");
    });
  });

  describe("modality spread — existing supported templates", () => {
    it("CT brain: the applied normal format composes, and a normal tile cannot contradict a selected hemorrhage", () => {
      const ctx = buildReportingStudyContext({ modality: "CT", studyDescription: "CT Brain Plain", regions: ["Brain"], source: "auto" });
      openStudy(ctx, CT_NORMAL, false);
      for (const sentence of splitToSentences(CT_NORMAL.findings ?? "")) {
        expect(has(sentence), `missing normal: ${sentence}`).toBe(true);
      }
      expect(impressionOf()).toBe(CT_NORMAL.impression);
      click(tile("Acute ICH"));
      expect(has(tile("Acute ICH").sentence)).toBe(true);
      // The dedicated normal tile clicked after the hemorrhage never re-adds the
      // denial the hemorrhage owns (owner ruling 2026-10-19, outcome D).
      click(tile("Normal CT brain"));
      expect(has("No evidence of acute hemorrhage or mass lesion.")).toBe(false);
      expect(has(tile("Acute ICH").sentence), "the hemorrhage must survive the normal click").toBe(true);
      // CT has no approved baseline, so Mode A declines to rebuild automatically
      // (instantReport A2) and the stale format impression is NOT silently rewritten
      // (requirement 7: doctor-authored text is never silently overwritten). The
      // ICH click retired the contradicted denial ("No acute intracranial
      // abnormality.") from the impression; the format's normal label remains, and
      // what the radiologist gets is the armed advisory saying the conclusion no
      // longer matches the findings.
      expect(impressionOf()).toBe("Normal non-contrast CT brain.");
      expect(
        S().impressionNeedsRefresh
        || useWorkspace.getState().appliedPathologyPatches.some((p) => p.stale),
        "the stale-impression advisory must be armed when findings contradict the conclusion",
      ).toBe(true);
    });

    it("X-ray: the lumbar spine radiograph normal report appears and is stable across a pass", () => {
      const ctx = buildReportingStudyContext({ modality: "XR", studyDescription: "XR LS Spine", regions: ["LS Spine"], source: "auto" });
      openStudy(ctx, XR_NORMAL, false);
      for (const sentence of splitToSentences(XR_NORMAL.findings ?? "")) {
        expect(has(sentence), `missing normal: ${sentence}`).toBe(true);
      }
      expect(impressionOf()).toBe(XR_NORMAL.impression);
      const before = findingsOf();
      const pass = S().composeInstantReport(ctx, false);
      // No approved XR baseline exists, so Mode A declines rather than inventing
      // one — and declining must not touch the report the radiologist applied.
      expect(pass.action).toBe("hold");
      expect(findingsOf()).toBe(before);
    });

    it("Mammography: the BI-RADS 2 format composes, and a selected mass cannot be contradicted by the normal tile", () => {
      const ctx = buildReportingStudyContext({ modality: "MG", studyDescription: "MG Breast Bilateral", regions: ["Breast"], source: "auto" });
      openStudy(ctx, MG_BIRADS2, false);
      for (const sentence of splitToSentences(MG_BIRADS2.findings ?? "")) {
        expect(has(sentence), `missing finding: ${sentence}`).toBe(true);
      }
      expect(impressionOf()).toBe(MG_BIRADS2.impression);
      // The mass box asks for the side now instead of printing "right", so the
      // journey states the selection and asserts the substituted sentence —
      // derived from the shipped tile rather than retyped, so a wording change
      // here cannot silently stop matching the catalogue.
      const mass = tile("Spiculated mass").sentence.replace("{side}", "right");
      click(tile("Spiculated mass"), { side: "right" });
      expect(has(mass)).toBe(true);
      click(tile("Normal breast"));
      expect(has("No suspicious masses or calcifications.")).toBe(false);
      expect(has(mass), "the mass must survive the normal click").toBe(true);
    });
  });
});
