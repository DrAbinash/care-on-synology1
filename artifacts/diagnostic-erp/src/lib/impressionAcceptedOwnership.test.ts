/**
 * Red-first reproduction of the two Impression defects measured on a REAL patient report in
 * production on 2026-11-04 (trial evidence: tmp/trial-2026-11-04/A-ai-rag-on.md, D-A1 and D-A2).
 *
 * D-A2: the radiologist accepted a 149-character AI Conclusion, Applied it, saved and reopened.
 * The stored draft came back at 504 characters — the two accepted lines PLUS the two dictated
 * Findings sentences appended underneath. Measured `updatedAt` was after the reload, so the open
 * itself wrote it.
 *
 * D-A1: clearing the Conclusion refilled it to the first 347 characters of Findings within
 * ~500 ms, with "Instant report" switched OFF.
 *
 * Both travel the same production path, which is what these cases drive: a state change arms the
 * Findings→Impression dependency, and `useWorkspaceClinicalUi.tsx`'s derived-Impression effect
 * answers an armed dependency by running `refreshImpressionFromLedger({ automatic: true })`. No
 * press is involved, and the Instant-report switch is not in the chain at all — which is why
 * turning it off did not stop the refill.
 *
 * The claim under test is narrow and clinical: text the radiologist adopted (Accepted from AI) or
 * deliberately emptied is theirs, and a pass nobody pressed may not write it. A press still may —
 * case 4 pins that, so the fix cannot be "never regenerate".
 *
 * Beyond the two reproductions this file carries the rest of the provable-at-the-store-boundary
 * set: a hand-typed Conclusion surviving the pass; the ownership flag stopping the pass with no
 * manual provenance to read (`[flag-only]`); the amber needs-refresh banner surviving the refusal;
 * `seedSystemNormalImpression` not refilling an emptied Conclusion, with the same-state positive
 * control that proves the refusal does work; a study switch dropping the previous study's
 * ownership; MODE A's own study-open NOT claiming the field (the fix is not blanket ownership);
 * and the save → reopen leg in memory — `serializeObservationLedger()` emitting
 * `impressionOwner: "radiologist"`, `hydrateObservationLedger` restoring it, and the reopened draft
 * still refusing the automatic pass. The real route and the real column are proved separately in
 * `artifacts/api-server/src/routes/reportComposer.impressionOwner.request.test.ts`.
 *
 * "Deliberately emptied" always means emptying a FILLED field: `setField` returns before the
 * ownership line when the write changes nothing, and that is correct — an already-empty Conclusion
 * is not a wording the radiologist rejected.
 *
 * Environment honesty: store boundary only (no browser in this container), the same controlled
 * synthetic harness as `impressionNormalInvention.test.ts`. No patient data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import { impressionProvenanceIsRadiologistManual } from "./impressionProvenance";
import { SYSTEM_NORMAL_IMPRESSION_TEXT } from "./conceptCanon/normalImpression";
import { extractImpressionOwner } from "./observationLedger";

const STUDY = "syn-impression-ownership-1";
/** A second worklist row so the study-switch case switches to a real one. */
const STUDY_B = "syn-impression-ownership-2";
const S = () => useWorkspace.getState();

/** The four controlled observations from the 2026-11-04 trial, verbatim. */
const FINDINGS = [
  "Generalized cerebral volume loss with prominence of cortical sulci, ventricular system and basal cisterns, consistent with age-related cerebral atrophy.",
  "Multiple patchy and early confluent T2/FLAIR hyperintensities in bilateral periventricular and deep cerebral white matter, suggestive of chronic small-vessel ischemic changes - Fazekas grade II.",
  "No diffusion restriction on DWI/ADC to suggest acute infarction.",
  "No intracranial hemorrhage, mass effect or midline shift.",
].join("\n");

/** The Conclusion the model produced for those findings in job 13 (2 lines, 149 chars). */
const ACCEPTED_IMPRESSION = [
  "Generalized cerebral atrophy.",
  "Chronic small vessel ischemic white matter changes - Fazekas grade II.",
].join("\n");

function openBrainStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
    }),
    studies: [
      { id: STUDY, patient: { name: "SYNTHETIC PATIENT ONE", sex: "M" }, modality: "MR" },
      { id: STUDY_B, patient: { name: "SYNTHETIC PATIENT TWO", sex: "F" }, modality: "MR" },
    ],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
}

/**
 * The Conclusion textarea's write, reproduced at the store boundary. The claim is taken only
 * from that component (`findings-editor.tsx`), because every other writer arrives at the same
 * unsourced `setField("impression", …)`: a deselected Quick Select box stripping its own
 * sentence, the phrase toolbar, the voice undo stack. Taking ownership on those is what CI
 * caught — the approved normal that deselecting the last box is supposed to bring back stops
 * coming back, because the seed reads a claim that was never about wording.
 */
const RADIOLOGIST_EDIT = { radiologistEdit: true } as const;

/** Type the findings the way the editor does: no source, which `setField` treats as manual. */
function typeFindings(text: string) {
  S().setField("findings", text);
}

/**
 * Select-all + Delete on the Conclusion, the way the editor actually performs it: the
 * field holds something first. Writing "" over an already-empty field is a genuine no-op
 * and `setField` returns before it reaches the ownership line — which is right, there is
 * no wording being rejected there — so every "deliberately emptied" case below has to go
 * through a non-empty field to be the real thing.
 */
function clearTheConclusion() {
  S().setField("impression", ACCEPTED_IMPRESSION, RADIOLOGIST_EDIT);
  S().setField("impression", "", RADIOLOGIST_EDIT);
}

/**
 * Exactly what the workspace's derived-Impression effect runs when the dependency is armed —
 * including its own early return, so a case that would not reach the pass in production does not
 * reach it here either.
 */
function runAutomaticPassAsTheWorkspaceDoes() {
  const state = S();
  if (!state.impressionNeedsRefresh) return "not-armed";
  if (impressionProvenanceIsRadiologistManual(state.fieldProvenance.impression)) return "held-manual";
  return state.refreshImpressionFromLedger({ automatic: true }) ?? "wrote";
}

beforeEach(() => openBrainStudy());

describe("P0-1 — an Accepted AI Conclusion belongs to the radiologist", () => {
  it("reproduction: the automatic pass appends dictated Findings sentences to the accepted Conclusion", () => {
    typeFindings(FINDINGS);
    const outcome = S().applyAiComposerAccepted({
      findings: FINDINGS, impression: ACCEPTED_IMPRESSION, recommendation: "",
    });
    expect(outcome).toBe("applied");
    expect(S().impressionText).toBe(ACCEPTED_IMPRESSION);

    const armed = S().impressionNeedsRefresh;
    const pass = runAutomaticPassAsTheWorkspaceDoes();
    const after = S().impressionText;

    console.info(
      `[P0-1] needsRefresh=${armed} pass=${pass} accepted=${ACCEPTED_IMPRESSION.length}`
      + ` after=${after.length}\n[P0-1] after verbatim:\n${after}`,
    );

    // The accepted wording must survive untouched. It grew by the dictated findings sentences.
    expect(after).toBe(ACCEPTED_IMPRESSION);
  });

  it("reproduction: the accepted Conclusion is still intact after a second armed pass (reopen does two renders)", () => {
    typeFindings(FINDINGS);
    S().applyAiComposerAccepted({
      findings: FINDINGS, impression: ACCEPTED_IMPRESSION, recommendation: "",
    });
    runAutomaticPassAsTheWorkspaceDoes();
    const first = S().impressionText;
    runAutomaticPassAsTheWorkspaceDoes();
    const second = S().impressionText;
    console.info(`[P0-1b] first=${first.length} second=${second.length}`);
    // No cumulative drift: whatever the first pass did, the second must not add to it.
    expect(second).toBe(first);
  });
});

