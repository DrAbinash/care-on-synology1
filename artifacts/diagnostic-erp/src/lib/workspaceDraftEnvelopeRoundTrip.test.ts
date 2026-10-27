import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "./zai-workspace/report-formats-library";
import { quickFindingPatch, quickFindingRowBelongsTo } from "./zai-workspace/quickSelectTilePayload";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe } from "./reportFieldMerge";
import { assertsNormalStatement } from "./generateLocalImpression";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultDorsalNumbering } from "./mriDorsalNumbering";
import { defaultDorsoLumbarState } from "./mriDorsoLumbarCoverage";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import {
  SPINE_REPORTING_DRAFT_KEY,
  extractSpineReportingState,
  spineReportingDraftPayload,
} from "./mriSpineDraftState";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import {
  extractCareVascularTechnique,
  vascularTechniquePayload,
} from "./mriBrainVascularDraftState";
import {
  extractCareRegionTransitions,
  regionTransitionPayload,
  type RegionTransitionRecord,
} from "./regionTransition";
import { extractCareObservationLedger } from "./observationLedger";
import {
  emptyViewerMeasurementsState,
  extractCareCanalApProvenance,
  extractCareViewerMeasurements,
} from "./structuredViewerMeasurements";
import {
  extractLinkedStudyFromStructuredJson,
  findingsSectionFromStudy,
  linkedStudyPayload,
} from "./multiStudyReport";
import { extractAppliedPatternsFromStructuredJson } from "./abnormalPatternDraft";
import {
  buildCareReportFormatIdentity,
  extractCareReportFormatIdentity,
} from "./zai-workspace/normalBootstrap";
// The server's own writer, imported rather than mirrored: every other envelope
// suite in this package hand-copies the compose (pr664PreMergeHardening.test.ts
// BLOCKER 1 says it "mirrors composeStructuredJsonColumn"), which means a change
// to the real compose cannot make them red. Relative cross-artefact imports from
// api-server are established test practice here (finalizePartialFailure.recovery
// .test.ts, composeObservations.test.ts, reportPreviewHarness.test.ts).
import {
  STRUCTURED_JSON_ENVELOPE_KIND,
  buildCareStructuredJsonPatch,
  composeStructuredJsonColumn,
} from "../../../api-server/src/lib/structuredJsonColumn";

/**
 * Stage C Phase 6 — the save/reopen wire, end to end, with no DB.
 *
 * `useDraftPersistence.saveDraft` builds one request body from the live store;
 * the route composes it into `radiology_report_drafts.structured_json` with
 * `buildCareStructuredJsonPatch` + `composeStructuredJsonColumn`; the reopen
 * effect then reads that column back through nine INDEPENDENT client readers
 * (`useDraftPersistence.ts:290-330`). Nothing in the repo checks that the shape
 * the server writes is the shape those readers ask for — each end only ever
 * tested against its own fixture. That is how `spineReporting` was lost: the
 * workspace sent it on every save, the route's request schema never declared it,
 * zod stripped it, and both sides' unit tests stayed green because neither was
 * reading the other's output.
 *
 * So this suite drives the whole chain with the real functions at both ends:
 * shipped format applied and shipped tiles clicked → real `serializeObservation
 * Ledger()` → real server patch → real server compose → the JSON string that
 * Postgres would store → each shipped client reader → the real store hydrate.
 *
 * Honest limit: it does not execute the React hook (this repo has no React test
 * environment), so the hydration ORDER is reproduced from `useDraftPersistence
 * .ts:273-330` rather than run. What it proves is the wire contract and the
 * store's own reactions; browser evidence is reported separately.
 */

const LS_NORMAL = FORMATS.find((f) => f.name === "MRI LS Spine — Standard Normal")!;
const HERNIATION = tile("Disc herniation L4-L5");
const STENOSIS = tile("Moderate canal stenosis L4-L5");
const BASE_LINES = String(LS_NORMAL.findings).split(/\n+/).map((l) => l.trim()).filter(Boolean);

const HERNIATION_CLAIM = "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina.";
const STENOSIS_CLAIM = "Moderate canal stenosis at L4-L5.";

