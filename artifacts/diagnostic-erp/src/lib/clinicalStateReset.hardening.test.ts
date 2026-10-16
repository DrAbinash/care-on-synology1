/**
 * Group E — patient/study isolation in the singleton workspace store, and the
 * signed-state lock's canonical source.
 *
 * The workspace store is a module-scope singleton (`create<WorkspaceStore>()`),
 * so it survives navigation and unmount. Nothing about that structure prevents
 * Patient A's clinical state from still being in memory while Patient B's empty
 * report is on screen — every isolation property is an explicit act of code.
 * Three separate reset paths existed and had drifted; they now share one
 * definition (`emptyClinicalState`). These tests pin the definition, the three
 * call sites, the cross-study undo refusal, and the lock's status source.
 *
 * Source contracts read the real files rather than re-implementing them,
 * because this repo's test environment has no browser/DOM to render the hook.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLINICAL_RESET_FIELDS,
  emptyClinicalState,
} from "@/lib/zai-workspace/clinicalStateReset";
import { setServerFeatureFlags } from "@/lib/staffSession";
import { CRITICAL_COMMS_FLAG } from "@/lib/criticalResultCommsFlag";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { WorkspaceStore } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const STORE_SRC = "lib/zai-workspace/store.ts";
const RESET_SRC = "lib/zai-workspace/clinicalStateReset.ts";
const DRAFT_SRC = "hooks/radiology-workspace/useDraftPersistence.ts";
const CLINICAL_UI_SRC = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const COMMANDS_SRC = "hooks/radiology-workspace/useWorkspaceCommands.ts";
const SHORTCUTS_SRC = "lib/reportingWorkspaceShortcuts.ts";
const LIFECYCLE_SRC = "lib/radiologyReportLifecycle.ts";
const FINALIZE_SRC = "hooks/radiology-workspace/useStudyFinalize.ts";

/** A frame pushed by a real store action, stamped with whatever study is active. */
function pushUndoFrameViaRealAction(): void {
  // applyMacroBundle captures a snapshot before its loop and pushes it after,
  // so an empty bundle is a genuine no-op edit that still exercises
  // captureClinicalSnapshot — the only place activeStudyId is stamped.
  useWorkspace.getState().applyMacroBundle({ observations: [] });
}

function dirtyTheStoreAsPatientA(): void {
  const s = useWorkspace.getState();
  useWorkspace.setState({
    activeStudyId: "study-A",
    activeStudyInstanceUID: "1.2.840.A",
    clinicalHistoryText: "A: 44F, radiculopathy",
    findingsText: "A: L4-L5 disc protrusion.",
    impressionText: "A: L4-L5 disc protrusion.",
    recommendationText: "A: clinical correlation.",
    techniqueText: "A: MRI LS spine, sagittal T1/T2.",
    fieldProvenance: { findings: [{ source: "manual" }] } as never,
    isDirty: true,
    measurements: [{ id: "mA" }] as never,
    priors: [{ id: "pA" }] as never,
    appliedPathologyPatches: [{ id: "patchA" }] as never,
    structuredViewerMeasurements: {
      ...s.structuredViewerMeasurements,
      byObservationId: { obsA: { canalAp: 8.7 } },
    } as never,
    coverageMarks: [{ id: "covA" }] as never,
    coverageByScope: { cervical: ["C1"] } as never,
    vascularTechnique: {
      ...s.vascularTechnique,
      notes: "A: 3D TOF MRA",
    } as never,
    screening: { ...s.screening, answers: { q: "yes" } } as never,
    voiceComposerObservations: [{ id: "vA" }] as never,
    voiceComposerTranscriptHistory: ["A transcript"],
    ownershipReviewWarnings: [{ sentence: "A", token: "t", hint: "h" }] as never,
    criticalSlaStartedAt: 1_700_000_000_000,
    criticalSlaEscalated: true,
    impressionNeedsRefresh: true,
    appliedFormatName: "A format",
    appliedFormatReportTitle: "A title",
    ghostText: "A ghost",
    railStage: "measure" as never,
    studyComposition: "combined" as never,
    lumbarNumbering: { ...s.lumbarNumbering, confident: false } as never,
    // Context that the PARTIAL reset must NOT wipe.
    reportingContext: s.reportingContext,
  });
}

