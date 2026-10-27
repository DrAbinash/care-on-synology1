/**
 * PR-A — the rules that decide whether a restored sentence keeps its authorship.
 *
 * Kept apart from the store so each rule can be falsified on its own. The
 * behavioural half is `aiAttributionRestoreJourney.hardening.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { normalizeForDedupe, type FieldProvenanceMap } from "./reportFieldMerge";
import {
  provenanceForRestoredField,
  reportContextIsVerified,
  restoreProvenanceForContext,
  sameReportId,
  sentenceKeyCounts,
  RESTORE_FALLBACK_SOURCE,
  type RestoreReportContext,
} from "./aiAttributionRestore";

const AI = "Acute infarct extends into the insular cortex.";
const MANUAL = "The radiologist wrote this line herself.";
const CONTEXT: RestoreReportContext = {
  studyId: "st-1", hydratedStudyId: "st-1", patientId: "p-1", draftId: "401",
};

function field(previousText: string, previousProvenance: FieldProvenanceMap | undefined, restoredText: string, carryAttribution = true): FieldProvenanceMap {
  return provenanceForRestoredField({ previousText, previousProvenance, restoredText, carryAttribution });
}

describe("report identity comparison", () => {
  it("matches a numeric and a string id for the same row", () => {
    expect(sameReportId("401", 401)).toBe(true);
    expect(sameReportId(401, "401")).toBe(true);
  });

  it("never calls two missing ids the same thing", () => {
    expect(sameReportId(null, null)).toBe(false);
    expect(sameReportId(undefined, undefined)).toBe(false);
    expect(sameReportId(null, "st-1")).toBe(false);
    expect(sameReportId("", "")).toBe(false);
    expect(sameReportId("  ", "  ")).toBe(false);
  });

  it("refuses different ids", () => {
    expect(sameReportId("st-1", "st-2")).toBe(false);
    expect(sameReportId("1", "01")).toBe(false);
  });
});

describe("a restore may carry attribution only inside one verified report", () => {
  it("needs study, hydration, patient and draft all resolved to this study", () => {
    expect(reportContextIsVerified(CONTEXT)).toBe(true);
    expect(reportContextIsVerified({ ...CONTEXT, hydratedStudyId: "st-2" })).toBe(false);
    expect(reportContextIsVerified({ ...CONTEXT, patientId: null })).toBe(false);
    expect(reportContextIsVerified({ ...CONTEXT, draftId: null })).toBe(false);
    expect(reportContextIsVerified({ ...CONTEXT, studyId: null })).toBe(false);
    expect(reportContextIsVerified(null)).toBe(false);
    expect(reportContextIsVerified(undefined)).toBe(false);
  });

  it("packages the live map as a snapshot the store cannot be handed a stale reference to", () => {
    const live: FieldProvenanceMap = { [normalizeForDedupe(AI)]: ["ai-draft"] };
    const packaged = restoreProvenanceForContext(CONTEXT, { findings: live });
    live[normalizeForDedupe(MANUAL)] = ["manual"];
    expect(packaged.provenance.findings?.[normalizeForDedupe(MANUAL)]).toBeUndefined();
    expect(packaged.provenance.findings?.[normalizeForDedupe(AI)]).toEqual(["ai-draft"]);
    expect(packaged.context).toEqual(CONTEXT);
  });
});

describe("per-field rules", () => {
  const prev = `${AI} ${MANUAL}`;
  const prevMap: FieldProvenanceMap = {
    [normalizeForDedupe(AI)]: ["ai-draft"],
    [normalizeForDedupe(MANUAL)]: ["manual"],
  };

  it("carries the recorded source for a sentence that is still there unchanged", () => {
    const out = field(prev, prevMap, prev);
    expect(out[normalizeForDedupe(AI)]).toEqual(["ai-draft"]);
    expect(out[normalizeForDedupe(MANUAL)]).toEqual(["manual"]);
  });

  it("falls back to the conservative default when nothing may be carried", () => {
    const out = field(prev, prevMap, prev, false);
    expect(out[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
    expect(out[normalizeForDedupe(MANUAL)]).toEqual([RESTORE_FALLBACK_SOURCE]);
  });

  it("labels every restored sentence, so nothing arrives unattributed", () => {
    const restored = `${AI} ${MANUAL} A sentence only the local backup ever held.`;
    const out = field(prev, prevMap, restored);
    for (const key of sentenceKeyCounts(restored).keys()) expect(out[key]).toBeDefined();
    expect(out[normalizeForDedupe("A sentence only the local backup ever held.")])
      .toEqual([RESTORE_FALLBACK_SOURCE]);
  });

  it("keeps every source a sentence already carried, in the stable order", () => {
    const both: FieldProvenanceMap = { [normalizeForDedupe(AI)]: ["manual", "ai-draft"] };
    expect(field(AI, both, AI)[normalizeForDedupe(AI)]).toEqual(["manual", "ai-draft"]);
  });

  it("will not guess between two copies of the same sentence", () => {
    const doubled = `${AI} ${AI}`;
    expect(field(doubled, prevMap, doubled)[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
    expect(field(prev, prevMap, doubled)[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
  });

  it("will not guess when the report held the sentence twice and the backup once", () => {
    // Deleting one of two identical lines is an edit with a meaning; carrying the
    // mark over because one copy still matches would decide it for the radiologist.
    const doubled = `${AI} ${AI}`;
    expect(field(doubled, prevMap, AI)[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
  });

  it("does not carry a mark onto edited text, and does not keep the old key", () => {
    const edited = AI.replace("insular cortex", "insular cortex and temporal lobe");
    const out = field(prev, prevMap, edited);
    expect(out[normalizeForDedupe(edited)]).toEqual([RESTORE_FALLBACK_SOURCE]);
    expect(out[normalizeForDedupe(AI)]).toBeUndefined();
  });

  it("treats an empty or absent recorded source as no source", () => {
    expect(field(AI, { [normalizeForDedupe(AI)]: [] }, AI)[normalizeForDedupe(AI)])
      .toEqual([RESTORE_FALLBACK_SOURCE]);
    expect(field(AI, undefined, AI)[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
  });

  it("returns an empty map for an emptied field rather than resurrecting old sentences", () => {
    expect(Object.keys(field(prev, prevMap, ""))).toHaveLength(0);
  });

  it("ignores a mark for a sentence the previous text no longer held", () => {
    // The live map can outlive its text (a sentence deleted then restored from a
    // backup). A key with no occurrence in the previous narrative proves nothing.
    const orphan: FieldProvenanceMap = { [normalizeForDedupe(AI)]: ["ai-draft"] };
    expect(field(MANUAL, orphan, AI)[normalizeForDedupe(AI)]).toEqual([RESTORE_FALLBACK_SOURCE]);
  });
});

describe("sentenceKeyCounts", () => {
  it("counts repeated normalized sentences instead of deduping them away", () => {
    expect(sentenceKeyCounts(`${AI} ${AI} ${MANUAL}`).get(normalizeForDedupe(AI))).toBe(2);
    expect(sentenceKeyCounts(`${AI} ${MANUAL}`).get(normalizeForDedupe(MANUAL))).toBe(1);
    expect(sentenceKeyCounts("")).toEqual(new Map());
  });
});