const TRANSITION: RegionTransitionRecord = {
  kind: "care.region_transition.v1",
  fromRegion: "Whole Spine",
  toRegion: "LS Spine",
  retired: [{ id: "d1", concept: "alignment", segment: "cervical", text: "Cervical spine: Normal." }],
  keptAbnormalities: [],
  manualLinesPreserved: 0,
  decidedBy: "abinashsingh@gmail.com",
  at: "2026-10-12T09:00:00.000Z",
};

function tile(label: string) {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

/** The workspace's clinical shell, reset the way a study open resets it. */
function openNormalReport(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
    }),
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [], isFinalized: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {},
    regionTransitions: [],
    lumbarNumbering: defaultLumbarNumbering(),
    dorsalNumbering: defaultDorsalNumbering(),
    dorsoLumbarNumbering: defaultDorsoLumbarState(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null,
    appliedPatternMarkers: [],
  });
  useWorkspace.getState().applyFormatById(LS_NORMAL.id);
}

/**
 * Put the workspace into a state with something worth persisting in EVERY
 * envelope key, then capture the store values the assertion must get back.
 * Each setter here is the one the panel in the UI calls.
 */
function authorReport() {
  openNormalReport();
  useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(HERNIATION, "findings"));
  useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(STENOSIS, "findings"));
  useWorkspace.getState().recordCanalApManualValue("L4-L5", "10.2", "lumbar");
  useWorkspace.getState().setStructuredViewerMeasurements({
    ...emptyViewerMeasurementsState(),
    items: [{
      id: "svm_round_trip",
      concept: "canal_ap",
      values: { primary: 8.4, unit: "mm" },
      spinalLevel: "L4-L5",
    }],
  });
  // Vertebral numbering: a sacralisation case, because that is the state whose
  // loss silently renumbers every level sentence in the report.
  useWorkspace.setState({
    lumbarNumbering: {
      ...defaultLumbarNumbering(),
      mode: "lstv-sacralization",
      castellvi: "IIa",
      side: "bilateral",
      designatedL5Label: "S1",
    },
    dorsalNumbering: {
      mode: "manual", coverage: "upper", wholeSpineLocalizer: true,
      designationNote: "  Last rib-bearing vertebra designated T12  ",
    },
    dorsoLumbarNumbering: defaultDorsoLumbarState({
      numbering: "manual", superior: "T10-T11", inferior: "L6-S1", wholeSpineLocalizer: true,
      designationNote: "  Counted across the junction  ",
      lumbar: {
        mode: "lstv-lumbarization", castellvi: "IIb", side: "bilateral",
        pseudoarthrosis: true, reactiveMarrowChange: true, wholeSpineLocalizer: true,
        designatedL5Label: "  S1  ",
      },
    }),
    sequencesAvailable: { ...defaultSpineSequences(), stir: true },
    screening: {
      ...defaultScreeningState(),
      cervical: {
        ...defaultScreeningState().cervical,
        role: "accompanying-screening",
        performed: true,
      },
    },
    // The radiologist dragged the Impression into their own order (§37).
    impressionOrderFrozen: true,
    vascularTechnique: defaultVascularTechnique({ manual: { mraTof: true } }),
    regionTransitions: [TRANSITION],
    linkedStudy: findingsSectionFromStudy({
      studyId: 88, modality: "MR", studyDescription: "MRI Cervical Spine Plain",
      region: "Cervical Spine", accessionNumber: "ACC-88",
    }),
    appliedPatternMarkers: [{ patternId: "p-1", version: 3, bundleId: "b-1", appliedAt: "2026-10-12T09:00:00.000Z" }],
  });
  return {
    ledger: useWorkspace.getState().serializeObservationLedger(),
    canal: { ...useWorkspace.getState().canalApProvenance },
    measurements: useWorkspace.getState().structuredViewerMeasurements,
    numbering: useWorkspace.getState().lumbarNumbering,
    dorsalNumbering: useWorkspace.getState().dorsalNumbering,
    dorsoLumbarNumbering: useWorkspace.getState().dorsoLumbarNumbering,
    sequences: useWorkspace.getState().sequencesAvailable,
    screening: useWorkspace.getState().screening,
    orderFrozen: useWorkspace.getState().impressionOrderFrozen,
    vascular: useWorkspace.getState().vascularTechnique,
    transitions: [...useWorkspace.getState().regionTransitions],
    linked: useWorkspace.getState().linkedStudy,
    patterns: [...useWorkspace.getState().appliedPatternMarkers],
    identity: buildCareReportFormatIdentity({ name: LS_NORMAL.name, formatId: String(LS_NORMAL.id) }),
    findingsText: useWorkspace.getState().findingsText,
    impressionText: useWorkspace.getState().impressionText,
    recommendationText: useWorkspace.getState().recommendationText,
  };
}

