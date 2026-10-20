/**
 * PR-A — the local unsaved-draft Restore must not relabel AI-authored text.
 *
 * The server round trip is sound: `serializeObservationLedger` carries
 * `fieldProvenance`, `parseObservationLedger` reads it back, and
 * `radiologyWorkspaceDraftRoundTrip.request.test.ts` (R2) proves a saved draft
 * reopens with its attribution. The one path that destroys it is the amber
 * "Unsaved draft found" banner (`WorkspaceOverlays.tsx`), whose Restore writes
 * through `setEditorContent`, which stamps every sentence in the report
 * `manual` — CARE's label for "a radiologist typed this".
 *
 * This file is the behavioural half: it drives the real store, so on main the
 * fix cases fail as behaviour (`manual` where `ai-draft` belongs) rather than as
 * a missing import. `aiAttributionRestore.test.ts` covers the pure rules.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "./reportingStudyContext";
import type { CopilotItem } from "./zai-workspace/types";
import { normalizeForDedupe, provenanceMapToSegments } from "./reportFieldMerge";
import {
  contributionProtected,
  extractCareObservationLedger,
  stripContribution,
} from "./observationLedger";
import { impressionHasManualContribution } from "./conceptCanon/normalImpression";
import { impressionProvenanceIsRadiologistManual } from "./impressionProvenance";
import { decideInstantReport } from "./zai-workspace/instantReport";
import type { PreservedRestoreProvenance } from "./aiAttributionRestore";

const STUDY = "st-1";
const PATIENT = "p-1";
const DRAFT = "401";

const AI_FINDING = "Acute infarct extends into the insular cortex.";
const AI_IMPRESSION = "Acute infarct with surrounding oedema.";
const MANUAL_LINE = "The radiologist wrote this line herself.";
const CLINICIAN_ADDED = "Comparison made with prior study dated 12/03.";

function openStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
    }),
    studies: [{ id: STUDY, patient: { name: "Priya Sharma", sex: "F" }, modality: "MR" }],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
  } as never);
}

/** The AI door the store actually has: accepting a copilot suggestion. */
function acceptAi(field: "findings" | "impression", text: string, id: string) {
  useWorkspace.getState().insertCopilotText({
    id,
    kind: "ai-draft",
    title: "AI suggestion",
    detail: "from the reasoner",
    confidence: "medium",
    source: "AI reasoner",
    insertText: text,
    insertTarget: field,
    studyId: STUDY,
  } as CopilotItem);
}

function preserved(over: Partial<PreservedRestoreProvenance["context"]> = {}): PreservedRestoreProvenance {
  const s = useWorkspace.getState();
  return {
    context: {
      studyId: STUDY,
      hydratedStudyId: STUDY,
      patientId: PATIENT,
      draftId: DRAFT,
      ...over,
    },
    // Captured BEFORE the restore, exactly as the banner's click handler does.
    provenance: JSON.parse(JSON.stringify(s.fieldProvenance)),
  } as PreservedRestoreProvenance;
}

/** The five texts the banner hands back for the report described above. */
function backupTexts() {
  const s = useWorkspace.getState();
  return {
    findings: [s.findingsText, CLINICIAN_ADDED].filter(Boolean).join(" "),
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    clinicalHistory: s.clinicalHistoryText,
  };
}

function buildReport() {
  openStudy();
  acceptAi("findings", AI_FINDING, "ai-1");
  acceptAi("impression", AI_IMPRESSION, "ai-2");
  // mergeField, not setField: the hand-written line joins the Findings the AI
  // sentence is already in, and a report holds both.
  useWorkspace.getState().mergeField("findings", MANUAL_LINE, "manual");
}

describe("the defect as it stands on main — a bare Restore claims human authorship", () => {
  beforeEach(() => buildReport());

  it("stamps an accepted AI sentence manual, and that stamp is load-bearing", () => {
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["ai-draft"]);

    useWorkspace.getState().setEditorContent(backupTexts());

    const s = useWorkspace.getState();
    const key = normalizeForDedupe(AI_FINDING);
    // The false claim itself.
    expect(s.fieldProvenance.findings?.[key]).toEqual(["manual"]);
    // And the four things that follow from it, each of which is a safety
    // mechanism being told the wrong thing.
    expect(contributionProtected(AI_FINDING, s.fieldProvenance.findings)).toBe(true);
    expect(stripContribution(s.findingsText, AI_FINDING, s.fieldProvenance.findings).outcome)
      .toBe("preserved-manual");
    expect(impressionProvenanceIsRadiologistManual(s.fieldProvenance.impression)).toBe(true);
    expect(impressionHasManualContribution(s.fieldProvenance.impression)).toBe(true);
    expect(s.impressionText).toContain(AI_IMPRESSION);
    // The on-screen provenance says a person wrote it.
    expect(provenanceMapToSegments(s.findingsText, s.fieldProvenance.findings ?? {})
      .find((seg) => normalizeForDedupe(seg.text) === key)?.sources).toEqual(["manual"]);
  });

  it("holds Mode A off, because a false manual Impression is a protected one", () => {
    useWorkspace.getState().setEditorContent(backupTexts());
    const s = useWorkspace.getState();
    expect(decideInstantReport({
      enabled: true,
      contentLocked: false,
      confirmationOpen: false,
      manualImpression: impressionProvenanceIsRadiologistManual(s.fieldProvenance.impression),
      foreignFindingsLines: 0,
      engineOwnsCanvas: true,
    })).toMatchObject({ action: "hold", code: "manual-impression" });
  });
});

