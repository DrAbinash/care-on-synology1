/**
 * A signed report must not still be writable in client state.
 *
 * `completeFinalize` (store.ts) is the ONLY writer of `isFinalized: true`, and
 * nothing rehydrates it from the server's REPORT_FINAL status — so the flag
 * covers the same-session window: the report was signed here, the workspace is
 * still on screen, and something armed before signing fires after it.
 *
 * Of the 23 store actions that write clinical narrative or ledger state, only 5
 * refused to run on a signed study, and one of those (`mergeField`) refused only
 * when `source === "radiologist-voice"` — so dictation was blocked while a tile,
 * a template, the companion panel, the measurement box and an accepted AI ghost
 * all wrote straight through. The four worst were unguarded outright:
 *
 *   setField            — the editor's own onChange, plus setFieldIfEmpty and
 *                         replaceField, which both delegate to it
 *   removeObservation   — deselecting a chip deletes prose from a signed report
 *   applyMergedResult   — the merge preview can be armed before signing and
 *                         applied after it
 *   mergeField          — voice-only, as above
 *
 * These tests pin the corrected contract in three parts: the four mutators
 * refuse and change nothing; the reset/hydration paths that a legitimate reopen
 * depends on still run; and a ratchet over the store's source so the next
 * clinical writer cannot be added unguarded by default.
 *
 * `allowEditSigned` is not part of this: it is permanently false (its only
 * setter call passes false) and `signedReportCorrectionTruth.test.ts` pins that
 * no click handler flips it on, so no authorized correction workflow exists in
 * the client for a guard to break. Correction is a server-side amend, and the
 * server already answers 409 REPORT_LOCKED via `assertDraftWritable`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const here = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(here, "zai-workspace/store.ts"), "utf8");

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const WHOLE_SCREEN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;

function lsContext() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI LS Spine",
    regions: ["LS Spine"],
    source: "auto",
  });
}

function clinicalSnapshot() {
  const s = useWorkspace.getState();
  return {
    clinicalHistoryText: s.clinicalHistoryText,
    techniqueText: s.techniqueText,
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    fieldProvenance: JSON.parse(JSON.stringify(s.fieldProvenance)),
    appliedPathologyPatches: JSON.parse(JSON.stringify(s.appliedPathologyPatches)),
    undoDepth: s.patchUndoStack.length,
    isDirty: s.isDirty,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useWorkspace.setState({
    reportingContext: lsContext(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    studies: [
      { id: "study-signed", patient: { name: "Signed Patient", sex: "F" }, modality: "MR" },
      { id: "study-next", patient: { name: "Next Patient", sex: "M" }, modality: "MR" },
    ],
    activeStudyId: "study-signed",
    activeStudyInstanceUID: "1.2.840.SIGNED",
    clinicalHistoryText: "44F, L5 radiculopathy.",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    isDirty: false,
    isFinalized: false,
    isFinalizing: false,
    completedStudyIds: new Set<string>(),
    confirmOverwriteOpen: false,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    pendingPathologyPatch: null,
    abnormalPatternConfirm: null,
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
  } as never);
});

/** A populated report, then signed the way the workspace signs it. */
function buildSignedReport() {
  const ws = useWorkspace.getState();
  ws.applyPathologyOverlay({
    incoming: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    templates: { findings: DISC_L45.sentence, impression: DISC_L45.impressionSentence },
    ownership: {
      anatomicalSection: DISC_L45.anatomicalSection,
      conflictGroup: DISC_L45.conflictGroup,
      baselineReplaces: DISC_L45.baselineReplaces,
    },
    source: "quick-select",
    id: "qs-disc-l45",
    region: DISC_L45.scopeBodyPart,
    label: DISC_L45.label,
    findingsText: DISC_L45.sentence,
  });
  ws.setField("recommendation", "Clinical correlation advised.", { source: "manual" });

  const populated = useWorkspace.getState();
  expect(populated.appliedPathologyPatches.length).toBeGreaterThan(0);
  expect(populated.findingsText).toContain("L4-L5");
  expect(populated.isFinalized).toBe(false);

  // The real signing action, not setState({ isFinalized: true }) — so the test
  // fails if signing ever stops setting the flag the guard reads.
  useWorkspace.getState().completeFinalize();
  const signed = useWorkspace.getState();
  expect(signed.isFinalized).toBe(true);
  return signed;
}