/**
 * The body `saveDraft` sends for the envelope keys
 * (`useDraftPersistence.ts:495-539`), then the two server functions the route
 * runs on it (`radiology-report-generator.ts:2007`, then
 * `persistCareStructuredJsonPatch` → composeStructuredJsonColumn). The
 * JSON.parse(JSON.stringify(…)) is the jsonb column: the real round trip goes
 * through Postgres, and this is the same loss of functions/undefined that does.
 */
function storedColumn(authored: ReturnType<typeof authorReport>) {
  const body = {
    observationLedger: authored.ledger,
    viewerMeasurements: authored.measurements,
    canalApProvenance: authored.canal,
    [SPINE_REPORTING_DRAFT_KEY]: spineReportingDraftPayload({
      lumbarNumbering: authored.numbering,
      dorsalNumbering: authored.dorsalNumbering,
      dorsoLumbarNumbering: authored.dorsoLumbarNumbering,
      sequencesAvailable: authored.sequences,
      screening: authored.screening,
      impressionOrderFrozen: authored.orderFrozen,
    }),
    vascularTechnique: vascularTechniquePayload(authored.vascular),
    regionTransitions: regionTransitionPayload(authored.transitions),
    linkedStudy: linkedStudyPayload(authored.linked),
    appliedPatterns: authored.patterns,
    reportFormatIdentity: authored.identity,
  };
  return JSON.parse(JSON.stringify(
    composeStructuredJsonColumn({ existing: null, ...buildCareStructuredJsonPatch(body) }),
  ));
}

function claims(): string[] {
  return useWorkspace.getState().findingsText
    .split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !BASE_LINES.includes(l))
    .filter((l) => !assertsNormalStatement(normalizeForDedupe(l)))
    .map((l) => normalizeForDedupe(l))
    .sort();
}

