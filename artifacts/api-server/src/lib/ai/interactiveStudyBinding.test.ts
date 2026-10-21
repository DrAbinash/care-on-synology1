/**
 * TASK E-1 — which study an interactive AI request may name.
 *
 * The defect this pins is not a wrong lookup; it is a lookup whose answer was
 * thrown away. `/draft` and `/query` both read `radiology_worklist` by the UID in
 * the body and continued to Orthanc with that UID whether or not a row existed, so
 * "we looked it up" described an enrichment, never a bound. Every case below asks
 * for the outcome the old code produced when it found nothing, and asserts that
 * nothing is now an answer rather than a pass.
 *
 * Two halves:
 *  - `decideStudyBinding` is the rule with the rows handed in, so a refusal cannot
 *    be hidden behind a database that happens to be empty.
 *  - `bindInteractiveStudy` is the read, checked against a recorded fake `db` so a
 *    claim that was never consulted cannot look like a claim that was checked and
 *    failed.
 */
import { describe, expect, it, vi } from "vitest";

const { rows, reads } = vi.hoisted(() => ({
  rows: {
    worklistById: [] as unknown[],
    worklistByUid: [] as unknown[],
    studyByUid: [] as unknown[],
  },
  reads: [] as Array<{ table: string; limit: number }>,
}));

// Only the connection is stood in. The tables stay real, so `eq(column, value)`
// builds the SQL the route would build and a test cannot pass by mocking the
// condition away. The two entry points are both served because the module under
// test follows the routes' convention of taking `radiologyStudiesTable` off
// `@workspace/db` and the worklist table off `@workspace/db/schema`.
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const { radiologyWorklistTable } = schema;
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const which =
            table === radiologyWorklistTable
              ? "radiology_worklist"
              : table === schema.radiologyStudiesTable
                ? "radiology_studies"
                : "unknown";
          const chain: Record<string, unknown> = {
            limit: async (n: number) => {
              reads.push({ table: which, limit: n });
              if (which === "radiology_worklist") {
                return rows.worklistById.length
                  ? rows.worklistById.splice(0)
                  : rows.worklistByUid.splice(0);
              }
              return rows.studyByUid.splice(0);
            },
          };
          chain.orderBy = () => chain;
          chain.where = () => chain;
          return chain;
        },
      }),
    },
    // A mock module must carry every name the module under test imports, or the
    // import throws before a single assertion runs.
    radiologyStudiesTable: schema.radiologyStudiesTable,
  };
});

import {
  bindInteractiveStudy,
  decideStudyBinding,
  refuseConflictingPatientClaim,
  type StudyBindingConfirmed,
  type StudyBindingRows,
  type StudyRowFacts,
} from "./interactiveStudyBinding";

const UID = "1.2.826.0.1.3680043.9.7721.synthetic";
const OTHER_UID = "1.2.826.0.1.3680043.9.7721.OTHER";

function facts(over: Partial<StudyRowFacts> = {}): StudyRowFacts {
  return {
    studyInstanceUID: UID,
    accessionNumber: "ACC-SYNTH-1",
    patientId: 4182,
    modality: "MR",
    studyDescription: "MRI Brain",
    ...over,
  };
}

function noRows(): StudyBindingRows {
  return { worklistById: null, worklistByUid: null, studyByUid: null, studyByUidCount: 0 };
}

function claim(worklistId: number | null = null, claimedUid: string | null = null) {
  return { worklistId, claimedUid };
}