describe("Restore inside one verified report context — attribution survives", () => {
  beforeEach(() => buildReport());

  it("keeps the AI sentences ai-draft and the hand-written line manual", () => {
    useWorkspace.getState().setEditorContent(backupTexts(), preserved());

    const s = useWorkspace.getState();
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)]).toEqual(["ai-draft"]);
    expect(s.fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)]).toEqual(["ai-draft"]);
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(MANUAL_LINE)]).toEqual(["manual"]);
    // The text is the backup's text, in full — nothing was dropped or reordered.
    expect(s.findingsText).toContain(CLINICIAN_ADDED);
    expect(s.isDirty).toBe(true);
  });

  it("leaves the AI sentence retirable, keeps the Impression rebuildable, and still shows AI", () => {
    useWorkspace.getState().setEditorContent(backupTexts(), preserved());

    const s = useWorkspace.getState();
    expect(contributionProtected(AI_FINDING, s.fieldProvenance.findings)).toBe(false);
    expect(stripContribution(s.findingsText, AI_FINDING, s.fieldProvenance.findings).outcome)
      .not.toBe("preserved-manual");
    expect(impressionProvenanceIsRadiologistManual(s.fieldProvenance.impression)).toBe(false);
    expect(impressionHasManualContribution(s.fieldProvenance.impression)).toBe(false);
    expect(decideInstantReport({
      enabled: true,
      contentLocked: false,
      confirmationOpen: false,
      manualImpression: impressionProvenanceIsRadiologistManual(s.fieldProvenance.impression),
      foreignFindingsLines: 0,
      engineOwnsCanvas: true,
    })).toEqual({ action: "compose" });
    expect(provenanceMapToSegments(s.findingsText, s.fieldProvenance.findings ?? {})
      .find((seg) => normalizeForDedupe(seg.text) === normalizeForDedupe(AI_FINDING))?.sources)
      .toEqual(["ai-draft"]);
  });

  it("agrees with what a save → close → reopen would have produced", () => {
    // The intent of the whole change in one assertion: the local Restore and the
    // server round trip are the same event to the radiologist, so they cannot be
    // allowed to disagree about who wrote a sentence.
    const envelope = useWorkspace.getState().serializeObservationLedger();
    const texts = backupTexts();
    useWorkspace.getState().setEditorContent(texts, preserved());
    const afterRestore = {
      findings: useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)],
      impression: useWorkspace.getState().fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)],
    };

    // The order `useDraftPersistence` uses on a real reopen: the texts land
    // first, then the ledger hydrates and re-establishes authorship over them.
    openStudy();
    useWorkspace.getState().setEditorContent(texts);
    useWorkspace.getState().hydrateObservationLedger(extractCareObservationLedger({ careObservationLedger: envelope }));
    const reopened = {
      findings: useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)],
      impression: useWorkspace.getState().fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)],
    };
    expect(afterRestore).toEqual({ findings: ["ai-draft"], impression: ["ai-draft"] });
    expect(reopened).toEqual(afterRestore);
  });

  it("is unknowable, not human, for a sentence only the backup ever held", () => {
    // The local backup carries text the server never received and therefore no
    // recorded authorship. It keeps today's conservative `manual` default — this
    // case pins that we did not invent `ai-draft` for it either.
    useWorkspace.getState().setEditorContent(backupTexts(), preserved());
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(CLINICIAN_ADDED)])
      .toEqual(["manual"]);
  });
});

describe("identity — preserved attribution travels with one patient, study and draft", () => {
  beforeEach(() => buildReport());

  it("refuses a preserved map whose context is a different study", () => {
    useWorkspace.getState().setEditorContent(backupTexts(), preserved({ studyId: "st-OTHER" }));
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
  });

  it("refuses before the server draft has finished hydrating for THIS study", () => {
    useWorkspace.getState().setEditorContent(backupTexts(), preserved({ hydratedStudyId: "st-OTHER" }));
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
  });

  it("refuses when the patient or the saved draft row is not known", () => {
    useWorkspace.getState().setEditorContent(backupTexts(), preserved({ patientId: null }));
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
    buildReport();
    useWorkspace.getState().setEditorContent(backupTexts(), preserved({ draftId: null }));
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
  });

  it("refuses when the caller supplies no context at all", () => {
    const s = useWorkspace.getState();
    const texts = backupTexts();
    // A hand-built preserved value with an empty context is the shape a future
    // caller could arrive at by accident; the write boundary must not accept it.
    s.setEditorContent(texts, { context: {}, provenance: s.fieldProvenance } as never);
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
  });
});