describe("Stage C Phase 6 · one save-draft body composes into one column", () => {
  let authored: ReturnType<typeof authorReport>;
  let column: any;

  beforeEach(() => {
    authored = authorReport();
    column = storedColumn(authored);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("composes an envelope, so the A4 cache and every reader key coexist", () => {
    expect(column.kind).toBe(STRUCTURED_JSON_ENVELOPE_KIND);
    // The measurement group is written as a whole; the request carried no
    // `structuredFormatState`, so the compose must not invent one.
    expect(column.careStructuredFormat).toBeNull();
  });

  it("every envelope key the workspace sent is readable by the client reader for it", () => {
    // Nine independent readers in useDraftPersistence.ts:290-330 — the whole
    // reopen surface. Each assertion is against the store value that was saved,
    // not against a fixture, so a rename on either side turns the test red.
    expect(extractCareObservationLedger(column)).toEqual(authored.ledger);
    expect(extractCareViewerMeasurements(column)).toEqual(authored.measurements);
    expect(extractCareCanalApProvenance(column)).toEqual(authored.canal);
    expect(extractCareVascularTechnique(column)).toEqual({
      acquired: authored.vascular.acquired,
      manual: { mraTof: true },
      designationNote: null,
    });
    expect(extractCareRegionTransitions(column)).toEqual(authored.transitions);
    expect(extractLinkedStudyFromStructuredJson(column)?.studyId).toBe("88");
    expect(extractAppliedPatternsFromStructuredJson(column)).toEqual(authored.patterns);
    expect(extractCareReportFormatIdentity(column)?.name).toBe(LS_NORMAL.name);

    const spine = extractSpineReportingState(column);
    expect(spine, "spine capture state must come back, not fall through to defaults").not.toBeNull();
    // Field by field, not toEqual: the reader normalizes an absent boolean to
    // `false`, so a whole-object comparison would compare two different
    // conventions instead of the clinical state.
    expect(spine.lumbarNumbering.mode).toBe("lstv-sacralization");
    expect(spine.lumbarNumbering.castellvi).toBe("IIa");
    expect(spine.lumbarNumbering.side).toBe("bilateral");
    expect(spine.lumbarNumbering.designatedL5Label).toBe("S1");
    expect(spine.lumbarNumbering.pseudoarthrosis).toBe(false);
    expect(spine.dorsalNumbering).toEqual(authored.dorsalNumbering);
    expect(spine.dorsoLumbarNumbering).toEqual(authored.dorsoLumbarNumbering);
    expect(spine.sequencesAvailable.stir).toBe(true);
    expect(spine.screening.cervical.role).toBe("accompanying-screening");
    expect(spine.impressionOrderFrozen).toBe(true);
  });

  it("reads spine state under the key the server writes, and nothing under the prefixed spelling", () => {
    // Every other envelope key is `care`-prefixed, so `careSpineReporting` is the
    // obvious wrong guess — and a wrong guess here is silent, because the client
    // reader falls back to defaults instead of failing. This is the assertion
    // that makes the key spelling enforced rather than commented.
    const renamed = { ...column };
    delete renamed[SPINE_REPORTING_DRAFT_KEY];
    renamed.careSpineReporting = column[SPINE_REPORTING_DRAFT_KEY];
    expect(extractSpineReportingState(renamed)).toBeNull();
    expect(extractSpineReportingState(column)).not.toBeNull();
  });

  it("loses the §37 freeze the moment the key is missing, which is what the defect did", () => {
    // Pre-fix, this is the whole column the draft had: the schema stripped the
    // field on every save. A reopen therefore restored `impressionOrderFrozen:
    // false`, and the priority sorter was free to re-shuffle an Impression the
    // radiologist had put in order by hand.
    const withoutSpine = { ...column };
    delete withoutSpine[SPINE_REPORTING_DRAFT_KEY];
    const restored = extractSpineReportingState(withoutSpine);
    expect(restored, "no spine block is not the same as a default one").toBeNull();
    // And with no block, the hydrate branch in the hook does not run at all, so
    // the store keeps the value it reset to on study open:
    openNormalReport();
    expect(useWorkspace.getState().impressionOrderFrozen).toBe(false);
  });
});

describe("Stage C Phase 6 · reopening the stored column restores the report", () => {
  it("re-claims the same findings from the ledger alone", () => {
    const authored = authorReport();
    const column = storedColumn(authored);
    const before = claims();
    expect(before).toEqual(expect.arrayContaining([
      normalizeForDedupe(HERNIATION_CLAIM), normalizeForDedupe(STENOSIS_CLAIM),
    ]));

    // Close and reopen: a fresh workspace on the same study, hydrated from the
    // stored row exactly as useDraftPersistence.ts:273-330 does it.
    openNormalReport();
    useWorkspace.getState().setEditorContent({
      findings: authored.findingsText,
      impression: authored.impressionText,
      recommendation: authored.recommendationText,
      technique: "",
      clinicalHistory: "",
    });
    const hydrated = useWorkspace.getState().hydrateObservationLedger(
      extractCareObservationLedger(column),
    );
    expect(hydrated.ok, `ledger hydration failed: ${JSON.stringify(hydrated)}`).toBe(true);

    expect(claims()).toEqual(before);
    expect(hydrated.patchCount).toBeGreaterThanOrEqual(2);
  });

  it("restores the §37 freeze, so the sorter refuses to touch the hand-ordered Impression", () => {
    const authored = authorReport();
    const column = storedColumn(authored);
    const handOrder = authored.impressionText;
    const lines = handOrder.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    expect(lines.length, "the fixture must produce a multi-line Impression to reorder").toBeGreaterThan(1);
    // The order the radiologist arranged by hand, and the permutation the
    // priority sorter would impose on it. The caller passes an explicit order
    // through the same action (useWorkspaceClinicalUi.tsx:3099).
    const imposedOrder = [...lines].reverse();

    openNormalReport();
    const spine = extractSpineReportingState(column);
    expect(spine?.impressionOrderFrozen).toBe(true);
    useWorkspace.setState({
      impressionText: handOrder,
      lumbarNumbering: spine?.lumbarNumbering ?? useWorkspace.getState().lumbarNumbering,
      dorsalNumbering: spine?.dorsalNumbering ?? useWorkspace.getState().dorsalNumbering,
      dorsoLumbarNumbering: spine?.dorsoLumbarNumbering ?? useWorkspace.getState().dorsoLumbarNumbering,
      sequencesAvailable: spine?.sequencesAvailable ?? useWorkspace.getState().sequencesAvailable,
      screening: spine?.screening ?? useWorkspace.getState().screening,
      impressionOrderFrozen: spine?.impressionOrderFrozen ?? false,
    });
    expect(useWorkspace.getState().orderImpressionByPriority(imposedOrder)).toBe(false);
    expect(useWorkspace.getState().impressionText).toBe(handOrder);

    // The identical call on the identical report, with the flag the reopen lost
    // instead of the flag that was stored: it reorders. Without this control the
    // assertion above would only be proving that a no-op call returns false.
    useWorkspace.setState({ impressionOrderFrozen: false });
    expect(useWorkspace.getState().orderImpressionByPriority(imposedOrder)).toBe(true);
    expect(useWorkspace.getState().impressionText).toBe(imposedOrder.join("\n"));
  });
});

/**
 * The same wire, for a box that comes out of PostgreSQL rather than out of the
 * shipped tile catalogue.
 *
 * Quick Select is being consolidated into `radiology_quick_findings`, applied
 * through `handleQuickToggle` → `quickFindingPatch`. Everything the tile suite
 * above proves about the save/reopen contract has to hold for a box too, and two
 * things about a box are unlike a tile: its row id can carry a side, so one box
 * can own two observations at once; and its clinical metadata may be entirely
 * absent, which is the state a deploy actually leaves a clinic's own row in
 * (measured: the three boxes the factory seed adopts come back with concept '',
 * conflict_group '', baseline_replaces '', properties '' and category NULL).
 */
const DB_FORAMINAL = {
  id: 4101,
  label: "Foraminal stenosis L5-S1",
  studyType: "LS Spine",
  findingText: "Severe {side} foraminal stenosis at L5-S1 with nerve root compression.",
  impressionText: "Severe {side} L5-S1 foraminal stenosis.",
  techniqueText: "",
  recommendationText: "",
  concept: "foraminal_stenosis",
  anatomicalSection: "L5-S1",
  conflictGroup: "foraminal_stenosis",
  properties: "side",
};

/** A clinic box nobody ever gave a concept. Wording only — and still a real box. */
const DB_CLINIC_PLAIN = {
  id: 4102,
  label: "Post-op changes",
  studyType: "LS Spine",
  findingText: "Post-operative changes are noted at the visualised levels.",
  impressionText: "Post-operative appearance.",
  techniqueText: "",
  recommendationText: "",
};

/** The ledger key on its own, through the server's writer and the jsonb round trip. */
function storedLedgerColumn() {
  const body = { observationLedger: useWorkspace.getState().serializeObservationLedger() };
  return JSON.parse(JSON.stringify(
    composeStructuredJsonColumn({ existing: null, ...buildCareStructuredJsonPatch(body) }),
  ));
}

function reportText() {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
  };
}

function boxRowIds(boxId: number): string[] {
  return useWorkspace.getState().appliedPathologyPatches
    .map((p) => p.id)
    .filter((id) => quickFindingRowBelongsTo(id, boxId));
}

/** Close and reopen on the stored column, the way useDraftPersistence.ts:273-330 does. */
function reopenFrom(column: any, text: ReturnType<typeof reportText>) {
  openNormalReport();
  useWorkspace.getState().setEditorContent({
    findings: text.findings,
    impression: text.impression,
    recommendation: text.recommendation,
    technique: "",
    clinicalHistory: "",
  });
  const hydrated = useWorkspace.getState().hydrateObservationLedger(
    extractCareObservationLedger(column),
  );
  expect(hydrated.ok, `ledger hydration failed: ${JSON.stringify(hydrated)}`).toBe(true);
  return hydrated;
}

function click(box: typeof DB_FORAMINAL, side?: "left" | "right") {
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickFindingPatch(box, { region: "LS Spine" }, side ? { side } : {}),
  );
  expect(outcome, `"${box.label}"${side ? ` on the ${side}` : ""} was refused`).not.toBe("refused");
}