describe("P1-3 — clearing the Conclusion is a deliberate edit", () => {
  it("reproduction: clearing Impression leaves it empty across the automatic pass", () => {
    typeFindings(FINDINGS);
    S().setField("impression", ACCEPTED_IMPRESSION, RADIOLOGIST_EDIT);
    expect(S().impressionText).toBe(ACCEPTED_IMPRESSION);

    // Select-all + Delete in the editor: the same setField, with an empty value.
    S().setField("impression", "", RADIOLOGIST_EDIT);
    expect(S().impressionText).toBe("");

    const armed = S().impressionNeedsRefresh;
    const pass = runAutomaticPassAsTheWorkspaceDoes();
    const after = S().impressionText;
    console.info(
      `[P1-3] needsRefresh=${armed} pass=${pass} after_length=${after.length}`
      + `\n[P1-3] refilled verbatim:\n${after}`,
    );

    expect(after).toBe("");
  });
});

describe("control — an explicit press must still regenerate (the fix is not 'never write')", () => {
  it("a pressed refresh rebuilds the Conclusion from the ledger", () => {
    typeFindings(FINDINGS);
    S().setField("impression", "", RADIOLOGIST_EDIT);
    const before = S().impressionText;
    S().refreshImpressionFromLedger();
    const after = S().impressionText;
    console.info(`[control] pressed refresh before=${before.length} after=${after.length}`);
    // Pressing Generate/Refresh answers "what is the impression?" — it may not stay empty.
    expect(after.length).toBeGreaterThan(0);
  });

  it("a pressed refresh rebuilds and hands the field back to the machine", () => {
    typeFindings(FINDINGS);
    clearTheConclusion();
    expect(S().impressionOwnedByRadiologist).toBe(true);
    S().refreshImpressionFromLedger();
    const ownedAfterPress = S().impressionOwnedByRadiologist;
    // And from then on the silent pass is allowed again — otherwise a single press would
    // permanently silence the derived Impression for the rest of the session. Re-arm it by
    // hand so this checks the permission, not whether the press happened to leave it armed.
    useWorkspace.setState({ impressionNeedsRefresh: true });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    console.info(`[control-press] ownedAfterPress=${ownedAfterPress} pass=${pass ?? "wrote"} len=${S().impressionText.length}`);
    expect(ownedAfterPress).toBe(false);
    expect(pass).not.toBe("held-adopted");
  });

  it("a draft nobody claimed keeps regenerating after a reopen (the flag is not blanket ownership)", () => {
    typeFindings(FINDINGS);
    const env = S().serializeObservationLedger() as Record<string, unknown>;
    openBrainStudy();
    S().setField("findings", FINDINGS, "quick-findings");
    const hydr = S().hydrateObservationLedger(env);
    const restored = S().impressionOwnedByRadiologist;
    useWorkspace.setState({ impressionNeedsRefresh: true });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    console.info(
      `[control-unowned] envHasOwner=${env.impressionOwner === "radiologist"} hydrate=${hydr.mode}`
      + ` restoredOwned=${restored} pass=${pass ?? "wrote"} len=${S().impressionText.length}`,
    );
    expect(env.impressionOwner).toBeUndefined();
    expect(restored).toBe(false);
    expect(pass).not.toBe("held-adopted");
    expect(S().impressionText.length).toBeGreaterThan(0);
  });
});

