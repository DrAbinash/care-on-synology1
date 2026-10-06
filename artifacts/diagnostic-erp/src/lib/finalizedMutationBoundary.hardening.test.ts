/**
 * A signed report must not still be writable in client state.
 *
 * `completeFinalize` (store.ts) is the ONLY writer of `isFinalized: true`, and
 * nothing rehydrates it from the server's REPORT_FINAL status — so the flag
 * covers the same-session window: the report was signed here, the workspace is
 * still on screen, and something armed before signing fires after it.
 *
 * When this boundary was installed, 5 of the store's clinical writers refused to
 * run on a signed study, and one of those (`mergeField`) refused only when
 * `source === "radiologist-voice"`. The twelve that stayed open were listed by
 * name under a ratchet that could only shrink. That list is now empty, and both
 * of its numbers were wrong.
 *
 * The scan behind them matched a clinical key only at the start of a line, so it
 * could not see a single-line `set({ impressionText: ... })`
 * (`orderImpressionByPriority`), a shorthand property (`setLinkedStudies`,
 * `clearLinkedStudy`) or a computed `[fieldTextKey(...)]` key
 * (`applyMacroWithValues`, counted only by its neighbouring `fieldProvenance`
 * write). It also counted one that writes nothing at all: `applyMultiLevelSpine`'s
 * matched line was an argument to `applyPathologyOverlay`, not a set() payload.
 * Fourteen of the 25 direct writers were open, not twelve of twenty-three. The
 * scanner now extracts every set() argument by paren matching, skipping strings
 * and comments, because loosening the line pattern instead counts destructuring
 * READS as writes (`recomputeCopilot`, `applySelectedFormats`).
 *
 * Of the 25, eighteen now refuse through the shared predicate, four keep a named
 * one-off `isFinalized` check under an allowlist that has to state why, and three
 * are the reset/hydration paths a legitimate reopen depends on.
 *
 * What this closes is the on-screen report diverging from the signed artifact: the
 * radiologist reads, prints or quotes a report that no longer says what was
 * signed. It is not the persistence boundary — `useDraftPersistence` already
 * refuses to autosave while `isFinalized`.
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
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { VoiceChangePlan } from "@/lib/voiceReportComposer/types";

const here = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(here, "zai-workspace/store.ts"), "utf8");
const commandsSrc = readFileSync(
  join(here, "../hooks/radiology-workspace/useWorkspaceCommands.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

const LS_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const WHOLE_SCREEN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!;
const DISC_L45 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;
/** A second, different tile: the overwrite cases need a visible diff to control against. */
const OTHER_TILE = DEFAULT_QUICK_SELECT_TILES.find(
  (t) => t.label !== DISC_L45.label && !!t.sentence && !!t.impressionSentence && !!t.scopeBodyPart,
)!;

function voicePlan(
  obs: Array<{ concept: string; level?: string; findingsText: string; impressionText?: string }>,
): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: obs.map((o) => ({
      concept: o.concept,
      level: o.level,
      findingsText: o.findingsText,
      impressionText: o.impressionText,
    })),
    removeConflictingBaselineConcepts: [],
    impressionCandidates: [],
    impressionUpdate: undefined,
    uncertainties: [],
    clarificationRequired: null,
  };
}

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
  // The production reset, not a hand-listed one. A hand-listed reset leaks: the
  // `refreshImpressionFromLedger` arm writes the Impression by hand, which freezes
  // its order (§37), and a `beforeEach` that omitted `impressionOrderFrozen` left
  // every later case unable to reorder. Only the identity and context fields this
  // function deliberately does not own are set by hand.
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: lsContext(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    studies: [
      { id: "study-signed", patient: { name: "Signed Patient", sex: "F" }, modality: "MR" },
      { id: "study-next", patient: { name: "Next Patient", sex: "M" }, modality: "MR" },
    ],
    activeStudyId: "study-signed",
    activeStudyInstanceUID: "1.2.840.SIGNED",
    clinicalHistoryText: "44F, L5 radiculopathy.",
    completedStudyIds: new Set<string>(),
  } as never);
});

type Tile = (typeof DEFAULT_QUICK_SELECT_TILES)[number];

/** Apply a Quick Select tile the way the canvas does. */
function tileOverlay(tile: Tile, id: string) {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
  });
}