describe("the four clinical mutators refuse on a signed study", () => {
  it("setField leaves the signed text, provenance and dirty flag alone", () => {
    buildSignedReport();
    const before = clinicalSnapshot();

    useWorkspace.getState().setField("findings", "Something inserted after signing.", { source: "manual" });

    const after = clinicalSnapshot();
    expect(after.findingsText).toBe(before.findingsText);
    expect(after.fieldProvenance).toEqual(before.fieldProvenance);
    expect(after.isDirty).toBe(before.isDirty);
    expect(after.undoDepth).toBe(before.undoDepth);
  });

  it("setFieldIfEmpty and replaceField refuse too, because they delegate", () => {
    buildSignedReport();
    const before = clinicalSnapshot();

    useWorkspace.getState().setFieldIfEmpty("technique", "Added after signing.", "template");
    useWorkspace.getState().replaceField("impression", "Replaced after signing.", "template");

    const after = clinicalSnapshot();
    expect(after.techniqueText).toBe(before.techniqueText);
    expect(after.impressionText).toBe(before.impressionText);
    expect(after.fieldProvenance).toEqual(before.fieldProvenance);
  });

  it("mergeField refuses a tile source, which the voice-only guard let through", () => {
    buildSignedReport();
    const before = clinicalSnapshot();

    // The old guard was `isFinalized && source === "radiologist-voice"`, so this
    // exact call used to write into the signed Findings.
    useWorkspace.getState().mergeField("findings", "Mild disc bulge at L3-L4.", "quick-select");

    expect(useWorkspace.getState().findingsText).toBe(before.findingsText);
    expect(useWorkspace.getState().fieldProvenance).toEqual(before.fieldProvenance);
  });

  it("mergeField still refuses dictation, so the old guard's intent survives", () => {
    buildSignedReport();
    const before = clinicalSnapshot();

    useWorkspace.getState().mergeField("findings", "Dictated after signing.", "radiologist-voice");

    expect(useWorkspace.getState().findingsText).toBe(before.findingsText);
  });

  it("removeObservation returns blocked and keeps both the ledger and the prose", () => {
    buildSignedReport();
    const before = clinicalSnapshot();

    const outcome = useWorkspace.getState().removeObservation("qs-disc-l45");

    expect(outcome).toBe("blocked");
    const after = clinicalSnapshot();
    expect(after.appliedPathologyPatches).toEqual(before.appliedPathologyPatches);
    expect(after.findingsText).toBe(before.findingsText);
    expect(after.impressionText).toBe(before.impressionText);
    expect(after.undoDepth).toBe(before.undoDepth);
  });

  it("applyMergedResult refuses a merge preview that was armed before signing", () => {
    buildSignedReport();

    // Arm the preview while the report is still writable is not possible now, so
    // arm it the only way it can be armed post-sign: straight into the store,
    // which is what a preview left open across the sign action amounts to.
    const picker = useWorkspace.getState();
    picker.toggleFormatSelection(LS_NORMAL.id);
    picker.toggleFormatSelection(WHOLE_SCREEN.id);
    useWorkspace.setState({ mergePreviewOpen: true } as never);
    const before = clinicalSnapshot();

    useWorkspace.getState().applyMergedResult();

    const after = clinicalSnapshot();
    expect(after.findingsText).toBe(before.findingsText);
    expect(after.impressionText).toBe(before.impressionText);
    expect(after.appliedPathologyPatches).toEqual(before.appliedPathologyPatches);
    expect(after.undoDepth).toBe(before.undoDepth);
    // The dialog is closed rather than left open with a dead Apply button — the
    // same shape confirmOverwriteAndApply's finalized branch already used.
    expect(useWorkspace.getState().mergePreviewOpen).toBe(false);
  });

  it("says why it refused instead of failing silently", () => {
    buildSignedReport();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    useWorkspace.getState().setField("findings", "Silent failure is the bug.", { source: "manual" });

    const call = warn.mock.calls.find((c) => String(c[0]).includes("clinical mutation refused"));
    expect(call, "the refusal must be logged").toBeTruthy();
    expect(call![1]).toMatchObject({ action: "setField:findings", activeStudyId: "study-signed" });
  });
});

