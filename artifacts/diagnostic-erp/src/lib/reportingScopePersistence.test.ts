/**
 * reportingScopePersistence.test.ts — OWNER DECISION 2026-11-01, task 3 of PR #1249:
 * "Remember the radiologist's confirmed reporting scope for the same study. On reopening the
 * study, restore the confirmed scope without asking again. Do not change the billed
 * procedure, patient identity, accession or worklist study ID."
 *
 * The defect this closes is a repetition: `MRI Brain` was billed and `MRI BRAIN + CX SCR`
 * was scanned, so the scope strip asked; he answered; the autosave wrote the answer; he
 * reopened the study ten minutes later and the strip asked the same question again, because
 * the answer lived only in session React state. Task 1 of this PR made the answer change
 * what the report says — an answer that has to be given twice is a report whose scope is
 * one careless re-open away from changing again.
 *
 * What the tests below pin, in order of what would hurt:
 *
 *  1. The record is the answer to ONE named disagreement (`proposalKey`). An old answer must
 *     not settle a new question, or a technologist adding a sequence would inherit whichever
 *     examination a previous visit happened to confirm.
 *  2. The save body's three states match the server's three states: `undefined` rewrites
 *     nothing, `null` is a clear he chose, a record writes. A study that was never asked
 *     gains no field on any save.
 *  3. Restoring is a read, not an edit: it must not mark the report dirty, and must not
 *     touch Findings, Impression or Technique.
 *  4. A hand decision on the Region control supersedes the memory. Left remembered, the
 *     stored combined scope would come back over a report he had narrowed by hand and widen
 *     the examination the page names after he narrowed it.
 *  5. The record carries no identity and no money — the billed procedure, the patient, the
 *     accession and the worklist row are not reachable from it, so the owner's last sentence
 *     is a structural fact rather than a promise.
 *
 * The hook wiring around these rules — that the strip is actually suppressed by the stored
 * answer — is pinned in `regionTransitionWiring.contract.test.ts`, and the browser run in
 * the PR body is what closes the gap between "the store holds it" and "the screen asks".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { CLINICAL_RESET_FIELDS, emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import {
  REPORTING_SCOPE_ENVELOPE_KEY,
  REPORTING_SCOPE_REQUEST_FIELD,
  extractCareReportingScope,
  reportingScopePayload,
  reportingScopeProposalKey,
  type ReportingScopeRecord,
} from "@/lib/regionTransition";

const ACTOR = "abinashsingh@gmail.com";
const NOW = "2026-11-01T06:30:00.000Z";
const COMBINED = ["MRI Brain", "Cervical Spine Screening"];

function answer(regions: readonly string[] = COMBINED): ReportingScopeRecord {
  return {
    kind: "care.reporting_scope.v1",
    regions: [...regions],
    proposalKey: reportingScopeProposalKey(regions),
    decidedBy: ACTOR,
    at: NOW,
  };
}

/** What the server's `composeStructuredJsonColumn` stores, and what the draft returns. */
function envelopeOf(record: ReportingScopeRecord | null | undefined) {
  const payload = reportingScopePayload(record);
  return payload ? { [REPORTING_SCOPE_ENVELOPE_KEY]: payload } : {};
}

/** The clinical surface the scope must never touch. */
function clinicalSnapshot() {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    technique: s.techniqueText,
    recommendation: s.recommendationText,
    ledger: s.appliedPathologyPatches.map((p) => p.id),
    undo: s.patchUndoStack.length,
    provenance: JSON.stringify(s.fieldProvenance),
    isDirty: s.isDirty,
  };
}

/** The save → close → reopen cycle, at the same two calls `useDraftPersistence` makes. */
function saveAndReopen() {
  const saved = envelopeOf(useWorkspace.getState().reportingScope);
  useWorkspace.setState({ ...emptyClinicalState() });
  useWorkspace.getState().hydrateReportingScope(extractCareReportingScope(saved));
  return saved;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({ reportingScope: undefined, isDirty: false });
});