/** The same tile as a same-slot overwrite waiting in the confirm dialog. */
function pendingFrom(tile: Tile, id: string) {
  return {
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
  };
}

/** A populated report, still writable. `arm` in the table below runs after this. */
function populateReport() {
  tileOverlay(DISC_L45, "qs-disc-l45");
  useWorkspace.getState().setField("recommendation", "Clinical correlation advised.", { source: "manual" });

  const populated = useWorkspace.getState();
  expect(populated.appliedPathologyPatches.length).toBeGreaterThan(0);
  expect(populated.findingsText).toContain("L4-L5");
  expect(populated.isFinalized).toBe(false);
}

/** The real signing action, not setState({ isFinalized: true }) — so every test
 *  below fails if signing ever stops setting the flag the guard reads. */
function sign() {
  useWorkspace.getState().completeFinalize();
  expect(useWorkspace.getState().isFinalized).toBe(true);
}

/** A populated report, then signed the way the workspace signs it. */
function buildSignedReport() {
  populateReport();
  sign();
  return useWorkspace.getState();
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

/**
 * The remaining thirteen holes.
 *
 * Every case runs TWICE. Once signed, asserting nothing moved; once unsigned as a
 * positive control, asserting the very same call DOES move something. The control
 * is the part that matters: an un-armed action proves nothing, because
 * `undoLastPatch` on an empty stack and `withdrawSystemNormalImpression` with no
 * Normal patch both "change nothing" whether or not the guard exists. A case whose
 * control stops producing a diff has stopped testing the guard and fails loudly.
 *
 * `arm` runs after `populateReport()` and before signing, which is the only order
 * that reproduces the real defect — state armed while the report was writable,
 * fired after it was signed.
 */
const GUARD_CASES: Array<{
  action: string;
  /** Skip the populated LS report; the case builds its own precondition. */
  bare?: boolean;
  arm: () => void;
  call: () => unknown;
  refusal: unknown;
}> = [
  {
    // The copilot rail is one of the few surfaces the canvas does not disable on a
    // signed study — it receives `measureDisabled` only — so its Insert button is
    // live and this guard is the only thing behind it.
    action: "insertCopilotText",
    arm: () => {},
    call: () => useWorkspace.getState().insertCopilotText({
      id: "copilot-comparison",
      kind: "suggestion",
      title: "No comparison",
      detail: "Add a prior-study comparison.",
      insertText: "Comparison with the previous study.",
      confidence: "high",
      source: "lint",
      studyId: useWorkspace.getState().activeStudyId,
    }),
    refusal: undefined,
  },
  {
    // The branch that the old `if (get().isFinalized)` never reached: it returns
    // before that check, after calling undoLastPatch and re-applying the patch.
    // Armed with a DIFFERENT tile so the unsigned control has a visible diff.
    action: "confirmOverwriteAndApply",
    arm: () => {
      useWorkspace.setState({
        confirmOverwriteOpen: true,
        pendingPathologyPatch: pendingFrom(OTHER_TILE, "qs-other"),
      } as never);
    },
    call: () => useWorkspace.getState().confirmOverwriteAndApply(),
    refusal: undefined,
  },
  {
    // Cancel is not a plain dismiss: it undoes the pending patch and re-inserts the
    // vacated chip. The dialog must still close on a signed report.
    action: "cancelOverwrite",
    arm: () => {
      useWorkspace.setState({
        confirmOverwriteOpen: true,
        pendingPathologyPatch: pendingFrom(OTHER_TILE, "qs-other"),
      } as never);
    },
    call: () => useWorkspace.getState().cancelOverwrite(),
    refusal: undefined,
  },
  {
    action: "setLinkedStudies",
    arm: () => {},
    call: () => useWorkspace.getState().setLinkedStudies(
      { studyId: "study-signed", title: "MRI LS Spine" },
      { studyId: "study-linked", title: "MRI Cervical Spine" },
    ),
    refusal: undefined,
  },
  {
    // Unlinking flattens two sectioned Findings back into one body: a rewrite of
    // signed prose even though nothing clinical is added or removed.
    action: "clearLinkedStudy",
    arm: () => useWorkspace.getState().setLinkedStudies(
      { studyId: "study-signed", title: "MRI LS Spine" },
      { studyId: "study-linked", title: "MRI Cervical Spine" },
    ),
    call: () => useWorkspace.getState().clearLinkedStudy(),
    refusal: undefined,
  },
  {
    // Armed with a hand-written Impression so the refresh has something to
    // overwrite; the unsigned control is the whole point of this action.
    action: "refreshImpressionFromLedger",
    arm: () => useWorkspace.getState().setField("impression", "Hand-written impression.", { source: "manual" }),
    call: () => useWorkspace.getState().refreshImpressionFromLedger(),
    refusal: undefined,
  },
  {
    // A reorder is still a write. A hand-typed Impression cannot be used to arm
    // this: manual provenance freezes the order (§37), so the action would
    // correctly do nothing signed or unsigned and the control would prove nothing.
    // Arm a second ledger contribution instead and reverse the lines it actually
    // produced — the explicit `proposed` path the brain-vascular caller uses.
    action: "orderImpressionByPriority",
    arm: () => tileOverlay(OTHER_TILE, "qs-other"),
    call: () => {
      const before = useWorkspace.getState().impressionText
        .split(/\n+/).map((s) => s.trim()).filter(Boolean);
      expect(before.length, "this case needs at least two Impression lines").toBeGreaterThanOrEqual(2);
      return useWorkspace.getState().orderImpressionByPriority([...before].reverse());
    },
    refusal: false,
  },
  {
    // Needs a clean report: seeding refuses while an impression-worthy abnormal
    // observation exists, which is its own safety rule and not this PR's business.
    action: "withdrawSystemNormalImpression",
    bare: true,
    arm: () => {
      useWorkspace.getState().seedSystemNormalImpression();
      expect(
        useWorkspace.getState().appliedPathologyPatches.length,
        "the Normal patch must exist for this case to mean anything",
      ).toBeGreaterThan(0);
    },
    call: () => useWorkspace.getState().withdrawSystemNormalImpression(),
    refusal: undefined,
  },
  {
    // Ctrl+Shift+Z. The frame must stay on the stack so useWorkspaceCommands can
    // tell "refused" from "nothing to undo".
    action: "undoLastPatch",
    arm: () => {
      expect(useWorkspace.getState().patchUndoStack.length).toBeGreaterThan(0);
    },
    call: () => useWorkspace.getState().undoLastPatch(),
    refusal: false,
  },
  {
    action: "applyVoiceComposerPlan",
    arm: () => {},
    call: () => useWorkspace.getState().applyVoiceComposerPlan(
      voicePlan([{ concept: "disc_contour", level: "L3-L4", findingsText: "Dictated disc bulge at L3-L4." }]),
      "dictated after signing",
      { force: true },
    ),
    refusal: "blocked",
  },
  {
    action: "applyAiComposerAccepted",
    arm: () => {},
    call: () => useWorkspace.getState().applyAiComposerAccepted({
      findings: "AI reworded the findings.",
      impression: "AI reworded the impression.",
      recommendation: "AI reworded the recommendation.",
    }),
    refusal: "blocked",
  },
  {
    // Zero callers today; armed through a real voice plan so the ledger has a
    // voice-* observation for the action to drop.
    action: "clearVoiceComposerSession",
    arm: () => {
      const r = useWorkspace.getState().applyVoiceComposerPlan(
        voicePlan([{ concept: "disc_contour", level: "L3-L4", findingsText: "Dictated disc bulge at L3-L4." }]),
        "t",
        { force: true },
      );
      expect(r, "the voice plan must apply for this case to mean anything").toBe("applied");
      expect(
        useWorkspace.getState().appliedPathologyPatches.some((p) => p.id.startsWith("voice-")),
        "a voice-* observation must exist for this case to mean anything",
      ).toBe(true);
    },
    call: () => useWorkspace.getState().clearVoiceComposerSession(),
    refusal: undefined,
  },
  {
    action: "relateralizePatches",
    arm: () => useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "Left foraminal narrowing at L4-L5." },
      templates: { findings: "Left foraminal narrowing at L4-L5." },
      ownership: { anatomicalSection: "foramen", conflictGroup: "foraminal_narrowing" },
      source: "quick-select",
      id: "qs-foramen-left",
      region: "LS Spine",
      label: "Foraminal narrowing",
      laterality: "left",
      supportsLaterality: true,
      properties: "side",
      findingsText: "Left foraminal narrowing at L4-L5.",
    }),
    call: () => useWorkspace.getState().relateralizePatches("right"),
    refusal: undefined,
  },
  {
    // Its clinical write uses a COMPUTED key (`[fieldTextKey(p.field)]`), which is
    // why no line-anchored scan could ever see it.
    action: "applyMacroWithValues",
    arm: () => useWorkspace.getState().setActiveMacroPrompt({
      macro: {
        id: "macro-nl",
        trigger: "nl",
        label: "No lesion",
        template: "No focal lesion.",
        variables: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      field: "findings",
      startPos: useWorkspace.getState().findingsText.length,
    }),
    call: () => useWorkspace.getState().applyMacroWithValues({}),
    refusal: undefined,
  },
  {
    // The Quick Select strip is the highest-traffic control in the workspace and
    // takes no `disabled` prop at all, so a findings or impression tile is still
    // clickable after signing. `refusal: "applied"` is not a typo — this mutator
    // reports success on refusal, because its declared return type is
    // `"applied" | "pending"` and three internal callers branch on the value.
    // Widening it is a behaviour change that belongs in its own PR; the point of
    // pinning it here is that the refusal now goes through the shared predicate
    // and is therefore both logged and announced.
    action: "applyPathologyOverlay",
    arm: () => {},
    call: () => useWorkspace.getState().applyPathologyOverlay({
      ...pendingFrom(OTHER_TILE, "qs-guard-case"),
      force: true,
    }),
    refusal: "applied",
  },
];