beforeEach(() => {
  useWorkspace.setState({ ...emptyClinicalState() } as never);
  useWorkspace.setState({
    activeStudyId: null,
    activeStudyInstanceUID: null,
    clinicalHistoryText: "",
    studies: [],
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emptyClinicalState — the single definition of one study's clinical state", () => {
  it("returns exactly the keys the enumerated contract lists, in both directions", () => {
    const returned = Object.keys(emptyClinicalState()).sort();
    const declared = [...CLINICAL_RESET_FIELDS].sort();
    // Both directions matter: a key returned but not declared would be reset by
    // one path silently, and a key declared but not returned would leave
    // `ClinicalResetState` unsatisfied at compile time AND reset nothing here.
    expect(returned).toEqual(declared);
  });

  it("lists only real store fields, so a rename cannot leave a dead name in the contract", () => {
    const initial = useWorkspace.getState() as unknown as Record<string, unknown>;
    const missing = CLINICAL_RESET_FIELDS.filter((f) => !(f in initial));
    expect(missing).toEqual([]);
  });

  it("constructs every reference value fresh, so two studies never share one object", () => {
    const a = emptyClinicalState() as unknown as Record<string, unknown>;
    const b = emptyClinicalState() as unknown as Record<string, unknown>;
    const shared: string[] = [];
    for (const key of CLINICAL_RESET_FIELDS) {
      const va = a[key];
      if (va !== null && typeof va === "object" && va === b[key]) shared.push(key);
    }
    // A hoisted module constant would hand Patient B the same Set/array the
    // store mutated for Patient A — the leak this module exists to close.
    expect(shared).toEqual([]);
  });

  it("clears Patient A's ledger, undo stack, measurements, numbering and vascular answers", () => {
    dirtyTheStoreAsPatientA();
    pushUndoFrameViaRealAction();
    expect(useWorkspace.getState().patchUndoStack.length).toBeGreaterThan(0);

    useWorkspace.setState({ ...emptyClinicalState() } as never);

    const s = useWorkspace.getState();
    expect(s.findingsText).toBe("");
    expect(s.impressionText).toBe("");
    expect(s.recommendationText).toBe("");
    expect(s.techniqueText).toBe("");
    expect(s.fieldProvenance).toEqual({});
    expect(s.measurements).toEqual([]);
    expect(s.priors).toEqual([]);
    expect(s.appliedPathologyPatches).toEqual([]);
    expect(s.patchUndoStack).toEqual([]);
    expect(s.lastPatchSnapshot).toBeNull();
    expect(s.structuredViewerMeasurements).toEqual(emptyClinicalState().structuredViewerMeasurements);
    expect(s.canalApProvenance).toEqual({});
    expect(s.lumbarNumbering).toEqual(emptyClinicalState().lumbarNumbering);
    expect(s.dorsalNumbering).toEqual(emptyClinicalState().dorsalNumbering);
    expect(s.dorsoLumbarNumbering).toEqual(emptyClinicalState().dorsoLumbarNumbering);
    expect(s.sequencesAvailable).toEqual(emptyClinicalState().sequencesAvailable);
    expect(s.screening).toEqual(emptyClinicalState().screening);
    expect(s.vascularTechnique).toEqual(emptyClinicalState().vascularTechnique);
    expect(s.coverageMarks).toEqual([]);
    expect(s.coverageByScope).toEqual({});
    expect(s.voiceComposerObservations).toEqual([]);
    expect(s.voiceComposerTranscriptHistory).toEqual([]);
    expect(s.ownershipReviewWarnings).toEqual([]);
    expect(s.ledgerHydrationWarning).toBeNull();
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaEscalated).toBe(false);
    expect(s.impressionNeedsRefresh).toBe(false);
    expect(s.ghostText).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(s.isFinalized).toBe(false);
  });

  it("leaves identity and context to the caller — the helper must not own them", () => {
    // The PARTIAL reset has to preserve `reportingContext` (the hydrate effect
    // that runs after it repopulates the rest) and must not invent an
    // activeStudyId. Asserting absence here is what stops someone "helpfully"
    // adding them to the list later and re-opening the hydration race.
    const returned = Object.keys(emptyClinicalState());
    for (const excluded of [
      "activeStudyId",
      "activeStudyInstanceUID",
      "clinicalHistoryText",
      "reportingContext",
    ]) {
      expect(returned).not.toContain(excluded);
    }
  });
});

describe("cross-study undo — a frame captured against another patient must not be restored", () => {
  it("refuses, keeps the frame on the stack, and leaves the current report untouched", () => {
    useWorkspace.setState({ activeStudyId: "study-A", findingsText: "A findings", impressionText: "A impression" } as never);
    pushUndoFrameViaRealAction();
    const stack = useWorkspace.getState().patchUndoStack;
    expect(stack).toHaveLength(1);
    expect(stack[0]!.activeStudyId).toBe("study-A");

    // A switch that went through neither reset path: deep link, browser
    // Back/Forward, or selectStudy no-oping on an id absent from the worklist.
    useWorkspace.setState({ activeStudyId: "study-B", findingsText: "B findings", impressionText: "B impression" } as never);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const undone = useWorkspace.getState().undoLastPatch();

    expect(undone).toBe(false);
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe("B findings");
    expect(after.impressionText).toBe("B impression");
    // The frame is the only record of what the radiologist undid on study A;
    // dropping it would destroy that history rather than protect study B.
    expect(after.patchUndoStack).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/different study/);
  });

  it("still undoes within the same study, and still returns a boolean", () => {
    // 24 existing tests assert `undoLastPatch()).toBe(true)`. The signature must
    // stay `() => boolean` — a string union would invert every one of them,
    // because "empty" is truthy.
    useWorkspace.setState({ activeStudyId: "study-A", findingsText: "A1" } as never);
    pushUndoFrameViaRealAction();
    useWorkspace.setState({ findingsText: "A2" } as never);

    const undone = useWorkspace.getState().undoLastPatch();
    expect(undone).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe("A1");
    expect(useWorkspace.getState().patchUndoStack).toHaveLength(0);
  });

  it("returns false with no toast-worthy warning when there is simply nothing to undo", () => {
    useWorkspace.setState({ activeStudyId: "study-A", patchUndoStack: [] } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(useWorkspace.getState().undoLastPatch()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("selectStudy — the FULL reset path", () => {
  it("warns and changes nothing when the id is not in the worklist", () => {
    // Was a bare `return`. Every caller assumes the switch happened and carries
    // on with the previous study's state still on screen.
    dirtyTheStoreAsPatientA();
    const before = useWorkspace.getState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    useWorkspace.getState().selectStudy("study-does-not-exist");

    const after = useWorkspace.getState();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toMatch(/selectStudy ignored/);
    expect(after.activeStudyId).toBe(before.activeStudyId);
    expect(after.findingsText).toBe(before.findingsText);
    expect(after.patchUndoStack).toEqual(before.patchUndoStack);
  });

  it("clears Patient A's whole clinical state when Patient B is selected", () => {
    // Fake timers keep the deferred recomputeCopilot()/seedSystemNormalImpression()
    // pair from running after the assertions — they need a hydrated
    // reportingContext this test does not build, and they are not what is under
    // test here. The reset itself is synchronous, inside the same `set`.
    vi.useFakeTimers();
    try {
      dirtyTheStoreAsPatientA();
      pushUndoFrameViaRealAction();
      useWorkspace.setState({
        studies: [
          { id: "study-B", studyInstanceUID: "1.2.840.B", clinicalHistory: "B: 61M, headache" },
        ],
      } as never);

      useWorkspace.getState().selectStudy("study-B");

      const s = useWorkspace.getState();
      // Identity is taken from the study row, not from the helper.
      expect(s.activeStudyId).toBe("study-B");
      expect(s.activeStudyInstanceUID).toBe("1.2.840.B");
      expect(s.clinicalHistoryText).toBe("B: 61M, headache");
      // Everything clinical is gone.
      const empty = emptyClinicalState();
      expect(s.findingsText).toBe("");
      expect(s.impressionText).toBe("");
      expect(s.patchUndoStack).toEqual([]);
      expect(s.lastPatchSnapshot).toBeNull();
      expect(s.appliedPathologyPatches).toEqual([]);
      expect(s.measurements).toEqual([]);
      expect(s.structuredViewerMeasurements).toEqual(empty.structuredViewerMeasurements);
      expect(s.lumbarNumbering).toEqual(empty.lumbarNumbering);
      expect(s.dorsalNumbering).toEqual(empty.dorsalNumbering);
      expect(s.dorsoLumbarNumbering).toEqual(empty.dorsoLumbarNumbering);
      expect(s.vascularTechnique).toEqual(empty.vascularTechnique);
      expect(s.coverageByScope).toEqual({});
      expect(s.criticalSlaStartedAt).toBeNull();
      expect(s.impressionNeedsRefresh).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("advanceToNextStudy — the third reset path, at the end of the queue", () => {
  it("clears the whole clinical set once no study is open", () => {
    // The audit recorded two reset paths. This is the third: it used to clear
    // activeStudyId, the three narrative texts and fieldProvenance — four of
    // ~61 fields — and left the last reported study's ledger, undo stack,
    // measurements and protocol answers sitting in the singleton store.
    dirtyTheStoreAsPatientA();
    pushUndoFrameViaRealAction();
    useWorkspace.setState({
      studies: [],
      completedStudyIds: new Set<string>(),
      nextStudyId: null,
      nextStudyPreloaded: false,
    } as never);

    useWorkspace.getState().advanceToNextStudy();

    const s = useWorkspace.getState();
    const empty = emptyClinicalState();
    expect(s.activeStudyId).toBeNull();
    expect(s.findingsText).toBe("");
    expect(s.impressionText).toBe("");
    expect(s.recommendationText).toBe("");
    expect(s.techniqueText).toBe("");
    expect(s.fieldProvenance).toEqual({});
    expect(s.patchUndoStack).toEqual([]);
    expect(s.lastPatchSnapshot).toBeNull();
    expect(s.appliedPathologyPatches).toEqual([]);
    expect(s.measurements).toEqual([]);
    expect(s.priors).toEqual([]);
    expect(s.structuredViewerMeasurements).toEqual(empty.structuredViewerMeasurements);
    expect(s.lumbarNumbering).toEqual(empty.lumbarNumbering);
    expect(s.dorsalNumbering).toEqual(empty.dorsalNumbering);
    expect(s.dorsoLumbarNumbering).toEqual(empty.dorsoLumbarNumbering);
    expect(s.sequencesAvailable).toEqual(empty.sequencesAvailable);
    expect(s.screening).toEqual(empty.screening);
    expect(s.vascularTechnique).toEqual(empty.vascularTechnique);
    expect(s.coverageMarks).toEqual([]);
    expect(s.coverageByScope).toEqual({});
    expect(s.voiceComposerObservations).toEqual([]);
    expect(s.voiceComposerTranscriptHistory).toEqual([]);
    expect(s.ownershipReviewWarnings).toEqual([]);
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaEscalated).toBe(false);
    expect(s.impressionNeedsRefresh).toBe(false);
    expect(s.isDirty).toBe(false);
    expect(s.isFinalized).toBe(false);
  });
});

describe("reset-path source contracts — the three call sites cannot drift back", () => {
  it("defines the clinical reset once, in the leaf module", () => {
    const src = read(RESET_SRC);
    expect(src).toMatch(/export const CLINICAL_RESET_FIELDS = \[/);
    expect(src).toMatch(/export function emptyClinicalState\(\): ClinicalResetState/);
    // Pick<> against the store, not a hand-written duplicate: a rename then
    // stops compiling instead of quietly resetting the wrong thing.
    expect(src).toMatch(/export type ClinicalResetState = Pick<WorkspaceStore, ClinicalResetField>/);
  });

  it("has the store's FULL reset and its end-of-queue reset spread the shared helper", () => {
    const src = read(STORE_SRC);
    expect(src).toMatch(/import \{ emptyClinicalState \} from "\.\/clinicalStateReset";/);

    const selectStudy = src.slice(src.indexOf("selectStudy: (id) => {"));
    expect(selectStudy.slice(0, 1200)).toMatch(/set\(\{\s*\.\.\.emptyClinicalState\(\),/);

    // The third reset path, which the audit did not record: advanceToNextStudy's
    // end-of-queue branch used to clear 4 of ~61 fields. Match the implementation
    // (`() => {`), not the declaration line in the store's type, which comes first.
    const advance = src.slice(src.indexOf("advanceToNextStudy: () => {"));
    expect(advance.slice(0, 2000)).toMatch(/set\(\{ \.\.\.emptyClinicalState\(\), activeStudyId: null,/);
  });

  it("has the PARTIAL study-switch reset spread the shared helper", () => {
    const src = read(DRAFT_SRC);
    // A-02: the transition payload now comes from `studyTransitionReset`, which spreads
    // `emptyClinicalState()` itself and adds the authoritative route identity. The
    // property this test exists to protect — one shared definition, no hand-maintained
    // list — is therefore still asserted, just through the helper, and the helper is
    // checked here so the indirection cannot quietly become a second list.
    expect(src).toMatch(/import \{ studyTransitionReset \} from "@\/lib\/zai-workspace\/clinicalStateReset";/);
    expect(src).toMatch(/useWorkspace\.setState\(studyTransitionReset\(studyId\)\);/);
    const helper = read(RESET_SRC);
    expect(helper).toMatch(/export function studyTransitionReset\(/);
    expect(helper).toMatch(/\.\.\.emptyClinicalState\(\),/);
    expect(helper).toMatch(/activeStudyId: hasStudy \? String\(routeStudyId\) : null,/);
    // A UID is never carried across a transition; "unknown" is null, not the old study's.
    expect(helper).toMatch(/activeStudyInstanceUID: null,/);
    // The old hand-maintained list must be gone, not merely added to.
    expect(src).not.toMatch(/abnormalPatternConfirm:\s*null,\s*\.\.\.\(useWorkspace\.getState\(\)/);
  });

  it("has no mirror effect that can leave the previous study authoritative", () => {
    // A-02: this is the bail-out that made `activeStudyId` lag the route study, and with
    // it the Copilot study stamp compare a value against itself.
    const src = read(CLINICAL_UI_SRC);
    expect(src).not.toMatch(/if \(!studies\.some\(\(s: Study\) => s\.id === sid\)\) return;/);
    expect(src).not.toMatch(/setState\(\{ activeStudyId: sid, railStage: "orient" \}\)/);
  });

  it("stamps every undo frame with the study it was captured against", () => {
    const src = read(STORE_SRC);
    const snapshotType = src.slice(src.indexOf("type PatchSnapshot = {"));
    expect(snapshotType.slice(0, 600)).toMatch(/activeStudyId: string \| null;/);
    const capture = src.slice(src.indexOf("function captureClinicalSnapshot("));
    expect(capture.slice(0, 600)).toMatch(/activeStudyId: s\.activeStudyId,/);
    const undo = src.slice(src.indexOf("undoLastPatch: () => {"));
    expect(undo.slice(0, 900)).toMatch(/if \(snap\.activeStudyId !== get\(\)\.activeStudyId\) \{/);
    expect(undo.slice(0, 900)).toMatch(/return false;/);
  });

  it("surfaces a refused undo at the undo keystroke instead of failing silently", () => {
    // This refusal now spans TWO files, and the split is the point: the keystroke is claimed by a
    // focus-aware gate, and the REASON is computed by one helper that both directions call. So the
    // contract has two halves. A checker that only reads the handler goes green the moment the wording
    // moves out of it — which is how the previous version of this test was written, and why it is
    // rewritten here instead of being deleted for "no longer matching".
    const src = read(COMMANDS_SRC);
    const at = src.indexOf("if (shouldHandleClinicalUndoShortcut(e)) {");
    expect(at, "the undo keystroke must be claimed by the editor-focus gate, not a raw modifier test")
      .toBeGreaterThan(-1);
    const handler = src.slice(at, at + 1800);
    expect(handler).toMatch(/undoLastPatch\(\)/);
    expect(handler).toMatch(/clinicalHistoryRefusal\(/);
    expect(handler).toMatch(/variant: "destructive"/);
    // pushNotification is not a usable channel: its only consumer renders
    // kind === "interrupt" as a red card headed "Critical finding detected",
    // and "ledger"/"edge-glow" render nowhere at all. Comments stripped first —
    // the handler's own comment names the channel it deliberately avoids.
    const code = handler.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/pushNotification/);

    const gate = read(SHORTCUTS_SRC);
    const refusalAt = gate.indexOf("export function clinicalHistoryRefusal(");
    expect(refusalAt, "the shared refusal helper is what makes a refused redo as explainable as a refused undo")
      .toBeGreaterThan(-1);
    const refusal = gate.slice(refusalAt);
    expect(refusal).toMatch(/frame\.activeStudyId !== ws\.activeStudyId/);
    expect(refusal).toMatch(/ws\.isFinalized/);
    expect(refusal, "a refusal that names no recovery is the dead-end refusal PR #863 banned")
      .toMatch(/withdraw the signature/i);
  });
});

describe("signed-state lock — the canonical source is the per-study detail row", () => {
  it("declares the detail query above the locks and reads its status", () => {
    const src = read(CLINICAL_UI_SRC);
    const detailAt = src.indexOf('queryKey: ["pacs-worklist-detail", studyId]');
    const lockAt = src.indexOf("const studyLock = useStudyLock(studyId, {");
    const contentLockedAt = src.indexOf("const contentLocked =");
    const draftBackupAt = src.indexOf("const draftBackup = useLocalDraftBackup({");
    expect(detailAt).toBeGreaterThan(-1);
    // The query used to be declared ~1,500 lines below every decision that needs
    // it, so the locks fell back to the polled queue row.
    expect(detailAt).toBeLessThan(lockAt);
    expect(detailAt).toBeLessThan(contentLockedAt);
    expect(detailAt).toBeLessThan(draftBackupAt);
    // Exactly one declaration — a second useQuery on the same key would be a
    // second source of truth for the same field.
    expect(src.match(/queryKey: \["pacs-worklist-detail", studyId\]/g)).toHaveLength(1);

    // Bound the assertion on the declaration, not a character budget: the row
    // type carries the study identity fields now, and a fixed slice silently
    // dropped `status` out of it and looked like the lock had lost its source.
    const declAt = src.indexOf("const worklistDetailQ = useQuery<{");
    expect(declAt).toBeGreaterThanOrEqual(0);
    const detailBlock = src.slice(declAt, detailAt);
    expect(detailBlock).toMatch(/status\?: string \| null;/);

    const statusBlock = src.slice(detailAt, detailAt + 1400);
    expect(statusBlock).toMatch(/worklistDetailQ\.data\?\.status \?\? workflow\.currentRow\?\.status \?\? null/);
    expect(statusBlock).toMatch(/authoritativeStatus === "REPORT_FINAL" \|\| authoritativeStatus === "DELIVERED"/);
  });

  it("drives all three lock decisions from the authoritative status", () => {
    const src = read(CLINICAL_UI_SRC);
    const lockAt = src.indexOf("const studyLock = useStudyLock(studyId, {");
    const lockBlock = src.slice(lockAt, lockAt + 1400);
    expect(lockBlock).toMatch(/allowEditSigned \|\| !studyIsSignedElsewhere/);
    expect(lockBlock).toMatch(/\(isFinalized \|\| studyIsSignedElsewhere\) && !allowEditSigned/);
    expect(lockBlock).toMatch(/enabled: allowEditSigned \|\| !studyIsSignedElsewhere,/);
    // The queue row is no longer consulted for the lock; it is only the fallback
    // inside `authoritativeStatus` while the detail query is in flight.
    expect(lockBlock).not.toMatch(/workflow\.currentRow\.status !== "REPORT_FINAL"/);
    expect(lockBlock).not.toMatch(/workflow\.currentRow\?\.status !== "REPORT_FINAL"/);
  });

  it("refreshes the detail query after finalize, so the lock does not read a pre-sign row", () => {
    const src = read(FINALIZE_SRC);
    expect(src).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["pacs-worklist-detail", studyId\] \}\)/);
  });
});

describe("re-finalize over an existing report — the discarded-edit path must not look like success", () => {
  it("returns the server's idempotent flag from the shared finalize helper", () => {
    const src = read(LIFECYCLE_SRC);
    expect(src).toMatch(/let reportIdempotent = false;/);
    expect(src).toMatch(/reportIdempotent = report\.idempotent === true;/);
    expect(src).toMatch(/idempotent: reportIdempotent,/);
    expect(src).toMatch(/idempotent\?: boolean;/);
  });

  it("branches on idempotent before any success toast", () => {
    const src = read(FINALIZE_SRC);
    const toastAt = src.indexOf("// 7. Honest toast");
    expect(toastAt).toBeGreaterThan(-1);
    // Sliced to the next numbered step, not a fixed character window: the
    // window silently truncated this block to nothing the first time a branch
    // was added below the idempotent one, and a guard that reads only the first
    // 2000 characters cannot see the toast it is supposed to order.
    const endAt = src.indexOf("// 7b.", toastAt);
    expect(endAt).toBeGreaterThan(toastAt);
    const block = src.slice(toastAt, endAt);
    const idemAt = block.indexOf("if (finalizeResult.idempotent) {");
    const successAt = block.indexOf('title: "Report finalized & signed"');
    expect(idemAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(-1);
    expect(idemAt).toBeLessThan(successAt);
    expect(block.slice(idemAt, successAt)).toMatch(/variant: "destructive"/);
  });

  it("keeps both local backups when the server discarded the content", () => {
    const src = read(FINALIZE_SRC);
    const start = src.indexOf("// 8. Post-finalize cleanup");
    const end = src.indexOf("// 9. Invalidate queries");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const cleanup = src.slice(start, end);

    const guardAt = cleanup.indexOf("if (finalizeResult.idempotent) {");
    const elseAt = cleanup.indexOf("} else {");
    expect(guardAt).toBeGreaterThan(-1);
    expect(elseAt).toBeGreaterThan(guardAt);

    // The guard branch is asserted negatively, field by field: a lazy
    // `[\s\S]*?` across the whole block still matches when the destructive calls
    // are moved INTO the guard, because the copies in the else satisfy it.
    // (Mutation M7 proved that: it was not caught until this was split.)
    const guardBranch = cleanup.slice(guardAt, elseAt);
    expect(guardBranch).toMatch(/cancelFinalize\(\);/);
    expect(guardBranch).not.toMatch(/draftBackup\.clear\(\)/);
    expect(guardBranch).not.toMatch(/clearRescueDraft\(\)/);
    expect(guardBranch).not.toMatch(/completeFinalize\(\)/);
    expect(guardBranch).not.toMatch(/markCompleted\(/);
    expect(guardBranch).not.toMatch(/bumpSessionCompleted\(/);

    const elseBranch = cleanup.slice(elseAt);
    expect(elseBranch).toMatch(
      /draftBackup\.clear\(\);[\s\S]*?clearRescueDraft\(\);[\s\S]*?completeFinalize\(\);/,
    );
  });

  it("does not push a report to Hope that it just said was not saved", () => {
    const src = read(FINALIZE_SRC);
    expect(src).toMatch(/if \(!finalizeResult\.idempotent && finalizeResult\.signed &&/);
  });
});

/**
 * ─── Classification: the mechanism, not the backlog ─────────────────────────
 *
 * Every test above dirties an enumerated list of fields and asserts an
 * enumerated list. An enumerated test cannot notice a field nobody enumerated —
 * which is exactly how `notification`, `copilotItems`, `pendingPathologyPatch`,
 * `activeMacroPrompt` and the pending-format keys survived: clinical state that
 * no list mentioned, so no assertion covered it and the suite stayed green.
 *
 * These tests invert that. They derive the field list from the live store and
 * require every non-action key to be classified as exactly one of:
 *
 *   CLINICAL_RESET_FIELDS — one study's clinical state; must be empty on switch
 *   IDENTITY_CONTEXT_KEYS — owned by the caller, deliberately not in the helper
 *   SESSION_SCOPE_KEYS    — app/session state that must SURVIVE a switch
 *
 * A field added to the store and left unclassified fails here *by name*, so its
 * author has to decide which bucket it belongs in. The failure mode is now
 * safe: forget to classify a clinical field and CI stops, instead of Patient A's
 * state quietly riding along into Patient B's report.
 */

/** The caller owns these; `emptyClinicalState` must never touch them (asserted above). */
const IDENTITY_CONTEXT_KEYS = [
  "activeStudyId",
  "activeStudyInstanceUID",
  "clinicalHistoryText",
  "reportingContext",
] as const;

/**
 * Content libraries, device and UI preferences, and queue progress. None of it
 * belongs to one study, so a switch must leave it alone — clearing the worklist
 * or a content library on every navigation would be its own bug.
 */
const SESSION_SCOPE_KEYS = [
  "studies",
  "nextStudyId",
  "showCommandPalette",
  "showVoiceBar",
  "voiceProvider",
  "completedStudyIds",
  "parkedStudyIds",
  "sessionStartedAt",
  "lastSignAt",
  // C2: a monotonic request counter, not clinical content. It must survive a
  // study switch — resetting it to zero would let a response still in flight
  // from the previous study arrive as the newest one and win the ordering check.
  "ghostRequestSeq",
  "fatigueCardDismissed",
  "criticalSlaMinutes",
  "reportFormats",
  "structuredNormalRows",
  "saveAsFormatDialogOpen",
  "snippetMacros",
  "macroEditorOpen",
  "editingMacro",
  "signOffProfiles",
  "abnormalPatternLibrary",
  "abnormalPatternSuggestionsEnabled",
  "patternUsageCounts",
] as const;

const POISON = "__patient_A__";

function stateKeys(): string[] {
  return Object.entries(useWorkspace.getState() as unknown as Record<string, unknown>)
    .filter(([, v]) => typeof v !== "function")
    .map(([k]) => k);
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => (v instanceof Set ? [...v].sort() : v);
  try {
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  } catch {
    return a === b;
  }
}

/** A value guaranteed to differ from `pristine`, so survival after a reset is detectable. */
function poisonValue(pristine: unknown): unknown {
  if (pristine instanceof Set) return new Set([POISON]);
  if (Array.isArray(pristine)) return [POISON];
  if (typeof pristine === "string") return POISON;
  if (typeof pristine === "boolean") return !pristine;
  if (typeof pristine === "number") return pristine + 4242;
  if (pristine === null || pristine === undefined) return POISON;
  return { [POISON]: true };
}

/** Writes Patient A's fingerprints into every clinical field; returns the keys that took. */
function poisonEveryClinicalField(): string[] {
  const pristine = useWorkspace.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const poisoned: string[] = [];
  for (const key of CLINICAL_RESET_FIELDS) {
    const before = pristine[key];
    const after = poisonValue(before);
    if (!sameValue(before, after)) {
      patch[key] = after;
      poisoned.push(key);
    }
  }
  useWorkspace.setState(patch as never);
  return poisoned;
}

describe("state classification — no store field may be left unclassified", () => {
  it("puts every non-action store key in exactly one bucket", () => {
    const classified = [
      ...([...CLINICAL_RESET_FIELDS] as string[]),
      ...([...IDENTITY_CONTEXT_KEYS] as string[]),
      ...([...SESSION_SCOPE_KEYS] as string[]),
    ];

    const dupes = [...new Set(classified.filter((k, i) => classified.indexOf(k) !== i))];
    expect(dupes, `field classified in two buckets: ${dupes.join(", ")}`).toEqual([]);

    const keys = stateKeys();
    const unclassified = keys.filter((k) => !classified.includes(k));
    expect(
      unclassified,
      `unclassified store field(s): ${unclassified.join(", ")} — `
        + `decide clinical (add to CLINICAL_RESET_FIELDS + emptyClinicalState), `
        + `identity, or session for each. Leaving it out means it survives a study switch.`,
    ).toEqual([]);

    const stale = classified.filter((k) => !keys.includes(k));
    expect(stale, `classified names that are not live store fields: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("study switch — every clinical field must actually be cleared", () => {
  it("PARTIAL reset (worklist navigate / URL sync) clears all of them", () => {
    const poisoned = poisonEveryClinicalField();
    // If a field could not be poisoned, nothing below proves anything about it.
    expect(poisoned).toEqual([...CLINICAL_RESET_FIELDS]);

    useWorkspace.setState({ ...emptyClinicalState(), clinicalHistoryText: "" } as never);

    const after = useWorkspace.getState() as unknown as Record<string, unknown>;
    const empty = emptyClinicalState() as unknown as Record<string, unknown>;
    const survived = poisoned.filter((k) => !sameValue(after[k], empty[k]));
    expect(survived, `Patient A's state survived the switch: ${survived.join(", ")}`).toEqual([]);
  });

  it("FULL reset (selectStudy) clears all of them", () => {
    vi.useFakeTimers();
    try {
      const poisoned = poisonEveryClinicalField();
      useWorkspace.setState({
        studies: [{ id: "study-B", studyInstanceUID: "1.2.840.B", clinicalHistory: "B: 61M, headache" }],
      } as never);

      useWorkspace.getState().selectStudy("study-B");

      const after = useWorkspace.getState() as unknown as Record<string, unknown>;
      const empty = emptyClinicalState() as unknown as Record<string, unknown>;
      const survived = poisoned.filter((k) => !sameValue(after[k], empty[k]));
      expect(survived, `Patient A's state survived selectStudy: ${survived.join(", ")}`).toEqual([]);
      // Identity comes from the study row, not the helper.
      expect(after.activeStudyId).toBe("study-B");
      expect(after.clinicalHistoryText).toBe("B: 61M, headache");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves session state intact while doing it", () => {
    const markers: Record<string, unknown> = {
      showCommandPalette: true,
      fatigueCardDismissed: true,
      criticalSlaMinutes: 30,
      completedStudyIds: new Set(["study-Z"]),
      parkedStudyIds: new Set(["study-Y"]),
    };
    poisonEveryClinicalField();
    useWorkspace.setState(markers as never);

    useWorkspace.setState({ ...emptyClinicalState(), clinicalHistoryText: "" } as never);

    const after = useWorkspace.getState() as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(markers)) {
      expect(sameValue(after[key], value), `session field clobbered by the reset: ${key}`).toBe(true);
    }
  });
});

/**
 * A worklist row with a patient attached. `recomputeCopilot` returns early
 * without one (`if (!st?.patient)`), so any test that needs the copilot to
 * actually run has to build this rather than just setting activeStudyId.
 */
function criticalStudyRow() {
  return {
    id: "study-C",
    accession: "ACC-C",
    studyInstanceUID: "1.2.840.C",
    patient: {
      id: "pt-C",
      name: "Patient C",
      age: 52,
      sex: "M",
      uhid: "UHID-C",
      referringDoctor: "Dr Ref",
    },
    modality: "CT",
    bodyPart: "CHEST",
    studyDescription: "CT chest",
    clinicalHistory: "Sudden breathlessness",
    status: "draft",
    priority: "urgent",
    receivedAt: new Date().toISOString(),
    priorCount: 0,
    criticalFlag: false,
    aiDraftReady: false,
    tatMinutes: 12,
    slaMinutes: 30,
    series: 1,
    images: 240,
  };
}

/**
 * ─── The second-order consequence of an unlisted field ──────────────────────
 *
 * `notification` missing from CLINICAL_RESET_FIELDS did more than show Patient
 * A's card over Patient B's report. `recomputeCopilot` raises the interrupt
 * card AND starts the critical-result SLA clock from inside the same
 * `!get().notification` branch, so a card already on screen suppressed both: an
 * unacknowledged critical finding then ran with no elapsed time being measured
 * at all, which is the half of the defect that reaches a medico-legal record.
 *
 * Resetting the field closes the cross-patient window. Decoupling the clock
 * closes the rest of it — a format-overwrite card on the SAME study, or any
 * future producer of `notification`, still occupies that one slot.
 *
 * Driven through the real `runCopilotAnalysis` ("pneumothorax" in Findings is
 * one of the CRITICAL_PATTERNS in zai-workspace/types.ts) rather than a stub,
 * so this fails if either the rule table or the gate changes.
 *
 * ─── Why this block switches a feature flag on ──────────────────────────────
 * PR-5 made the whole critical-result COMMUNICATION workflow optional behind
 * `ff_radiology_critical_result_comms`, default OFF. The SLA clock and the
 * interrupt card ARE that workflow, so with the flag off `recomputeCopilot`
 * produces neither — and three of these four tests would fail for a reason that
 * has nothing to do with what they were written to prove. The fourth would fail
 * silently in the opposite direction: "does not restart a clock that is already
 * running" would keep passing even if the restart guard were deleted, because a
 * gated-off workflow never starts a clock at all. A test that passes for the
 * wrong reason is worse than one that fails, so all four are pinned here with
 * the workflow explicitly ON, which is the only state in which the decoupling
 * they describe can be observed. The OFF behaviour — no clock, no card, but the
 * detector's rail item still present — is pinned separately and in both
 * directions by lib/criticalResultCommsFlag.behaviour.test.ts.
 */
describe("critical-result SLA clock — must not depend on the interrupt card being renderable", () => {
  beforeEach(() => {
    setServerFeatureFlags({ [CRITICAL_COMMS_FLAG]: true });
  });

  afterAll(() => {
    // Drop the overlay so no later file inherits a switched-on workflow.
    setServerFeatureFlags({});
  });

  /** A study row with a patient, so `recomputeCopilot` gets past its own guard. */
  function openCriticalStudy(notification: WorkspaceStore["notification"]): void {
    useWorkspace.setState({
      studies: [criticalStudyRow()],
      activeStudyId: "study-C",
      activeStudyInstanceUID: "1.2.840.C",
      findingsText: "Large right-sided pneumothorax.",
      impressionText: "",
      copilotItems: [],
      acknowledgedCopilotIds: new Set<string>(),
      criticalSlaStartedAt: null,
      criticalSlaEscalated: false,
      notification,
    } as never);
  }

  it("starts the clock and raises the card when nothing else is on screen", () => {
    openCriticalStudy(null);

    useWorkspace.getState().recomputeCopilot();

    const s = useWorkspace.getState();
    expect(typeof s.criticalSlaStartedAt).toBe("number");
    expect(s.notification?.kind).toBe("interrupt");
    expect(s.notification?.text).toMatch(/pneumothorax/i);
  });

  it("still starts the clock when another card already occupies the slot", () => {
    openCriticalStudy({ kind: "ledger", text: "A card from the previous study", id: "stale" });

    useWorkspace.getState().recomputeCopilot();

    // The regression: the clock used to live inside `!get().notification`.
    expect(typeof useWorkspace.getState().criticalSlaStartedAt).toBe("number");
  });

  it("does not restart a clock that is already running", () => {
    openCriticalStudy(null);
    useWorkspace.setState({ criticalSlaStartedAt: 1_700_000_000_000 } as never);

    useWorkspace.getState().recomputeCopilot();

    expect(useWorkspace.getState().criticalSlaStartedAt).toBe(1_700_000_000_000);
  });

  it("takes the card, the items and the clock away on a study switch", () => {
    openCriticalStudy(null);
    useWorkspace.getState().recomputeCopilot();
    expect(useWorkspace.getState().notification).not.toBeNull();
    expect(useWorkspace.getState().copilotItems.length).toBeGreaterThan(0);

    useWorkspace.setState({ ...emptyClinicalState(), clinicalHistoryText: "" } as never);

    const s = useWorkspace.getState();
    expect(s.notification).toBeNull();
    expect(s.copilotItems).toEqual([]);
    expect(s.criticalSlaStartedAt).toBeNull();
    expect(s.criticalSlaEscalated).toBe(false);
  });
});

/**
 * ─── Clearing the rail is only half of it ───────────────────────────────────
 *
 * Draft hydration writes the new patient's report through `setEditorContent`,
 * and that was the one content writer which never deferred `recomputeCopilot`
 * — setField, mergeField, insertMeasurement, insertAllMeasurements,
 * insertCopilotText and applyMacroWithValues all do. Before `copilotItems`
 * entered CLINICAL_RESET_FIELDS the gap was invisible: the previous patient's
 * items were still sitting in the rail, so it looked populated. Emptying the
 * field exposed it — the rail would have stayed empty until the radiologist's
 * first keystroke, on exactly the studies that have a saved draft.
 */
describe("study switch — the copilot rail is rebuilt for the study now open", () => {
  const CRITICAL = {
    findings: "Large right-sided pneumothorax.",
    impression: "",
    recommendation: "",
    technique: "CT chest",
    clinicalHistory: "Sudden breathlessness",
  };

  it("recomputes once hydration has written the new patient's report", () => {
    vi.useFakeTimers();
    try {
      // Patient A is open and the rail is full of A's items.
      useWorkspace.setState({
        studies: [criticalStudyRow()],
        activeStudyId: "study-A",
        copilotItems: [
          { id: "A-item", kind: "suggestion", title: "A", detail: "A", confidence: "high", source: "A" },
        ],
      } as never);

      // The switch — the PARTIAL reset, exactly as useDraftPersistence performs it.
      useWorkspace.setState({ ...emptyClinicalState(), clinicalHistoryText: "" } as never);
      expect(useWorkspace.getState().copilotItems).toEqual([]);

      // Hydration then writes Patient B's report, and B is the critical one.
      useWorkspace.setState({ activeStudyId: "study-C", activeStudyInstanceUID: "1.2.840.C" } as never);
      useWorkspace.getState().setEditorContent(CRITICAL);

      // Deferred, like every other content writer — nothing has run yet.
      expect(useWorkspace.getState().copilotItems).toEqual([]);

      vi.runAllTimers();

      const items = useWorkspace.getState().copilotItems;
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.kind === "critical")).toBe(true);
      expect(items.every((i) => i.id !== "A-item")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an identical write a genuine no-op — the recompute sits after the early return", () => {
    vi.useFakeTimers();
    try {
      useWorkspace.setState({ studies: [criticalStudyRow()], activeStudyId: "study-C" } as never);
      useWorkspace.getState().setEditorContent(CRITICAL);
      vi.runAllTimers();
      const firstPass = useWorkspace.getState().copilotItems;

      // setFieldIdempotent.test.ts pins the no-op. Prove the early return is
      // still taken by clearing isDirty first: a write that reached the `set`
      // would put it straight back.
      useWorkspace.setState({ isDirty: false } as never);
      useWorkspace.getState().setEditorContent(CRITICAL);
      vi.runAllTimers();

      expect(useWorkspace.getState().isDirty).toBe(false);
      expect(useWorkspace.getState().copilotItems).toEqual(firstPass);
    } finally {
      vi.useRealTimers();
    }
  });
});