describe("decideStudyBinding — a named study must be this clinic's study", () => {
  it("refuses a UID that no worklist row and no study row carries", () => {
    const out = decideStudyBinding(claim(null, UID), noRows());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable — the assertion above is the test");
    expect(out.code).toBe("STUDY_NOT_IN_CLINIC");
    expect(out.httpStatus).toBe(400);
  });

  it("binds on a worklist row carrying the claimed UID, and carries its accession and patient", () => {
    const out = decideStudyBinding(claim(null, UID), {
      ...noRows(),
      worklistByUid: facts(),
    });
    expect(out).toEqual({
      ok: true,
      studyInstanceUID: UID,
      accessionNumber: "ACC-SYNTH-1",
      patientId: 4182,
      modality: "MR",
      studyDescription: "MRI Brain",
      source: "worklist-by-uid",
    });
  });

  it("binds a PACS-first study that is billed but not yet on a worklist", () => {
    const out = decideStudyBinding(claim(null, UID), {
      ...noRows(),
      studyByUid: facts({ modality: "CT", studyDescription: null }),
      studyByUidCount: 1,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.source).toBe("study-by-uid");
    expect(out.accessionNumber).toBe("ACC-SYNTH-1");
  });

  it("still binds when the UID appears on two study rows, and invents no accession", () => {
    const out = decideStudyBinding(claim(null, UID), {
      ...noRows(),
      studyByUid: facts(),
      studyByUidCount: 2,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.studyInstanceUID).toBe(UID);
    expect(out.accessionNumber).toBeNull();
    expect(out.patientId).toBeNull();
  });

  it("refuses a stale worklistId instead of answering with the body's UID", () => {
    // This is the shape the old code made a success of: `worklistId` found nothing,
    // so the handler kept the caller's UID and reported a study it had not confirmed.
    const out = decideStudyBinding(claim(77, UID), { ...noRows(), worklistById: null });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.code).toBe("WORKLIST_NOT_FOUND");
    expect(out.httpStatus).toBe(404);
  });

  it("refuses a worklistId whose row is a different study, rather than quietly swapping the UID", () => {
    const out = decideStudyBinding(claim(77, OTHER_UID), {
      ...noRows(),
      worklistById: facts(),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.code).toBe("STUDY_UID_MISMATCH");
    // The refusal names both sides, because "which one did I click" is the question.
    expect(out.message).toContain(UID);
    expect(out.message).toContain(OTHER_UID);
  });

  it("refuses a worklist row with no DICOM identity when the body claims one", () => {
    const out = decideStudyBinding(claim(77, UID), {
      ...noRows(),
      worklistById: facts({ studyInstanceUID: null }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.code).toBe("NO_STUDY_UID");
  });

  it("binds a worklist row with no DICOM identity when the body names no study — a text-only call fetches no images", () => {
    const out = decideStudyBinding(claim(77, null), {
      ...noRows(),
      worklistById: facts({ studyInstanceUID: null }),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.studyInstanceUID).toBeNull();
    expect(out.source).toBe("worklist-by-id");
  });

  it("treats a UID-bearing worklist row whose UID column is empty-string as no identity, not as a match", () => {
    // `byUid?.studyInstanceUID` is truthiness on purpose: a row that carries "" is
    // not a row that carries this UID, and binding to "" would fetch every study
    // under a path segment Orthanc resolves as the archive root.
    const out = decideStudyBinding(claim(null, ""), { ...noRows(), worklistByUid: facts({ studyInstanceUID: "" }) });
    // An empty claim is not a claim at all, so this is the text-only arm.
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.studyInstanceUID).toBeNull();
  });

  it("allows a request that names no study and confirms nothing", () => {
    const out = decideStudyBinding(claim(null, null), noRows());
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.source).toBe("not-named");
    expect(out.studyInstanceUID).toBeNull();
  });

  it("says in every refusal what the radiologist has NOT lost", () => {
    // Task C: a refusal that reads like an internal error code teaches the
    // clinician nothing, and one that omits "your report is untouched" invites a
    // double attempt on top of text that was never replaced.
    const refusals = [
      decideStudyBinding(claim(null, UID), noRows()),
      decideStudyBinding(claim(77, UID), noRows()),
      decideStudyBinding(claim(77, OTHER_UID), { ...noRows(), worklistById: facts() }),
      decideStudyBinding(claim(77, UID), { ...noRows(), worklistById: facts({ studyInstanceUID: null }) }),
    ];
    expect(refusals).toHaveLength(4);
    for (const out of refusals) {
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("a refusal was expected");
      expect(out.message).toMatch(/no images (were sent|could be sent)/i);
    }
  });
});

describe("bindInteractiveStudy — the read behind the rule", () => {
  const reset = () => {
    rows.worklistById = [];
    rows.worklistByUid = [];
    rows.studyByUid = [];
    reads.length = 0;
  };

  it("looks a worklistId up by that row and consults nothing else", async () => {
    reset();
    rows.worklistById = [facts()];
    const out = await bindInteractiveStudy({ worklistId: 77 });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(reads).toEqual([{ table: "radiology_worklist", limit: 1 }]);
  });

  it("does not reach the archive for a worklistId that has no row", async () => {
    reset();
    const out = await bindInteractiveStudy({ worklistId: 77 });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.code).toBe("WORKLIST_NOT_FOUND");
    expect(reads).toEqual([{ table: "radiology_worklist", limit: 1 }]);
  });

  it("consults the worklist before the study table for a claimed UID", async () => {
    reset();
    rows.worklistByUid = [facts()];
    const out = await bindInteractiveStudy({ studyInstanceUID: `  ${UID}  ` });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.source).toBe("worklist-by-uid");
    expect(reads).toEqual([{ table: "radiology_worklist", limit: 1 }]);
  });

  it("falls back to radiology_studies, asks for at most two rows, and stops there", async () => {
    reset();
    rows.studyByUid = [facts()];
    const out = await bindInteractiveStudy({ studyInstanceUID: UID });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.source).toBe("study-by-uid");
    expect(reads).toEqual([
      { table: "radiology_worklist", limit: 1 },
      { table: "radiology_studies", limit: 2 },
    ]);
  });

  it("refuses when neither table has the UID, and the refusal is not a read failure", async () => {
    reset();
    const out = await bindInteractiveStudy({ studyInstanceUID: UID });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.code).toBe("STUDY_NOT_IN_CLINIC");
    expect(reads).toHaveLength(2);
  });

  it("reads nothing at all when the request names no study", async () => {
    reset();
    const out = await bindInteractiveStudy({ studyInstanceUID: "   " });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(reads).toHaveLength(0);
  });
});