function runGuardCase(c: (typeof GUARD_CASES)[number], signed: boolean) {
  if (!c.bare) populateReport();
  c.arm();
  if (signed) sign();
  const before = clinicalSnapshot();
  const returned = c.call();
  return { before, after: clinicalSnapshot(), returned };
}

describe("every remaining clinical writer refuses on a signed study", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  for (const c of GUARD_CASES) {
    it(`${c.action} changes nothing and says why`, () => {
      const { before, after, returned } = runGuardCase(c, true);

      expect(returned, `${c.action} must report the refusal through its own return type`).toBe(c.refusal);
      expect(after, `${c.action} wrote to a signed report`).toEqual(before);
      // The shared predicate, not a one-off `if`: the wording and the study id it
      // reports cannot drift between mutators.
      const call = warn.mock.calls.find((a) => String(a[0]).includes("clinical mutation refused"));
      expect(call, `${c.action} must refuse through refuseSignedMutation`).toBeTruthy();
      expect(call![1]).toMatchObject({ action: c.action, activeStudyId: "study-signed" });
    });

    it(`${c.action} does write when the report is NOT signed (positive control)`, () => {
      const { before, after } = runGuardCase(c, false);

      expect(
        after,
        `${c.action}: this case proves nothing unless the same call really writes — fix the arm, not the guard`,
      ).not.toEqual(before);
    });
  }

  // Refusing must not strand a modal on a signed report: a dialog that cannot be
  // closed is worse than one that closes having changed nothing. One `it` each, so
  // the root beforeEach resets the store between them.
  for (const action of ["confirmOverwriteAndApply", "cancelOverwrite"] as const) {
    it(`${action} still closes the overwrite dialog it refused`, () => {
      runGuardCase(GUARD_CASES.find((c) => c.action === action)!, true);
      const s = useWorkspace.getState();
      expect(s.confirmOverwriteOpen).toBe(false);
      expect(s.pendingPathologyPatch).toBe(null);
    });
  }

  it("applyMacroWithValues still closes the prompt it refused", () => {
    runGuardCase(GUARD_CASES.find((c) => c.action === "applyMacroWithValues")!, true);
    expect(useWorkspace.getState().activeMacroPrompt).toBe(null);
  });

  it("undoLastPatch leaves the frame on the stack, so the refusal is distinguishable", () => {
    const c = GUARD_CASES.find((x) => x.action === "undoLastPatch")!;
    populateReport();
    c.arm();
    sign();
    const depth = useWorkspace.getState().patchUndoStack.length;

    expect(useWorkspace.getState().undoLastPatch()).toBe(false);

    // useWorkspaceCommands reads the top frame after the call to decide whether
    // Ctrl+Shift+Z owes the radiologist an explanation. Popping it would make
    // "refused" indistinguishable from "nothing to undo".
    expect(useWorkspace.getState().patchUndoStack).toHaveLength(depth);
  });
});