describe("the record is the answer to one named disagreement", () => {
  it("names a proposal by the examinations it proposes, in the performed order", () => {
    expect(reportingScopeProposalKey(COMBINED)).toBe("MRI Brain+Cervical Spine Screening");
    // Order is not cosmetic: the primary region decides the report format, so a re-order is
    // a different examination and must not be answered by the previous one.
    expect(reportingScopeProposalKey(["Cervical Spine Screening", "MRI Brain"]))
      .not.toBe(reportingScopeProposalKey(COMBINED));
    expect(reportingScopeProposalKey(["MRI Brain"])).not.toBe(reportingScopeProposalKey(COMBINED));
  });

  it("an answer only matches the disagreement it was given for", () => {
    const record = answer();
    expect(record.proposalKey).toBe(reportingScopeProposalKey(COMBINED));
    expect(record.proposalKey).not.toBe(reportingScopeProposalKey(["MRI Brain", "MRI Dorsal Spine"]));
  });
});

describe("the save body carries three states, not two", () => {
  it("a study that was never asked sends no scope field at all", () => {
    expect(reportingScopePayload(undefined)).toBeUndefined();
    // Positive control for the next assertion: the same call with an answer is a field.
    expect(reportingScopePayload(answer())).toBeTruthy();
  });

  it("a hand decision sends the explicit clear that survives the reload", () => {
    expect(reportingScopePayload(null)).toBeNull();
  });

  it("an answer with no examinations is a clear, never an empty scope", () => {
    // A record that documents nothing must not be stored as a scope: the next reload would
    // find an answer, suppress the strip, and leave the report on whatever billing said.
    expect(reportingScopePayload({ ...answer([]), regions: [] })).toBeNull();
  });

  it("sends a copy, so a later region click cannot rewrite the body mid-flight", () => {
    const record = answer();
    const payload = reportingScopePayload(record)!;
    expect(payload).not.toBe(record);
    expect(payload.regions).not.toBe(record.regions);
    record.regions.push("MRI Dorsal Spine");
    expect(payload.regions).toEqual(COMBINED);
  });
});

describe("the envelope reads back structurally, never coerced", () => {
  it("reads the envelope key the server stores, and the request field it accepts", () => {
    const record = answer();
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: record })?.regions)
      .toEqual(COMBINED);
    expect(extractCareReportingScope({ [REPORTING_SCOPE_REQUEST_FIELD]: record })?.regions)
      .toEqual(COMBINED);
    // The client reads a stored column, so a BARE record is not its input: that shape
    // belongs to the request body, and `structuredJsonColumn.test.ts` pins the server's
    // reading of it. A client that accepted a bare record here would be a second, looser
    // parser than the one that decides what actually gets stored.
    expect(extractCareReportingScope(record)).toBeNull();
  });

  it("the request field and the envelope key are deliberately two different names", () => {
    // B-01's two-name rule: a client that reads only the field it wrote restores nothing,
    // because the server stores the envelope key. Pinning the pair is cheaper than finding
    // it again as a report that forgets its own examination.
    expect(REPORTING_SCOPE_REQUEST_FIELD).toBe("reportingScope");
    expect(REPORTING_SCOPE_ENVELOPE_KEY).toBe("careReportingScope");
    expect(REPORTING_SCOPE_ENVELOPE_KEY).not.toBe(REPORTING_SCOPE_REQUEST_FIELD);
  });

  it("drops a record that is not the contract's kind", () => {
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: { ...answer(), kind: "whatever" } }))
      .toBeNull();
  });

  it("drops regions that are not a list of names instead of inventing a scope", () => {
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: { ...answer(), regions: "MRI Brain" } }))
      .toBeNull();
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: { ...answer(), regions: [] } }))
      .toBeNull();
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: { ...answer(), regions: ["  ", ""] } }))
      .toBeNull();
  });

  it("drops an answer that cannot say which question it answered", () => {
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: { ...answer(), proposalKey: 42 } }))
      .toBeNull();
    const { proposalKey, ...headless } = answer();
    expect(proposalKey).toBeTruthy();
    expect(extractCareReportingScope({ [REPORTING_SCOPE_ENVELOPE_KEY]: headless })).toBeNull();
  });

  it("restores the clinical answer even when the audit fields are missing", () => {
    // Which examination the report documents is a clinical fact; who pressed the button is
    // metadata. Losing the first because the second was not written is the wrong trade.
    const stripped = extractCareReportingScope({
      [REPORTING_SCOPE_ENVELOPE_KEY]: { kind: "care.reporting_scope.v1", regions: COMBINED, proposalKey: "x" },
    });
    expect(stripped?.regions).toEqual(COMBINED);
    expect(stripped?.decidedBy).toBe("");
  });

  it("returns nothing for a column that is not an envelope", () => {
    for (const junk of [null, undefined, "reportingScope", 7, [], [{ regions: COMBINED }]]) {
      expect(extractCareReportingScope(junk)).toBeNull();
    }
  });
});