describe("manual edit — the provenance guard and the ownership flag agree", () => {
  it("a hand-typed Conclusion is left exactly as the radiologist wrote it", () => {
    typeFindings(FINDINGS);
    const HAND_WRITTEN = "Age-related atrophy with chronic small-vessel change. No acute infarction.";
    S().setField("impression", HAND_WRITTEN, RADIOLOGIST_EDIT);
    expect(S().impressionOwnedByRadiologist).toBe(true);
    const pass = runAutomaticPassAsTheWorkspaceDoes();
    const after = S().impressionText;
    console.info(`[manual] pass=${pass} owned=${S().impressionOwnedByRadiologist} after=${after.length}`);
    expect(after).toBe(HAND_WRITTEN);
    expect(pass).not.toBe("wrote");
  });

  it("the ownership flag alone stops the pass, with no manual provenance to read", () => {
    // The store-level guard must not depend on the caller's provenance pre-check or on a
    // tag existing: an adopted or emptied Conclusion carries no `manual` tag at all, and
    // a caller that reaches the action directly must be refused too. Provenance is
    // deliberately blanked here to isolate the flag.
    typeFindings(FINDINGS);
    S().applyAiComposerAccepted({
      findings: FINDINGS, impression: ACCEPTED_IMPRESSION, recommendation: "",
    });
    expect(impressionProvenanceIsRadiologistManual(S().fieldProvenance.impression)).toBe(false);
    useWorkspace.setState({ fieldProvenance: { ...S().fieldProvenance, impression: {} } });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    console.info(`[flag-only] pass=${pass} len=${S().impressionText.length}`);
    expect(pass).toBe("held-adopted");
    expect(S().impressionText).toBe(ACCEPTED_IMPRESSION);
  });

  it("the refusal keeps the amber needs-refresh banner armed (the press stays reachable)", () => {
    typeFindings(FINDINGS);
    clearTheConclusion();
    useWorkspace.setState({ impressionNeedsRefresh: true, impressionDependencyReasons: ["findings-changed"] });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    const armed = S().impressionNeedsRefresh;
    console.info(`[banner] pass=${pass} stillArmed=${armed}`);
    expect(pass).toBe("held-adopted");
    expect(armed).toBe(true);
  });
});

describe("P1-3 support — the system normal cannot refill an emptied Conclusion", () => {
  it("seedSystemNormalImpression refuses an owned field, and writes the moment it is not owned", () => {
    typeFindings(FINDINGS);
    clearTheConclusion();
    expect(S().impressionOwnedByRadiologist).toBe(true);

    S().seedSystemNormalImpression();
    const withOwnership = S().impressionText;

    // Positive control in the same state: the ONLY difference is the flag, which proves
    // the refusal is the guard doing work rather than the seed having nothing to do.
    useWorkspace.setState({ impressionOwnedByRadiologist: false });
    S().seedSystemNormalImpression();
    const withoutOwnership = S().impressionText;

    console.info(
      `[seed] withOwnership=${withOwnership.length} withoutOwnership=${withoutOwnership.length}`
      + ` seeded=${withoutOwnership.includes(SYSTEM_NORMAL_IMPRESSION_TEXT)}`,
    );
    expect(withOwnership).toBe("");
    expect(withoutOwnership).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });
});

