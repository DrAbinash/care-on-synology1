/**
 * PR E-2 PRIORITY 1 — the booked title and the documented reporting region.
 *
 * The printed heading is the BILLED identity (`radiology-report-generator.ts`
 * builds `studyTitle` from the catalog test name / worklist StudyDescription and
 * nothing else). That is correct and must not change: a report has to say what
 * was ordered and billed. The defect is what sits beside it — after the
 * radiologist records a region transition (ADR-004), the body documents one
 * segment while the heading still names the whole booked examination, and the
 * page states nothing that tells the reader the two are different on purpose.
 *
 * These tests pin the ONE rule both printed surfaces use to decide whether to
 * say more. It reads the transition history (`structured_json.careRegionTransitions`,
 * already validated by `extractCareRegionTransitions`) and the title being
 * printed. It does not read report prose, and it never rewrites the title:
 *
 *  - no recorded transition, or a recorded region the title already names →
 *    the note is null, so those reports render exactly as they do today;
 *  - narrowing   → the note states the documented region and the booked name;
 *  - widening or a different segment → same sentence, and no coverage claim;
 *  - non-spine, malformed or blank records → no note. Saying "the scope was
 *    narrowed" from a half-parsed record would be a claim about anatomy.
 */

import { describe, expect, test } from "vitest";

import {
  documentedReportingScope,
  reportedScopeNote,
  type ReportedScopeRecord,
} from "./reportingScope";

const WHOLE = "MRI Whole Spine";

function record(over: Partial<ReportedScopeRecord> = {}) {
  return {
    fromRegion: "Whole Spine",
    toRegion: "Cervical Spine",
    decidedBy: "abinashsingh@gmail.com",
    at: "2026-10-13T09:40:00.000Z",
    ...over,
  };
}

describe("documentedReportingScope — the recorded region is only worth printing when it disagrees with the title", () => {
  test("T1 no transition history: no note. This is every report the clinic has never re-regioned.", () => {
    expect(documentedReportingScope({ bookedTitle: WHOLE, records: [] })).toBeNull();
    expect(documentedReportingScope({ bookedTitle: WHOLE, records: null })).toBeNull();
    expect(documentedReportingScope({ bookedTitle: WHOLE, records: undefined })).toBeNull();
  });

  test("T2 a recorded region the booked title already names: no note, so nothing new is claimed.", () => {
    expect(
      documentedReportingScope({ bookedTitle: "MRI Cervical Spine", records: [record()] }),
    ).toBeNull();
  });

  test("T3 synonyms count as agreement on both sides (a clinic writes C-Spine, the catalog writes Cervical Spine).", () => {
    expect(
      documentedReportingScope({ bookedTitle: "MRI C-Spine", records: [record({ toRegion: "Cervical Spine" })] }),
    ).toBeNull();
    expect(
      documentedReportingScope({ bookedTitle: "MRI Cervical Spine", records: [record({ toRegion: "C-Spine" })] }),
    ).toBeNull();
  });

  test("T3b the title-side aliases are read, or a booked C-Spine looks like an unlocated spine.", () => {
    // If "C-Spine" in a booked name were not folded onto Cervical Spine, the
    // rule would have no opinion here and the contradiction would print silent.
    const scope = documentedReportingScope({
      bookedTitle: "MRI C-Spine",
      records: [record({ fromRegion: "Cervical Spine", toRegion: "Dorsal Spine" })],
    });
    expect(scope).not.toBeNull();
    expect(scope!.narrowing).toBe(false);
  });

  test("T4 a narrowing is reported: the segment the title names is wider than the segment the record names.", () => {
    const scope = documentedReportingScope({ bookedTitle: WHOLE, records: [record()] });
    expect(scope).not.toBeNull();
    expect(scope!.toRegion).toBe("Cervical Spine");
    expect(scope!.bookedTitle).toBe(WHOLE);
    expect(scope!.narrowing).toBe(true);
  });

  test("T5 the LAST recorded transition decides. Earlier transitions stay in the history and are not flattened.", () => {
    const scope = documentedReportingScope({
      bookedTitle: WHOLE,
      records: [record({ toRegion: "Cervical Spine" }), record({ toRegion: "LS Spine" })],
    });
    expect(scope!.toRegion).toBe("LS Spine");
    expect(scope!.narrowing).toBe(true);
  });

  test("T6 a multi-region selection is scored on the union it actually covers, not on its first word.", () => {
    const twoOfThree = documentedReportingScope({
      bookedTitle: WHOLE,
      records: [record({ toRegion: "Cervical Spine + LS Spine" })],
    });
    expect(twoOfThree).not.toBeNull();
    expect(twoOfThree!.narrowing).toBe(true);
    // All three segments named, in any order, is the coverage the title already
    // claims — a note here would state a narrowing that did not happen.
    expect(
      documentedReportingScope({
        bookedTitle: WHOLE,
        records: [record({ toRegion: "LS Spine + Dorsal Spine + Cervical Spine" })],
      }),
    ).toBeNull();
  });

  test("T7 a change to a different segment is reported but never called a narrowing.", () => {
    const scope = documentedReportingScope({
      bookedTitle: "MRI Cervical Spine",
      records: [record({ fromRegion: "Cervical Spine", toRegion: "Dorsal Spine" })],
    });
    expect(scope).not.toBeNull();
    expect(scope!.narrowing).toBe(false);
  });

  test("T8 a widening is reported, and the rule keeps no coverage claim in it.", () => {
    const scope = documentedReportingScope({
      bookedTitle: "MRI Cervical Spine",
      records: [record({ fromRegion: "Cervical Spine", toRegion: "Whole Spine" })],
    });
    expect(scope).not.toBeNull();
    expect(scope!.narrowing).toBe(false);
  });

  test("T9 malformed or blank records change nothing: an unreadable scope is never printed as a scope.", () => {
    for (const bad of [
      record({ toRegion: "" }),
      record({ toRegion: "   " }),
      record({ toRegion: null as unknown as string }),
    ]) {
      expect(documentedReportingScope({ bookedTitle: WHOLE, records: [bad] })).toBeNull();
    }
  });

  test("T9b a last record that cannot be read does not resurrect the one before it.", () => {
    // The unreadable row is the most recent decision on the record; printing an
    // older scope would say the report documents something it may not.
    expect(
      documentedReportingScope({ bookedTitle: WHOLE, records: [record(), record({ toRegion: "" })] }),
    ).toBeNull();
  });

  test("T10 outside the spine the rule has no opinion, exactly as ADR-004 rule 6 gives none.", () => {
    expect(
      documentedReportingScope({
        bookedTitle: "MRI Brain",
        records: [record({ fromRegion: null, toRegion: "Brain" })],
      }),
    ).toBeNull();
    // The bare "Spine" tab covers no single segment, so it narrows nothing.
    expect(
      documentedReportingScope({ bookedTitle: WHOLE, records: [record({ toRegion: "Spine" })] }),
    ).toBeNull();
  });

  test("T11 a missing booked title is not an invitation to invent one.", () => {
    expect(documentedReportingScope({ bookedTitle: null, records: [record()] })).toBeNull();
    expect(documentedReportingScope({ bookedTitle: "   ", records: [record()] })).toBeNull();
  });
});

