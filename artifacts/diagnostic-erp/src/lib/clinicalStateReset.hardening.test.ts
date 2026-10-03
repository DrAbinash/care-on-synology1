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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLINICAL_RESET_FIELDS,
  emptyClinicalState,
} from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const STORE_SRC = "lib/zai-workspace/store.ts";
const RESET_SRC = "lib/zai-workspace/clinicalStateReset.ts";
const DRAFT_SRC = "hooks/radiology-workspace/useDraftPersistence.ts";
const CLINICAL_UI_SRC = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const COMMANDS_SRC = "hooks/radiology-workspace/useWorkspaceCommands.ts";
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
    expect(src).toMatch(/import \{ emptyClinicalState \} from "@\/lib\/zai-workspace\/clinicalStateReset";/);
    expect(src).toMatch(/useWorkspace\.setState\(\{\s*\.\.\.emptyClinicalState\(\),\s*clinicalHistoryText: "",\s*\}\);/);
    // The old hand-maintained list must be gone, not merely added to.
    expect(src).not.toMatch(/abnormalPatternConfirm:\s*null,\s*\.\.\.\(useWorkspace\.getState\(\)/);
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

  it("surfaces a refused undo at Ctrl+Shift+Z instead of failing silently", () => {
    const src = read(COMMANDS_SRC);
    const block = src.slice(src.indexOf('e.ctrlKey && e.shiftKey && (e.key === "z"'));
    const handler = block.slice(0, 1800);
    expect(handler).toMatch(/undoLastPatch\(\)/);
    expect(handler).toMatch(/topFrame\.activeStudyId !== ws\.activeStudyId/);
    expect(handler).toMatch(/variant: "destructive"/);
    // pushNotification is not a usable channel: its only consumer renders
    // kind === "interrupt" as a red card headed "Critical finding detected",
    // and "ledger"/"edge-glow" render nowhere at all. Comments stripped first —
    // the handler's own comment names the channel it deliberately avoids.
    const code = handler.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/pushNotification/);
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

    const detailBlock = src.slice(detailAt - 260, detailAt + 320);
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
    const block = src.slice(toastAt, toastAt + 2000);
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