describe("the reopen paths a legitimate correction depends on are NOT guarded", () => {
  it("setEditorContent still writes, so a signed report can be put on screen", () => {
    buildSignedReport();

    useWorkspace.getState().setEditorContent({
      findings: "Restored signed findings.",
      impression: "Restored signed impression.",
      recommendation: "",
      technique: "",
      clinicalHistory: "44F.",
    });

    expect(useWorkspace.getState().findingsText).toBe("Restored signed findings.");
    expect(useWorkspace.getState().impressionText).toBe("Restored signed impression.");
  });

  it("hydrateObservationLedger still restores the ledger of a signed study", () => {
    buildSignedReport();
    const serialized = useWorkspace.getState().serializeObservationLedger();

    const result = useWorkspace.getState().hydrateObservationLedger(serialized);

    expect(result.ok).toBe(true);
    expect(useWorkspace.getState().appliedPathologyPatches.length).toBeGreaterThan(0);
  });

  it("selectStudy still moves off a signed study and clears the flag", () => {
    buildSignedReport();

    useWorkspace.getState().selectStudy("study-next");

    const s = useWorkspace.getState();
    expect(s.activeStudyId).toBe("study-next");
    expect(s.isFinalized).toBe(false);
    expect(s.findingsText).toBe("");
  });
});