/**
 * Three bundle actions are not clinical writers: every prose and ledger write they
 * make goes through `applyPathologyOverlay` / `removeObservation`, which already
 * refused before this PR. What was left was their own trailing
 * `set({ ...withPushedClinicalUndo(...), isDirty: true })` — an undo frame and a
 * dirty flag on a report that can no longer be edited. They are guarded and pinned
 * here rather than in the table above, which is scoped to the writers the ratchet
 * enumerates.
 */
describe("the bundle actions cannot dirty a signed study either", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const BUNDLE_CASES: Array<{ action: string; arm: () => void; call: () => unknown }> = [
    {
      action: "applyMacroBundle",
      arm: () => {},
      call: () => useWorkspace.getState().applyMacroBundle({
        bundleId: "bundle-test",
        observations: [pendingFrom(OTHER_TILE, "bundle-test-1")],
      }),
    },
    {
      action: "applyMultiLevelSpine",
      arm: () => {},
      call: () => useWorkspace.getState().applyMultiLevelSpine({
        bundleId: "spine-bundle-test",
        region: "LS Spine",
        levels: [{ level: "L3-L4", concept: "disc_contour", findingsText: "Disc bulge at L3-L4." }],
      }),
    },
    {
      action: "removeMacroBundle",
      arm: () => {
        const r = useWorkspace.getState().applyMacroBundle({
          bundleId: "bundle-test",
          observations: [pendingFrom(OTHER_TILE, "bundle-test-1")],
        });
        expect(r, "the bundle must apply for this case to mean anything").toBe("applied");
      },
      call: () => useWorkspace.getState().removeMacroBundle("bundle-test"),
    },
  ];

  for (const c of BUNDLE_CASES) {
    it(`${c.action} refuses on a signed study, undo frame and dirty flag included`, () => {
      populateReport();
      c.arm();
      sign();
      const before = clinicalSnapshot();

      const returned = c.call();

      expect(returned).toBe("blocked");
      expect(clinicalSnapshot()).toEqual(before);
      const call = warn.mock.calls.find((a) => String(a[0]).includes("clinical mutation refused"));
      expect(call, `${c.action} must refuse through refuseSignedMutation`).toBeTruthy();
      expect(call![1]).toMatchObject({ action: c.action, activeStudyId: "study-signed" });
    });

    it(`${c.action} does write when the report is NOT signed (positive control)`, () => {
      populateReport();
      c.arm();
      const before = clinicalSnapshot();

      c.call();

      expect(
        clinicalSnapshot(),
        `${c.action}: this case proves nothing unless the same call really writes — fix the arm, not the guard`,
      ).not.toEqual(before);
    });
  }
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
  const src = storeSrc.replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const IMPL_START = lines.findIndex((l) => l.includes("const createWorkspaceStore"));
  const IMPL_END = lines.findIndex((l) => l.includes("export const useWorkspace"));
  const METHOD = /^ {2}([A-Za-z_$][\w$]*)\s*:\s*(\(|async )/;
  const CLINICAL_KEYS = [
    "findingsText",
    "impressionText",
    "recommendationText",
    "techniqueText",
    "clinicalHistoryText",
    "fieldProvenance",
    "appliedPathologyPatches",
  ];
  // A clinical write is one of those keys as a PROPERTY or a SHORTHAND property of
  // a set() payload, or a computed `[fieldTextKey(...)]` key.
  const PROPERTY = new RegExp(`(^|[{,])\\s*(${CLINICAL_KEYS.join("|")})\\s*[:,}]`);
  const COMPUTED_KEY = /\[fieldTextKey\(/;

  /**
   * The argument text of every `set(...)` / `setState(...)` call in the file, with
   * its 0-based line, paren-matched and skipping strings and comments.
   *
   * Matching lines instead of payloads is what let three writers go uncounted: a
   * single-line `set({ impressionText: ... })` is not anchored at the start of a
   * line, a shorthand `findingsText,` has no colon, and `[fieldTextKey(p.field)]:`
   * has no literal key at all. Loosening the line pattern to compensate counts
   * READS as writes — `recomputeCopilot` and `applySelectedFormats` both
   * destructure the five texts from `get()` and neither writes one — so the
   * payload is extracted rather than guessed at.
   */
  function setPayloads(): Array<{ line: number; arg: string }> {
    const out: Array<{ line: number; arg: string }> = [];
    const callRe = /\bset(?:State)?\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      const argStart = m.index + m[0].length;
      let i = argStart;
      let depth = 1;
      let quote: string | null = null;
      while (i < src.length && depth > 0) {
        const ch = src[i]!;
        if (quote) {
          if (ch === "\\") { i += 2; continue; }
          if (ch === quote) quote = null;
          i++;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
        if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
        if (ch === "/" && src[i + 1] === "*") {
          i += 2;
          while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
          i += 2;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      out.push({ line: src.slice(0, m.index).split("\n").length - 1, arg: src.slice(argStart, Math.max(argStart, i - 1)) });
    }
    return out;
  }

  const PAYLOADS = setPayloads();

  function clinicalWriters(): Array<{ name: string; start: number; end: number }> {
    expect(IMPL_START).toBeGreaterThan(0);
    expect(IMPL_END).toBeGreaterThan(IMPL_START);
    const methods: Array<{ name: string; start: number; end: number }> = [];
    for (let i = IMPL_START + 1; i < IMPL_END; i++) {
      const mm = lines[i]!.match(METHOD);
      if (mm) methods.push({ name: mm[1]!, start: i, end: IMPL_END });
    }
    methods.forEach((mm, idx) => {
      mm.end = idx + 1 < methods.length ? methods[idx + 1]!.start : IMPL_END;
    });
    const writers = new Map<string, { name: string; start: number; end: number }>();
    for (const p of PAYLOADS) {
      if (!PROPERTY.test(p.arg) && !COMPUTED_KEY.test(p.arg)) continue;
      const owner = [...methods].reverse().find((mm) => mm.start <= p.line && p.line < mm.end);
      if (owner) writers.set(owner.name, owner);
    }
    return [...writers.values()];
  }

  /**
   * Actions whose signed-study refusal predates this boundary and reads
   * `isFinalized` directly instead of calling the shared predicate. Each is listed
   * by name so that a NEW action cannot claim the same weakness: without this
   * allowlist any `if (…isFinalized…)` anywhere in a body — even one that does not
   * return, even one on a branch that never runs — would satisfy the ratchet. That
   * is exactly how `confirmOverwriteAndApply` was classified as guarded while its
   * first branch stayed open.
   */
  const LEGACY_IF_GUARD: Record<string, string> = {
    seedSystemNormalImpression: "one of three stacked safety refusals, the other two being clinical and not about signing",
    applyComposerFinding: 'already returns "blocked"; its guard is the first statement',
    setObservationImpressionParticipation: "its guard is the first statement",
  };

  function isGuarded(w: { name: string; start: number; end: number }): boolean {
    const body = lines.slice(w.start, w.end).join("\n");
    if (body.includes("refuseSignedMutation(")) return true;
    return w.name in LEGACY_IF_GUARD && /if\s*\(.*isFinalized/.test(body);
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
   * Clinical writers that are still open. Empty, and the ratchet below requires it
   * to stay empty: a new unguarded writer now fails outright instead of being
   * added to a list a reviewer has to notice growing.
   *
   * Two entries that used to be here are gone for opposite reasons.
   * `confirmOverwriteAndApply` was a real hole and is now guarded above both of its
   * branches. `applyMultiLevelSpine` was never a direct clinical writer — the line
   * the old scanner matched was an argument to `applyPathologyOverlay`, not a set()
   * payload — but it did grow the undo stack and dirty a signed study, so it is
   * guarded and pinned in BUNDLE_CASES below. `applySelectedFormats` was only ever
   * counted from a destructuring read: its own set() writes are modal keys, and
   * its content write is delegated to the now-guarded `confirmOverwriteAndApply`.
   */
  const KNOWN_OPEN: Record<string, string> = {};

  it("every clinical writer is guarded or exempt with a written reason", () => {
    const writers = clinicalWriters();
    expect(writers.length).toBeGreaterThanOrEqual(25);

    const unaccounted = writers.filter(
      (w) => !isGuarded(w) && !(w.name in EXEMPT) && !(w.name in KNOWN_OPEN),
    );
    expect(
      unaccounted.map((w) => w.name),
      "a new clinical writer must be guarded or explicitly classified — it may not be unguarded by default",
    ).toEqual([]);
  });

  it("the scanner is not vacuous", () => {
    // Positive controls. "No unguarded writers" over a static parse is worthless if
    // the parse silently returns nothing — the same trap as routeCollisions.test.ts.
    const writers = clinicalWriters();
    expect(PAYLOADS.length).toBeGreaterThan(100);
    for (const name of [
      // one per blind-spot class the widened scanner was written to catch
      "setField",                    // multi-line object literal
      "orderImpressionByPriority",   // single-line, key not at line start
      "setLinkedStudies",            // shorthand property
      "clearLinkedStudy",            // shorthand property
      "applyMacroWithValues",        // computed [fieldTextKey(...)] key
      "applyComposerFinding",        // single-line, key not at line start
    ]) {
      expect(writers.some((w) => w.name === name), `${name} writes clinical state and must be counted`).toBe(true);
    }
    // And the reads it must NOT count.
    for (const name of ["recomputeCopilot", "applySelectedFormats"]) {
      expect(writers.some((w) => w.name === name), `${name} only reads the clinical texts`).toBe(false);
    }
  });

  it("the payload matchers still recognise what they were widened for", () => {
    // Pinned directly rather than through the inventory, and against a literal
    // list rather than CLINICAL_KEYS itself — iterating the list under test cannot
    // notice an entry being deleted from it. The store's only computed-key set()
    // today also writes `fieldProvenance`, so a COMPUTED_KEY that matched nothing
    // would not drop a single writer from the count either.
    const keys = [
      "findingsText",
      "impressionText",
      "recommendationText",
      "techniqueText",
      "clinicalHistoryText",
      "fieldProvenance",
      "appliedPathologyPatches",
    ];
    expect(CLINICAL_KEYS, "a clinical key left the scanner's list").toEqual(keys);
    expect(COMPUTED_KEY.test("[fieldTextKey(p.field)]: assembled,")).toBe(true);
    for (const key of keys) {
      expect(PROPERTY.test(`{ ${key}: next,`), `${key} as a property must count`).toBe(true);
      expect(PROPERTY.test(`{ ${key},`), `${key} as a shorthand property must count`).toBe(true);
    }
  });
  it("the guard classifier can still say no", () => {
    // The ratchet's verdict is worth nothing if `isGuarded` cannot return false: an
    // always-true classifier reports "no unguarded writers" over any source at all.
    // An empty span is a writer with no body, so nothing in it can be a guard.
    expect(isGuarded({ name: "notAMethod", start: 0, end: 0 })).toBe(false);
    // And allowlist membership alone is not a pass — the entry still has to carry
    // its own isFinalized check in the body, or the allowlist becomes a hiding place.
    expect(isGuarded({ name: "applyComposerFinding", start: 0, end: 0 })).toBe(false);
  });
  it("the mutators this boundary guards are detected as guarded", () => {
    const writers = clinicalWriters();
    const guardedByPredicate = [
      "setField", "mergeField", "removeObservation", "applyMergedResult",
      "insertCopilotText", "confirmOverwriteAndApply", "cancelOverwrite",
      "setLinkedStudies", "clearLinkedStudy", "refreshImpressionFromLedger",
      "orderImpressionByPriority", "withdrawSystemNormalImpression", "undoLastPatch",
      "applyVoiceComposerPlan", "applyAiComposerAccepted", "clearVoiceComposerSession",
      "relateralizePatches", "applyMacroWithValues", "applyPathologyOverlay",
    ];
    for (const name of guardedByPredicate) {
      const w = writers.find((x) => x.name === name);
      expect(w, `${name} must still write clinical state`).toBeTruthy();
      const body = lines.slice(w!.start, w!.end).join("\n");
      expect(body.includes("refuseSignedMutation("), `${name} lost the shared signed-study guard`).toBe(true);
      expect(name in KNOWN_OPEN, `${name} is guarded and must not be listed open`).toBe(false);
    }
    // The behavioural half of the boundary: a guard that is present in the source
    // but placed after a branch that writes is not a guard. Every one of these has
    // a signed/unsigned pair above.
    expect(GUARD_CASES.map((c) => c.action).sort()).toEqual(
      guardedByPredicate.filter((n) => !["setField", "mergeField", "removeObservation", "applyMergedResult"].includes(n)).sort(),
    );
  });

  it("no exempt, open or legacy entry has gone stale", () => {
    const names = new Set(clinicalWriters().map((w) => w.name));
    for (const n of [...Object.keys(EXEMPT), ...Object.keys(KNOWN_OPEN), ...Object.keys(LEGACY_IF_GUARD)]) {
      expect(names.has(n), `${n} no longer writes clinical state — remove it from the list`).toBe(true);
    }
    // A legacy entry that adopts the shared predicate must leave the allowlist, or
    // the allowlist becomes a place to hide a new one-off check.
    for (const n of Object.keys(LEGACY_IF_GUARD)) {
      const w = clinicalWriters().find((x) => x.name === n)!;
      const body = lines.slice(w.start, w.end).join("\n");
      expect(
        body.includes("refuseSignedMutation("),
        `${n} now calls refuseSignedMutation — remove it from LEGACY_IF_GUARD`,
      ).toBe(false);
    }
  });

  it("an entry that gains the central guard leaves the open list", () => {
    const fixed = clinicalWriters().filter(
      (w) => w.name in KNOWN_OPEN
        && lines.slice(w.start, w.end).join("\n").includes("refuseSignedMutation("),
    );
    expect(fixed.map((w) => w.name), "now guarded by refuseSignedMutation — remove from KNOWN_OPEN").toEqual([]);
  });

  it("the open list stays empty", () => {
    // Ratchet: 12 entries were listed as open when this boundary was installed, and
    // the scan that produced that number was itself missing three writers. There is
    // nothing left to list, so the cap is zero and a new hole has to be added by
    // name, in a diff a reviewer will see.
    expect(Object.keys(KNOWN_OPEN)).toEqual([]);
  });

  it("refuseSignedMutation is the single decision point", () => {
    // One predicate, so the refusal wording and the study id it reports cannot
    // drift between mutators the way the guards already in the file had.
    const decls = src.match(/function refuseSignedMutation\(/g) ?? [];
    expect(decls).toHaveLength(1);
    const calls = src.match(/refuseSignedMutation\(get\(\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(18);
    // No mutator may re-introduce a one-off isFinalized check that skips the
    // shared warning.
    expect(src).not.toContain('if (get().isFinalized && source === "radiologist-voice") return;');
  });
});

/**
 * A refusal the radiologist can trigger with the keyboard has to say so. There is
 * no DOM harness in this package, so this is a source contract over the handler
 * rather than a render test — the same shape as the cross-study undo refusal in
 * `clinicalStateReset.hardening.test.ts`.
 */
describe("Ctrl+Shift+Z on a signed report says it was refused", () => {
  const handlerAt = commandsSrc.indexOf('e.ctrlKey && e.shiftKey && (e.key === "z"');
  // Comments stripped: the branch's own comment names the correction path it
  // deliberately does not offer, and these assertions are about the wording the
  // radiologist actually reads.
  const handler = commandsSrc
    .slice(handlerAt, handlerAt + 2600)
    .replace(/\/\/[^\n]*/g, "");
  const SIGNED = "!undone && topFrame && ws.isFinalized";
  const signedAt = handler.indexOf(SIGNED);
  const branch = handler.slice(signedAt, handler.indexOf("duration: 8000,", signedAt) + 20);

  it("has a signed-report branch, and it comes after the cross-study one", () => {
    const crossStudy = handler.indexOf("topFrame.activeStudyId !== ws.activeStudyId");
    expect(crossStudy, "the cross-study refusal must still be there").toBeGreaterThan(-1);
    expect(signedAt, "a signed report must get its own refusal, not silence").toBeGreaterThan(-1);
    // Cross-study is the more specific diagnosis and must win when both hold: a
    // frame from another patient on a signed study is a different sentence.
    expect(signedAt).toBeGreaterThan(crossStudy);
  });

  it("uses the toast channel, not pushNotification", () => {
    expect(branch).toMatch(/variant: "destructive"/);
    // pushNotification's only consumer renders kind === "interrupt" as a red card
    // headed "Critical finding detected", and "ledger" / "edge-glow" render nowhere.
    expect(handler).not.toMatch(/pushNotification/);
  });

  it("does not promise a correction path this workspace cannot reach", () => {
    const wording = branch.toLowerCase();
    expect(wording, "the branch must reach the radiologist").toMatch(/title:/);
    expect(wording, "the branch must carry the toast").toMatch(/description:/);
    for (const word of ["amend", "reopen", "unlock", "withdraw"]) {
      // PR-9 has to land a reachable correction path before any of these can be
      // offered; until then the message must not imply one already exists.
      expect(wording, `the refusal must not offer a ${word} path`).not.toContain(word);
    }
  });
});