describe("Quick Select consolidation · a database box survives save and reopen", () => {
  it("keeps left and right of one box as two observations, before and after the round trip", () => {
    openNormalReport();
    click(DB_FORAMINAL, "left");
    click(DB_FORAMINAL, "right");
    // Owner ruling: left and right coexist. They are two clinical facts about two
    // different foramina, so the second click must not retire the first — which is
    // what a shared conflict group would do if the slot key ignored the side.
    expect(boxRowIds(DB_FORAMINAL.id).sort()).toEqual(["qf-4101:left", "qf-4101:right"]);
    const text = reportText();
    expect(text.findings).toContain("Severe left foraminal stenosis at L5-S1");
    expect(text.findings).toContain("Severe right foraminal stenosis at L5-S1");

    reopenFrom(storedLedgerColumn(), text);

    expect(boxRowIds(DB_FORAMINAL.id).sort()).toEqual(["qf-4101:left", "qf-4101:right"]);
    const after = useWorkspace.getState().findingsText;
    expect(after).toContain("Severe left foraminal stenosis at L5-S1");
    expect(after).toContain("Severe right foraminal stenosis at L5-S1");
    // One sentence per side, not one per save: a reopen that re-applied the box on
    // top of the restored prose would print the same finding twice.
    expect(after.match(/Severe left foraminal stenosis at L5-S1/g)).toHaveLength(1);
    expect(after.match(/Severe right foraminal stenosis at L5-S1/g)).toHaveLength(1);
    expect(useWorkspace.getState().impressionText).toContain("Severe left L5-S1 foraminal stenosis.");
    expect(useWorkspace.getState().impressionText).toContain("Severe right L5-S1 foraminal stenosis.");
  });

  it("keeps a concept-less clinic box usable, with its own wording and no invented ownership", () => {
    openNormalReport();
    click(DB_CLINIC_PLAIN);
    expect(boxRowIds(DB_CLINIC_PLAIN.id)).toEqual(["qf-4102"]);
    const text = reportText();
    expect(text.findings).toContain("Post-operative changes are noted at the visualised levels.");

    reopenFrom(storedLedgerColumn(), text);

    expect(boxRowIds(DB_CLINIC_PLAIN.id)).toEqual(["qf-4102"]);
    expect(useWorkspace.getState().findingsText)
      .toContain("Post-operative changes are noted at the visualised levels.");
    expect(useWorkspace.getState().impressionText).toContain("Post-operative appearance.");
  });

  it("reopens a box the radiologist can still withdraw", () => {
    // Restoring the sentence is not the same as restoring the box. If hydration
    // dropped the row id, `removeObservation` would answer "missing" and the chip
    // would stay lit over a sentence no control can take back.
    openNormalReport();
    click(DB_FORAMINAL, "left");
    const text = reportText();

    reopenFrom(storedLedgerColumn(), text);

    const owned = boxRowIds(DB_FORAMINAL.id);
    expect(owned).toEqual(["qf-4101:left"]);
    const outcomes = owned.map((id, i) => useWorkspace.getState().removeObservation(
      id,
      i > 0 ? { skipUndoSnapshot: true } : undefined,
    ));
    expect(outcomes, "the reopened row is not withdrawable").not.toContain("missing");
    expect(useWorkspace.getState().findingsText)
      .not.toContain("Severe left foraminal stenosis at L5-S1");
  });
});