describe("the boundary cannot regress silently", () => {
  const IMPL_START = storeSrc.split(/\r?\n/).findIndex((l) => l.includes("const createWorkspaceStore"));
  const IMPL_END = storeSrc.split(/\r?\n/).findIndex((l) => l.includes("export const useWorkspace"));
  const lines = storeSrc.split(/\r?\n/);
  const METHOD = /^ {2}([A-Za-z_$][\w$]*)\s*:\s*(\(|async )/;
  const CLINICAL_WRITE =
    /^\s*(findingsText|impressionText|recommendationText|techniqueText|clinicalHistoryText|fieldProvenance|appliedPathologyPatches)\s*:/;

  function clinicalWriters(): Array<{ name: string; start: number; end: number }> {
    expect(IMPL_START).toBeGreaterThan(0);
    expect(IMPL_END).toBeGreaterThan(IMPL_START);
    const methods: Array<{ name: string; start: number; end: number }> = [];
    for (let i = IMPL_START + 1; i < IMPL_END; i++) {
      const m = lines[i]!.match(METHOD);
      if (m) methods.push({ name: m[1]!, start: i, end: IMPL_END });
    }
    methods.forEach((mm, idx) => {
      mm.end = idx + 1 < methods.length ? methods[idx + 1]!.start : IMPL_END;
    });
    const writers = new Map<string, { name: string; start: number; end: number }>();
    for (let i = IMPL_START + 1; i < IMPL_END; i++) {
      if (!CLINICAL_WRITE.test(lines[i]!)) continue;
      const owner = [...methods].reverse().find((m) => m.start <= i);
      if (owner) writers.set(owner.name, owner);
    }
    return [...writers.values()];
  }

  function isGuarded(w: { start: number; end: number }): boolean {
    const body = lines.slice(w.start, w.end).join("\n");
    if (body.includes("refuseSignedMutation(")) return true;
    // The guards that predate this PR: an `if` reading isFinalized that returns.
    return /if\s*\(.*isFinalized/.test(body);
  }

  /**
   * Reset / hydration / restore paths. Guarding these would break reopening a
   * signed study to read or print it, which is legitimate and is the only way
   * its content reaches the screen.
   */
  const EXEMPT: Record<string, string> = {
    selectStudy: "a reset path — it spreads emptyClinicalState, so isFinalized is already false",
    setEditorContent: "the hydration entry point; blocking it would blank a reopened signed report",
    hydrateObservationLedger: "restores the ledger when a signed study is reopened for reading or printing",
  };

  /**
   * Clinical writers that are still open. Each is a real hole, listed so the
   * ratchet below can only shrink — a new unguarded writer has to be added here
   * by name, in a diff a reviewer will see.
   *
   * `confirmOverwriteAndApply` is the one entry the source scan counts as
   * guarded: its format branch does block on `isFinalized`, but the
   * `pendingPathologyPatch` branch above that check returns early after calling
   * `undoLastPatch`, so a confirm dialog armed before signing still rewrites the
   * report after it. A per-action boolean cannot express "guarded except for the
   * first branch", which is why it stays listed as open.
   */
  const KNOWN_OPEN: Record<string, string> = {
    insertCopilotText: "writes Findings directly in its comparison branch, bypassing mergeField",
    confirmOverwriteAndApply: "the format branch blocks, but the pendingPathologyPatch branch above it runs undoLastPatch first",
    cancelOverwrite: "calls undoLastPatch on a modal armed before signing",
    applyMultiLevelSpine: "writes Findings from the spine canvas",
    refreshImpressionFromLedger: "rewrites the Impression from the ledger",
    withdrawSystemNormalImpression: "withdraws the system Normal impression",
    undoLastPatch: "Ctrl+Z still rewrites a signed report; canUndoLastAbnormal refuses, this does not",
    applyVoiceComposerPlan: "applies a voice plan; useVoiceReporting gates it at the hook, the store does not",
    applyAiComposerAccepted: "applies accepted AI changes",
    clearVoiceComposerSession: "clears voice observations from the ledger",
    relateralizePatches: "rewrites laterality across the narrative",
    applyMacroWithValues: "expands a snippet macro into a field",
  };

  it("every clinical writer is guarded, exempt with a reason, or listed as open with a reason", () => {
    const writers = clinicalWriters();
    expect(writers.length).toBeGreaterThanOrEqual(20);

    const unaccounted = writers.filter(
      (w) => !isGuarded(w) && !(w.name in EXEMPT) && !(w.name in KNOWN_OPEN),
    );
    expect(
      unaccounted.map((w) => w.name),
      "a new clinical writer must be guarded or explicitly classified — it may not be unguarded by default",
    ).toEqual([]);
  });

  it("the four mutators this PR guards are detected as guarded", () => {
    const writers = clinicalWriters();
    for (const name of ["setField", "mergeField", "removeObservation", "applyMergedResult"]) {
      const w = writers.find((x) => x.name === name);
      expect(w, `${name} must still write clinical state`).toBeTruthy();
      expect(isGuarded(w!), `${name} lost its signed-study guard`).toBe(true);
      expect(w!.name in KNOWN_OPEN, `${name} is guarded and must leave the open list`).toBe(false);
    }
  });

  it("no exempt or open entry has gone stale", () => {
    const names = new Set(clinicalWriters().map((w) => w.name));
    for (const n of [...Object.keys(EXEMPT), ...Object.keys(KNOWN_OPEN)]) {
      expect(names.has(n), `${n} no longer writes clinical state — remove it from the list`).toBe(true);
    }
  });

  it("an entry that gains the central guard leaves the open list", () => {
    // List hygiene in the other direction: once a writer calls the predicate it
    // is no longer open, and leaving it listed would keep the ratchet number
    // high while the real count fell. `confirmOverwriteAndApply` is deliberately
    // exempt from this check — its legacy `if` is why it is still listed.
    const fixed = clinicalWriters().filter(
      (w) => w.name in KNOWN_OPEN
        && lines.slice(w.start, w.end).join("\n").includes("refuseSignedMutation("),
    );
    expect(fixed.map((w) => w.name), "now guarded by refuseSignedMutation — remove from KNOWN_OPEN").toEqual([]);
  });

  it("the open list can only shrink", () => {
    // Ratchet: 12 of 23 clinical writers were still open when this boundary was
    // installed. Guarding one is progress and must lower this number; adding a
    // new unguarded writer must raise it and fail here.
    expect(Object.keys(KNOWN_OPEN).length).toBeLessThanOrEqual(12);
  });

  it("refuseSignedMutation is the single decision point", () => {
    // One predicate, so the refusal wording and the study id it reports cannot
    // drift between mutators the way the guards already in the file had.
    const decls = storeSrc.match(/function refuseSignedMutation\(/g) ?? [];
    expect(decls).toHaveLength(1);
    const calls = storeSrc.match(/refuseSignedMutation\(get\(\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // No mutator may re-introduce a one-off isFinalized check that skips the
    // shared warning.
    expect(storeSrc).not.toContain('if (get().isFinalized && source === "radiologist-voice") return;');
  });
});