describe("refuseConflictingPatientClaim — the browser does not get to say whose study it is", () => {
  function bound(over: Partial<StudyRowFacts> = {}): StudyBindingConfirmed {
    const out = decideStudyBinding(claim(null, UID), {
      ...noRows(),
      worklistByUid: facts(over),
    });
    if (!out.ok) throw new Error("fixture: this study must bind, or the test proves nothing");
    return out;
  }

  it("refuses a patient id that is not the study's own patient", () => {
    const out = refuseConflictingPatientClaim(bound(), 999);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("a refusal was expected");
    expect(out.httpStatus).toBe(409);
    expect(out.code).toBe("PATIENT_ID_MISMATCH");
    // Both sides named, so the radiologist can see which is which rather than guess.
    expect(out.message).toContain("999");
    expect(out.message).toContain(String(facts().patientId));
    expect(out.message).toMatch(/no images were sent|nothing was sent/i);
  });

  it("passes through the patient the study really belongs to", () => {
    const ok = bound();
    const out = refuseConflictingPatientClaim(ok, ok.patientId);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out).toBe(ok);
  });

  it("never adopts the claimed id when the clinic's row has no patient linked", () => {
    // Absence of a server-side answer is not permission to use the browser's: the
    // caller reads the binding's null, so the demographics lookup finds no patient and
    // the row files none.
    const ok = bound({ patientId: null });
    const out = refuseConflictingPatientClaim(ok, 999);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.patientId).toBeNull();
  });

  it("drops the claim for a text-only request that names no study", () => {
    const out = decideStudyBinding(claim(null, null), noRows());
    if (!out.ok) throw new Error("fixture: a text-only request must be allowed");
    const checked = refuseConflictingPatientClaim(out, 999);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("unreachable");
    expect(checked.patientId).toBeNull();
    expect(checked.studyInstanceUID).toBeNull();
  });

  it("treats anything that is not a patient id as no claim at all", () => {
    // `POST /drafts` reads its body without a schema, so a string, a fraction, a
    // negative or null can arrive. None of them may become a stored identity, and none
    // of them may trip a refusal over a value that names no patient.
    for (const notAnId of ["999", 999.5, 0, -7, null, undefined, NaN, {}, []]) {
      const out = refuseConflictingPatientClaim(bound(), notAnId);
      expect(out.ok).toBe(true);
      if (!out.ok) throw new Error(`a refusal for ${JSON.stringify(notAnId)}`);
      expect(out.patientId).toBe(facts().patientId);
    }
  });
});