describe("matching is exact — duplicates and edits are not guessed at", () => {
  beforeEach(() => buildReport());

  it("leaves a duplicated AI sentence unattributed rather than guessing which copy it came from", () => {
    const doubled = { ...backupTexts(), findings: `${AI_FINDING} ${AI_FINDING} ${MANUAL_LINE}` };
    useWorkspace.getState().setEditorContent(doubled, preserved());
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual"]);
  });

  it("does not carry the AI mark onto an edited sentence", () => {
    const edited = AI_FINDING.replace("insular cortex", "insular cortex and temporal lobe");
    useWorkspace.getState().setEditorContent(
      { ...backupTexts(), findings: `${edited} ${MANUAL_LINE}` },
      preserved(),
    );
    const s = useWorkspace.getState();
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(edited)]).toEqual(["manual"]);
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)]).toBeUndefined();
  });

  it("keeps every source a sentence already had, including manual", () => {
    // Manual first, then the same sentence accepted from the AI door: the order
    // that yields both labels is pinned by `aiAcceptanceBoundary.hardening.test.ts`.
    openStudy();
    useWorkspace.getState().mergeField("findings", AI_FINDING, "manual");
    acceptAi("findings", AI_FINDING, "ai-both");
    const before = useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)];
    expect(before).toEqual(["manual", "ai-draft"]);
    useWorkspace.getState().setEditorContent(backupTexts(), preserved());
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(AI_FINDING)])
      .toEqual(["manual", "ai-draft"]);
  });
});