describe("reportedScopeNote — one sentence, provenance only, and never a claim about the scanner", () => {
  test("T12 the narrowing sentence names the documented region and the booked examination.", () => {
    expect(reportedScopeNote({ bookedTitle: WHOLE, records: [record()] })).toBe(
      "Documented reporting region: Cervical Spine (recorded by abinashsingh@gmail.com on 13 Oct 2026). Booked examination: MRI Whole Spine.",
    );
  });

  test("T13 no coverage claim: the note describes the report, never what was imaged or which sequences ran.", () => {
    for (const booked of [WHOLE, "MRI Cervical Spine"]) {
      const note = reportedScopeNote({
        bookedTitle: booked,
        records: [record({ toRegion: booked === WHOLE ? "Cervical Spine" : "Whole Spine" })],
      });
      expect(note).not.toBeNull();
      for (const claim of ["imaged", "acquired", "performed", "only", "limited", "sequence"]) {
        expect(note!.toLowerCase()).not.toContain(claim);
      }
    }
  });

  test("T14 attribution is dropped when the record carries none, rather than printing an empty name.", () => {
    expect(
      reportedScopeNote({ bookedTitle: WHOLE, records: [record({ decidedBy: "", at: "" })] }),
    ).toBe("Documented reporting region: Cervical Spine. Booked examination: MRI Whole Spine.");
    expect(
      reportedScopeNote({ bookedTitle: WHOLE, records: [record({ at: "" })] }),
    ).toBe(
      "Documented reporting region: Cervical Spine (recorded by abinashsingh@gmail.com). Booked examination: MRI Whole Spine.",
    );
    expect(
      reportedScopeNote({ bookedTitle: WHOLE, records: [record({ decidedBy: "" })] }),
    ).toBe(
      "Documented reporting region: Cervical Spine. Booked examination: MRI Whole Spine.",
    );
  });

  test("T15 the decision date is rendered in UTC so the same record prints the same day everywhere.", () => {
    expect(
      reportedScopeNote({ bookedTitle: WHOLE, records: [record({ at: "2026-10-13T23:30:00.000Z" })] }),
    ).toContain("on 13 Oct 2026");
  });

  test("T16 an unparseable timestamp is omitted; a fabricated date on a clinical document is worse than none.", () => {
    expect(
      reportedScopeNote({ bookedTitle: WHOLE, records: [record({ at: "not-a-date" })] }),
    ).toBe(
      "Documented reporting region: Cervical Spine (recorded by abinashsingh@gmail.com). Booked examination: MRI Whole Spine.",
    );
  });

  test("T17 no note where there is no scope to report (T1/T2/T9 through the sentence builder).", () => {
    expect(reportedScopeNote({ bookedTitle: WHOLE, records: [] })).toBeNull();
    expect(reportedScopeNote({ bookedTitle: "MRI Cervical Spine", records: [record()] })).toBeNull();
    expect(reportedScopeNote({ bookedTitle: WHOLE, records: [record({ toRegion: "" })] })).toBeNull();
  });
});