describe("save → close → reopen restores the confirmed scope", () => {
  beforeEach(() => {
    useWorkspace.getState().setReportingScope(answer());
  });

  it("the answer arms the autosave that is the only writer of it", () => {
    // Without `isDirty` the decision is on screen and nowhere else: the draft never learns,
    // so the next open asks again — the exact defect this task exists to close.
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("restoring does not mark the report edited", () => {
    useWorkspace.setState({ isDirty: false });
    useWorkspace.getState().hydrateReportingScope(extractCareReportingScope(envelopeOf(answer())));
    expect(useWorkspace.getState().isDirty).toBe(false);
  });

  it("comes back with the same examinations and the same proposal key", () => {
    saveAndReopen();
    const restored = useWorkspace.getState().reportingScope;
    expect(restored).not.toBeNull();
    expect(restored?.regions).toEqual(COMBINED);
    // The comparison the strip makes, made on the restored value rather than the original.
    expect(restored?.proposalKey).toBe(reportingScopeProposalKey(COMBINED));
    expect(restored?.decidedBy).toBe(ACTOR);
    expect(restored?.at).toBe(NOW);
  });

  it("restoring the scope writes no sentence and pushes no undo frame", () => {
    // A report on screen, with prose that mentions both examinations.
    useWorkspace.setState({
      findingsText: "MRI Brain: No acute intracranial abnormality.\nCervical spine: No cord compression.",
      impressionText: "Normal MRI brain and cervical spine screening.",
      techniqueText: "Multiplanar multisequence MR imaging of the brain and cervical spine.",
      isDirty: false,
    });
    const before = clinicalSnapshot();
    useWorkspace.getState().hydrateReportingScope(extractCareReportingScope(envelopeOf(answer())));
    // The restoration is a read of one envelope key. If it ever becomes a write — a sentence
    // re-merged, a format re-applied — this is the assertion that says so.
    expect(clinicalSnapshot()).toEqual(before);
  });

  it("a study that never answered still answers nothing — no field, no key, no decision", () => {
    useWorkspace.setState({ reportingScope: undefined });
    const column = saveAndReopen();
    expect(column).toEqual({});
    expect(useWorkspace.getState().reportingScope).toBeUndefined();
  });

  it("superseding the answer by hand clears it for good, not just for this session", () => {
    // The Region control's hand decision is the later act, so it wins. The clear must reach
    // the draft: a memory that only disappears locally comes back on the next reload and
    // widens the examination after he narrowed it.
    useWorkspace.getState().setReportingScope(null);
    const column = saveAndReopen();
    expect(column).toEqual({});
    expect(useWorkspace.getState().reportingScope).toBeUndefined();
  });

  it("the next patient is asked his own question", () => {
    // The answer belongs to one study. Carried to the next patient it would silently widen
    // a report nobody confirmed, so it is declared clinical state and reset with it.
    expect(CLINICAL_RESET_FIELDS).toContain("reportingScope");
    expect(emptyClinicalState().reportingScope).toBeUndefined();
    expect(useWorkspace.getState().reportingScope).toEqual(answer());
    useWorkspace.setState({ ...emptyClinicalState() });
    // ...and a draft with no stored scope leaves it unanswered rather than half-answered.
    useWorkspace.getState().hydrateReportingScope(extractCareReportingScope(null));
    expect(useWorkspace.getState().reportingScope).toBeUndefined();
  });
});

describe("the memory cannot reach the bill or the patient", () => {
  it("carries five fields, none of them an identity or a money field", () => {
    const keys = Object.keys(answer()).sort();
    expect(keys).toEqual(["at", "decidedBy", "kind", "proposalKey", "regions"]);
    const wire = JSON.stringify(reportingScopePayload(answer())).toLowerCase();
    for (const forbidden of ["accession", "patientid", "patient_id", "uhid", "bill", "invoice", "worklist", "studyuid", "studyinstanceuid"]) {
      expect(wire, `the scope record must not name ${forbidden}`).not.toContain(forbidden);
    }
  });
});