describe("an empty stored provenance field falls back to the ledger", () => {
  it("reconstructs a field the envelope saved as empty instead of trusting it", () => {
    openStudy();
    // A ledger row that states the sentence and is recorded as model-authored.
    // Its authorship lives in TWO places: the row's own `source`, and the
    // per-sentence map. Saving the map as empty must not discard the row's answer.
    expect(useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "", impression: AI_IMPRESSION },
      templates: { findings: "", impression: AI_IMPRESSION },
      ownership: { conflictGroup: "ai-probe", anatomicalSection: "Brain" },
      source: "ai-draft",
      id: "ai-row-1",
      region: "Brain",
      label: "AI probe",
      findingsText: "",
    })).toBe("applied");
    expect(useWorkspace.getState().fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)])
      .toEqual(["ai-draft"]);

    const envelope = useWorkspace.getState().serializeObservationLedger();
    // A draft whose sections were cleared serializes `{}` per field. The root is
    // non-empty, so it is written, and `parseObservationLedger` accepts any object
    // — `?? reconstruct` then never runs, and every sentence loses its owner.
    const blanked = {
      ...envelope,
      fieldProvenance: { impression: {}, findings: {}, technique: {}, recommendation: {}, clinicalHistory: {} },
    };

    openStudy();
    useWorkspace.getState().setEditorContent({
      findings: "", impression: AI_IMPRESSION, recommendation: "", technique: "", clinicalHistory: "",
    });
    useWorkspace.getState().hydrateObservationLedger(extractCareObservationLedger({ careObservationLedger: blanked }));

    expect(useWorkspace.getState().fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)])
      .toEqual(["ai-draft"]);
  });

  it("fills one empty field from the ledger while respecting another that has content", () => {
    // The realistic shape, and the one a whole-object check would miss: a draft
    // whose Findings were cleared but whose Impression still carries marks. The
    // root is non-empty either way, so the decision has to be made per field.
    const FINDINGS_ROW = "Disc herniation compresses the left L5 nerve root.";
    openStudy();
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: FINDINGS_ROW, impression: "" },
      templates: { findings: FINDINGS_ROW, impression: "" },
      ownership: { conflictGroup: "ai-probe-f", anatomicalSection: "Lumbar spine" },
      source: "ai-draft",
      id: "ai-row-f",
      region: "Lumbar spine",
      label: "AI probe findings",
      findingsText: FINDINGS_ROW,
    });
    useWorkspace.getState().applyPathologyOverlay({
      incoming: { findings: "", impression: AI_IMPRESSION },
      templates: { findings: "", impression: AI_IMPRESSION },
      ownership: { conflictGroup: "ai-probe-i", anatomicalSection: "Lumbar spine" },
      source: "ai-draft",
      id: "ai-row-i",
      region: "Lumbar spine",
      label: "AI probe impression",
      findingsText: FINDINGS_ROW,
    });
    const envelope = useWorkspace.getState().serializeObservationLedger();
    const stored = envelope.fieldProvenance ?? {};
    expect(stored.impression?.[normalizeForDedupe(AI_IMPRESSION)]).toEqual(["ai-draft"]);
    const halfBlank = { ...envelope, fieldProvenance: { ...stored, findings: {} } };

    openStudy();
    useWorkspace.getState().setEditorContent({
      findings: FINDINGS_ROW, impression: AI_IMPRESSION, recommendation: "", technique: "", clinicalHistory: "",
    });
    useWorkspace.getState().hydrateObservationLedger(extractCareObservationLedger({ careObservationLedger: halfBlank }));

    const s = useWorkspace.getState();
    // Findings: the row says who wrote it, because the saved map said nothing.
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(FINDINGS_ROW)]).toEqual(["ai-draft"]);
    // Impression: the saved mark is the workspace's own record, and outranks an
    // inference from the row's last render.
    expect(s.fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)]).toEqual(["ai-draft"]);
  });

  it("still honours a stored field that has real content", () => {
    openStudy();
    acceptAi("impression", AI_IMPRESSION, "ai-imp");
    const envelope = useWorkspace.getState().serializeObservationLedger();
    openStudy();
    useWorkspace.getState().hydrateObservationLedger(extractCareObservationLedger({ careObservationLedger: envelope }));
    expect(useWorkspace.getState().fieldProvenance.impression?.[normalizeForDedupe(AI_IMPRESSION)])
      .toEqual(["ai-draft"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring. The rules above only help if the one control that restores a report
// hands them the context, and if the write boundary refuses a context it was
// given without checking. Both are checked here because neither is reachable
// from a component test — there is no DOM in this suite.
// ─────────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const overlaysSrc = lf(readFileSync(join(here, "../components/radiology/workspace/WorkspaceOverlays.tsx"), "utf8"));
const storeSrc = lf(readFileSync(join(here, "zai-workspace/store.ts"), "utf8"));

describe("the Restore button hands the write its report context", () => {
  function restoreButton(): string {
    const at = overlaysSrc.indexOf("{!contentLocked && (");
    expect(at, "the draft-restore banner must still gate Restore on the signed-report lock").toBeGreaterThan(-1);
    const end = overlaysSrc.indexOf(">Restore</Button>", at);
    expect(end, "the banner must still render a Restore button").toBeGreaterThan(at);
    return overlaysSrc.slice(at, end).replace(/\s+/g, " ");
  }

  it("passes the recorded provenance beside the texts, with all four identity fields", () => {
    const flat = restoreButton();
    // Positive control: the window has to be the real statement, or every
    // contains-check below could be satisfied by an empty slice.
    expect(flat).toContain("useWorkspace.getState().setEditorContent({");
    expect(flat).toContain("}, restoreProvenanceForContext({");
    expect(flat).toContain("hydratedStudyId: draftHydratedStudyId");
    expect(flat).toContain("patientId: workflow.currentRow?.patientId ?? null");
    expect(flat).toContain("draftId: draftId ?? null");
    expect(flat).toContain("studyId: studyId ?? null");
    // The map is read from the store as the click runs, before the write replaces it.
    expect(flat).toContain("}, useWorkspace.getState().fieldProvenance)");
  });
});

describe("the write boundary decides, not the caller", () => {
  it("refuses a preserved value whose context is not this study", () => {
    const at = storeSrc.indexOf("setEditorContent: (c, preserved) => {");
    expect(at, "setEditorContent must accept the preserved value").toBeGreaterThan(-1);
    const guardAt = storeSrc.indexOf("const carryAttribution = preserved != null", at);
    expect(guardAt, "the store must decide whether attribution may be carried").toBeGreaterThan(at);
    const body = storeSrc.slice(guardAt, storeSrc.indexOf("const nextProv = {", guardAt));
    expect(body).toContain("reportContextIsVerified(preserved.context)");
    expect(body).toContain("sameReportId(preserved.context.studyId, state.activeStudyId)");
    expect(body).toContain("carryAttribution,");
  });

  it("routes every restored field through the rule module", () => {
    const at = storeSrc.indexOf("const provFor = (f: EditorField, text: string)");
    expect(at).toBeGreaterThan(-1);
    const endAt = storeSrc.indexOf("state.findingsText === findings", at);
    expect(endAt, "the no-op guard must still follow the provenance decision").toBeGreaterThan(at);
    const body = storeSrc.slice(at, endAt);
    for (const f of ["findings", "impression", "recommendation", "technique", "clinicalHistory"]) {
      expect(body, `setEditorContent must decide ${f} through the restore rules`).toContain(`provFor("${f}",`);
    }
  });
});