describe("study switch — ownership is per examination, not per session", () => {
  it("selectStudy clears the previous study's ownership", () => {
    // selectStudy defers recomputeCopilot()/seedSystemNormalImpression() on a timer; the
    // fake clock keeps that deferred write out of the assertion below and out of later cases.
    vi.useFakeTimers();
    try {
      typeFindings(FINDINGS);
      clearTheConclusion();
      expect(S().impressionOwnedByRadiologist).toBe(true);
      S().selectStudy(STUDY_B);
      const owned = S().impressionOwnedByRadiologist;
      const active = S().activeStudyId;
      console.info(`[switch] active=${active} ownedAfterSwitch=${owned}`);
      expect(active).toBe(STUDY_B);
      // Carrying it over would let patient one's "leave this alone" silence the derived
      // Impression on patient two's report.
      expect(owned).toBe(false);
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("machine writers must not claim the field — ownership follows authorship, not the setter", () => {
  it("MODE A's own study-open report does not hand the Conclusion to the radiologist", () => {
    // `generateProfessionalReport(..., { automatic: true })` is the pass that builds the
    // approved normal when a study opens, and internally it re-writes the Conclusion
    // through `setField("impression", …)` with no source — deliberately, because it is a
    // scaffold RETIREMENT and the surviving lines' provenance has to survive with it
    // (store.ts, `retire()`). If that write claimed the field, every MODE A study open
    // would freeze its own derived Conclusion and silence the pass for the rest of the
    // session — a worse version of the defect, and one the owner's P0-1 fix would cause.
    const outcome = S().generateProfessionalReport(S().reportingContext!, {
      automatic: true, requireOwnedApprovedNormal: true,
    });
    const owned = S().impressionOwnedByRadiologist;
    console.info(
      `[machine-open] status=${outcome.status} impressionLen=${S().impressionText.length}`
      + ` ownedAfterMachineOpen=${owned}`,
    );
    expect(owned).toBe(false);
  });
});

describe("persistence — the save → reopen leg, in memory (production measured 149 → 504 and 0 → 347 here)", () => {
  /** The order the draft-persistence hook performs it: fresh store, stored text, stored envelope. */
  function reopen(env: unknown, findings: string, impression: string) {
    openBrainStudy();
    S().setEditorContent({ findings, impression, recommendation: "", technique: "", clinicalHistory: "" });
    return S().hydrateObservationLedger(env);
  }

  it("serialize emits impressionOwner after an accept, and the reopened draft is still protected", () => {
    typeFindings(FINDINGS);
    S().applyAiComposerAccepted({
      findings: FINDINGS, impression: ACCEPTED_IMPRESSION, recommendation: "",
    });
    const env = S().serializeObservationLedger() as Record<string, unknown>;
    expect(env.impressionOwner).toBe("radiologist");
    expect(extractImpressionOwner(env)).toBe(true);

    const hydr = reopen(env, FINDINGS, ACCEPTED_IMPRESSION);
    const owned = S().impressionOwnedByRadiologist;
    // The reopen is the whole defect: it must be refused by the FLAG, not because the
    // restored provenance happens to read as manual.
    const manualProv = impressionProvenanceIsRadiologistManual(S().fieldProvenance.impression);
    useWorkspace.setState({ impressionNeedsRefresh: true });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    const after = S().impressionText;
    console.info(
      `[P0-1 persist] hydrate=${hydr.mode} ownedRestored=${owned} manualProv=${manualProv}`
      + ` pass=${pass ?? "wrote"} accepted=${ACCEPTED_IMPRESSION.length} after=${after.length}`
      + `\n[P0-1 persist] after verbatim:\n${after}`,
    );
    expect(hydr.ok).toBe(true);
    expect(owned).toBe(true);
    expect(manualProv).toBe(false);
    expect(pass).toBe("held-adopted");
    expect(after).toBe(ACCEPTED_IMPRESSION);
  });

  it("serialize emits impressionOwner after a clear, and the reopened draft stays empty", () => {
    typeFindings(FINDINGS);
    clearTheConclusion();
    const env = S().serializeObservationLedger() as Record<string, unknown>;
    expect(env.impressionOwner).toBe("radiologist");
    expect(extractImpressionOwner({ careObservationLedger: env })).toBe(true);

    const hydr = reopen(env, FINDINGS, "");
    const owned = S().impressionOwnedByRadiologist;
    const manualProv = impressionProvenanceIsRadiologistManual(S().fieldProvenance.impression);
    useWorkspace.setState({ impressionNeedsRefresh: true });
    const pass = S().refreshImpressionFromLedger({ automatic: true });
    const after = S().impressionText;
    console.info(
      `[P1-3 persist] hydrate=${hydr.mode} ownedRestored=${owned} manualProv=${manualProv}`
      + ` pass=${pass ?? "wrote"} after_length=${after.length}\n[P1-3 persist] after verbatim:[${after}]`,
    );
    expect(hydr.ok).toBe(true);
    expect(owned).toBe(true);
    // Zero sentences is zero tags — this is precisely what provenance cannot express.
    expect(manualProv).toBe(false);
    expect(pass).toBe("held-adopted");
    expect(after).toBe("");
  });

  it("a pre-existing draft with no impressionOwner hydrates as unowned (no new refusal invented for old reports)", () => {
    typeFindings(FINDINGS);
    const env = S().serializeObservationLedger() as Record<string, unknown>;
    const legacy = { ...env };
    delete legacy.impressionOwner;
    const hydr = reopen(legacy, FINDINGS, ACCEPTED_IMPRESSION);
    console.info(`[legacy] hydrate=${hydr.mode} owned=${S().impressionOwnedByRadiologist}`);
    expect(hydr.ok).toBe(true);
    expect(S().impressionOwnedByRadiologist).toBe(false);
    expect(extractImpressionOwner(undefined)).toBe(false);
    expect(extractImpressionOwner({ impressionOwner: "somebody-else" })).toBe(false);
  });
});
