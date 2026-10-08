/**
 * D1 — StudyInstanceUID binding must be proven, not guessed.
 *
 * The decision itself is pure (studyUidBinding.ts) so all of it runs here
 * without Postgres. Anything that only exists as SQL text in a route is pinned
 * by the source contracts at the end, which is what makes the write gate and
 * the viewer gate testable on this repository's CI and on a laptop alike.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STUDY_UID_PROVENANCE,
  STUDY_UID_PROVENANCE_VALUES,
  accessionUidMap,
  canBindUidToRow,
  decideStudyUidBinding,
  distinctCandidateUids,
  identityKey,
  type BindingCandidate,
} from "./studyUidBinding";

const ERP_UID = "1.2.840.113619.2.55.3.999.1";
const OTHER_UID = "1.2.840.113619.2.55.3.999.2";
const THIRD_UID = "1.2.840.113619.2.55.3.999.3";

const cand = (
  studyInstanceUID: string | null,
  accessionNumber: string | null = null,
  patientId: string | null = null,
): BindingCandidate => ({ studyInstanceUID, accessionNumber, patientId });

/** Reordered in every direction — a decision that survives this is not reading
 *  position, which is exactly the rows[0] behaviour D1 removes. */
function everyOrder<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const rotations = items.map((_, i) => [...items.slice(i), ...items.slice(0, i)]);
  return [...rotations, [...items].reverse()];
}

describe("D1-01 exact accession, one candidate -> RESOLVED and persisted with provenance", () => {
  const row = { accessionNumber: "ACC-20261008-MR-012" };
  const candidates = [cand(ERP_UID, "acc-20261008-mr-012 ")];

  it("resolves", () => {
    const d = decideStudyUidBinding(row, candidates);
    expect(d.status).toBe("resolved");
    expect(d.studyInstanceUID).toBe(ERP_UID);
    expect(d.provenance).toBe(STUDY_UID_PROVENANCE.accessionExact);
    expect(d.matchedOn).toBe("accession");
    expect(d.reason).toBe("exact-accession");
  });

  it("is case- and whitespace-insensitive on the accession, not substring-based", () => {
    expect(decideStudyUidBinding({ accessionNumber: " acc-20261008-mr-012 " }, candidates).status).toBe("resolved");
    // A candidate whose accession merely CONTAINS the row's is a different study.
    expect(decideStudyUidBinding(row, [cand(OTHER_UID, "ACC-20261008-MR-0121")]).status).toBe("unresolved");
  });

  it("writes provenance through the gate", () => {
    const d = decideStudyUidBinding(row, candidates);
    expect(canBindUidToRow(null, d.studyInstanceUID).allowed).toBe(true);
  });
});

describe("D1-02 exact external PatientID, one candidate -> RESOLVED", () => {
  const row = { dicomPatientId: "UHID-4471" };
  const candidates = [cand(ERP_UID, null, "uhid-4471")];

  it("resolves on the external identifier alone", () => {
    const d = decideStudyUidBinding(row, candidates);
    expect(d.status).toBe("resolved");
    expect(d.provenance).toBe(STUDY_UID_PROVENANCE.patientIdExact);
    expect(d.matchedOn).toBe("patientId");
  });

  it("prefers accession evidence when both are available", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-1", dicomPatientId: "UHID-4471" },
      [cand(ERP_UID, "ACC-1", "UHID-4471")],
    );
    expect(d.provenance).toBe(STUDY_UID_PROVENANCE.accessionExact);
  });
});

describe("D1-03 name + date + modality is never identity", () => {
  it("cannot be asked about: the decision receives no name, date or modality at all", () => {
    // The function signature is the guard. A candidate set produced by a
    // `*Nair*` + 2026-10-08 + MRI search is indistinguishable here from any
    // other search, so nothing downstream can award it a binding.
    const paramNames = decideStudyUidBinding.length;
    expect(paramNames).toBe(2);
    const rowKeys = Object.keys(decideStudyUidBinding({ accessionNumber: "A" }, []));
    expect(rowKeys.sort()).toEqual(
      ["candidateCount", "matchedOn", "provenance", "reason", "status", "studyInstanceUID"].sort(),
    );
  });

  it("a single plausible candidate that agrees on nothing returns NO uid", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-20261008-MR-012" },
      [cand(OTHER_UID, "", "SOME-OTHER-PATIENT")],
    );
    expect(d.status).toBe("unresolved");
    expect(d.studyInstanceUID).toBeNull();
    expect(d.provenance).toBeNull();
    expect(d.reason).toBe("no-exact-accession");
    expect(canBindUidToRow(null, d.studyInstanceUID).allowed).toBe(false);
  });

  it("a row with neither accession nor external PatientID is unresolved without searching", () => {
    const d = decideStudyUidBinding({}, [cand(OTHER_UID, "ACC-OTHER", "UHID-OTHER")]);
    expect(d.status).toBe("unresolved");
    expect(d.reason).toBe("no-strong-identifier");
  });
});

describe("D1-04 two similar candidates -> AMBIGUOUS", () => {
  const row = { accessionNumber: "ACC-7" };
  const candidates = [cand(ERP_UID, "ACC-7"), cand(OTHER_UID, "ACC-7")];

  it("refuses both", () => {
    const d = decideStudyUidBinding(row, candidates);
    expect(d.status).toBe("ambiguous");
    expect(d.studyInstanceUID).toBeNull();
    expect(d.candidateCount).toBe(2);
    expect(canBindUidToRow("", d.studyInstanceUID).allowed).toBe(false);
  });

  it("two rows pointing at the SAME study is one candidate, not ambiguity", () => {
    const d = decideStudyUidBinding(row, [cand(ERP_UID, "ACC-7"), cand(ERP_UID, "ACC-7")]);
    expect(d.status).toBe("resolved");
    expect(d.candidateCount).toBe(1);
  });

  it("blank and duplicate UIDs never inflate the count", () => {
    expect(distinctCandidateUids([cand(""), cand(null), cand("  "), cand(ERP_UID)])).toHaveLength(1);
  });
});

describe("D1-05 accession supplied but no candidate matches it exactly", () => {
  it("does not fall back to the first row of the search", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-7" },
      [cand(ERP_UID, "ACC-8"), cand(OTHER_UID, "ACC-9"), cand(THIRD_UID, "")],
    );
    expect(d.status).toBe("unresolved");
    expect(d.studyInstanceUID).toBeNull();
    expect(d.candidateCount).toBe(3);
  });

  it("zero candidates is unresolved, not a 404-with-a-guess", () => {
    const d = decideStudyUidBinding({ accessionNumber: "ACC-7" }, []);
    expect(d.status).toBe("unresolved");
    expect(d.reason).toBe("no-candidates");
  });
});

describe("D1-06 strong identifiers that disagree -> CONFLICT", () => {
  it("exact accession but a conflicting external PatientID", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-7", dicomPatientId: "UHID-111" },
      [cand(ERP_UID, "ACC-7", "UHID-222")],
    );
    expect(d.status).toBe("conflict");
    expect(d.reason).toBe("patient-id-conflicts");
    expect(d.studyInstanceUID).toBeNull();
    expect(d.provenance).toBeNull();
  });

  it("exact PatientID but a conflicting accession", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-7", dicomPatientId: "UHID-111" },
      [cand(ERP_UID, "ACC-8", "UHID-111")],
    );
    expect(d.status).toBe("conflict");
    expect(d.reason).toBe("accession-conflicts");
  });

  it("a candidate that carries no second identifier does not conflict — it is silent, not contradictory", () => {
    const d = decideStudyUidBinding(
      { accessionNumber: "ACC-7", dicomPatientId: "UHID-111" },
      [cand(ERP_UID, "ACC-7")],
    );
    expect(d.status).toBe("resolved");
  });
});

describe("D1-07 a resolver never re-points a row that already holds a different UID", () => {
  it("refuses to replace UID A with UID B", () => {
    const gate = canBindUidToRow(ERP_UID, OTHER_UID);
    expect(gate.allowed).toBe(false);
    expect(gate.alreadyBound).toBe(false);
    expect(gate.reason).toBe("row-already-bound-to-other-study");
  });

  it("treats the same UID as already bound, so nothing is rewritten", () => {
    const gate = canBindUidToRow(ERP_UID, ERP_UID);
    expect(gate.allowed).toBe(false);
    expect(gate.alreadyBound).toBe(true);
  });

  it("binds only an unbound row, including one holding an empty string", () => {
    expect(canBindUidToRow(null, ERP_UID).allowed).toBe(true);
    expect(canBindUidToRow("   ", ERP_UID).allowed).toBe(true);
    expect(canBindUidToRow(ERP_UID, null).allowed).toBe(false);
  });
});

describe("D1-08 historical rows stay unknown", () => {
  it("the vocabulary has no 'verified'/'legacy'/'auto' escape hatch", () => {
    expect(STUDY_UID_PROVENANCE_VALUES).toEqual([
      "PACS_INTAKE",
      "ORTHANC_ACCESSION_EXACT",
      "ORTHANC_PATIENT_ID_EXACT",
    ]);
    for (const banned of ["VERIFIED", "LEGACY", "AUTO", "GUESSED", "NAME_MATCH", "TRUE"]) {
      expect(STUDY_UID_PROVENANCE_VALUES).not.toContain(banned);
    }
  });

  it("an already-bound row reports its recorded provenance verbatim, never a constant", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
    const block = resolverBody(src);
    expect(block).toContain("provenance: row.studyUidProvenance ?? null");
    expect(block).not.toContain("provenance: STUDY_UID_PROVENANCE.pacsIntake");
  });

  it("the migration adds the column and rewrites no row", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../../../migrations/zzzzzzzzzz_study_uid_provenance.sql"),
      "utf8",
    );
    expect(sql).toContain("ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS study_uid_provenance TEXT;");
    // Fail red if a backfill is ever pasted in: history cannot be relabelled.
    // Case-insensitive on the RAW text — matching a lower-case pattern against
    // sql.toUpperCase() silently never matches and reads as a passing guard.
    expect(sql).not.toMatch(/UPDATE\s+radiology_worklist/i);
    expect(sql).not.toMatch(/SET\s+study_uid_provenance/i);
    expect(sql).not.toMatch(/DEFAULT\s+'(PACS_INTAKE|ORTHANC_ACCESSION_EXACT)'/i);
  });
});

describe("D1-09 the ERP's internal patient PK is never identity evidence", () => {
  it("a row that knows only its own numeric ids has no strong identifier", () => {
    // patients.id / studyId are not fields the decision can read at all, so a
    // DICOM PatientID that happens to equal a serial PK cannot be compared to
    // anything. Same protection matchingEngine.ts documents at :146-147.
    const d = decideStudyUidBinding({ dicomPatientId: null, accessionNumber: null }, [cand(ERP_UID, "42", "42")]);
    expect(d.status).toBe("unresolved");
    expect(d.reason).toBe("no-strong-identifier");
  });

  it("the resolver's row read does not select the internal patient FK", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
    const block = resolverBody(src);
    expect(block).toContain("dicomPatientId: radiologyWorklistTable.dicomPatientId");
    expect(block).not.toContain("patientId: radiologyWorklistTable.patientId");
  });

  it("the route passes dicomPatientId, never patientId, into the decision", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
    const call = src.slice(src.indexOf("const decision = decideStudyUidBinding("));
    const argBlock = call.slice(0, call.indexOf("orthanc.rows"));
    expect(argBlock).toContain("dicomPatientId: row.dicomPatientId");
    expect(argBlock).not.toMatch(/dicomPatientId:\s*row\.patientId/);
  });
});

describe("D1-10 candidate ordering is not identity", () => {
  const cases: Array<{ label: string; row: { accessionNumber?: string; dicomPatientId?: string }; cands: BindingCandidate[]; status: string }> = [
    { label: "resolved", row: { accessionNumber: "ACC-7" }, cands: [cand(OTHER_UID, "ACC-8"), cand(ERP_UID, "ACC-7")], status: "resolved" },
    { label: "ambiguous", row: { accessionNumber: "ACC-7" }, cands: [cand(ERP_UID, "ACC-7"), cand(OTHER_UID, "ACC-7"), cand(THIRD_UID, "ACC-7")], status: "ambiguous" },
    { label: "conflict", row: { accessionNumber: "ACC-7", dicomPatientId: "UHID-1" }, cands: [cand(ERP_UID, "ACC-7", "UHID-2"), cand(OTHER_UID, "ACC-9")], status: "conflict" },
    { label: "unresolved", row: { accessionNumber: "ACC-7" }, cands: [cand(ERP_UID, "ACC-8"), cand(OTHER_UID, "ACC-9")], status: "unresolved" },
  ];

  for (const c of cases) {
    it(`${c.label} is stable under every reordering`, () => {
      const reference = decideStudyUidBinding(c.row, c.cands);
      expect(reference.status).toBe(c.status);
      for (const order of everyOrder(c.cands)) {
        const d = decideStudyUidBinding(c.row, order);
        expect(d).toEqual(reference);
      }
    });
  }

  it("the resolved uid is the matched one, whatever position it sat at", () => {
    const cands = [cand(OTHER_UID, "ACC-8"), cand(THIRD_UID, "ACC-9"), cand(ERP_UID, "ACC-7")];
    for (const order of everyOrder(cands)) {
      expect(decideStudyUidBinding({ accessionNumber: "ACC-7" }, order).studyInstanceUID).toBe(ERP_UID);
    }
  });

  it("no resolver path indexes a candidate list positionally any more", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
    const block = resolverBody(src);
    expect(block).not.toContain("orthanc.rows[0]");
    expect(block).not.toMatch(/\bhit\s*=\s*orthanc\.rows/);
  });
});

describe("display backfill uses the same rule as the resolver", () => {
  it("a repeated accession pointing at different studies yields no uid", () => {
    const map = accessionUidMap([cand(ERP_UID, "ACC-7"), cand(OTHER_UID, "acc-7")]);
    expect(map.has("ACC-7")).toBe(false);
  });

  it("a unique accession yields it, and ordering cannot change that", () => {
    const cands = [cand(ERP_UID, "ACC-7"), cand(OTHER_UID, "ACC-8")];
    for (const order of everyOrder(cands)) {
      const map = accessionUidMap(order);
      expect(map.get("ACC-7")).toBe(ERP_UID);
      expect(map.get("ACC-8")).toBe(OTHER_UID);
    }
  });

  it("blank accession or blank uid never enters the map", () => {
    expect(accessionUidMap([cand(ERP_UID, "   "), cand("", "ACC-7"), cand(null, "ACC-8")]).size).toBe(0);
  });

  it("the list endpoint calls accessionUidMap instead of building a last-write-wins Map", () => {
    const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
    expect(src).toContain("accessionUidMap(orthancForBackfill.rows)");
  });
});

describe("identityKey", () => {
  it("trims, case-folds and maps missing to empty", () => {
    expect(identityKey("  acc-7 ")).toBe("ACC-7");
    expect(identityKey(null)).toBe("");
    expect(identityKey(undefined)).toBe("");
  });
});

// ── Source contracts ────────────────────────────────────────────────────────
// The parts of D1 that are a SQL statement or a JSX branch cannot execute
// without Postgres/a DOM harness on this repository, so they are pinned on
// source text — bounded on syntactic markers rather than character counts, and
// each one is written to fail if the guard is deleted or the old shape returns.

/** Slice of radiology.ts covering only the resolve-study-uid handler. */
function resolverBody(src: string): string {
  const start = src.indexOf(`"/pacs-worklist/:id/resolve-study-uid"`);
  expect(start, "resolver route not found").toBeGreaterThan(-1);
  const end = src.indexOf("});", src.indexOf("isWorklistUidRaceViolation(err, uid)", start));
  expect(end, "resolver route does not terminate where expected").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("persistence is conditional and atomic", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/radiology.ts"), "utf8");
  const block = resolverBody(src);

  it("the UID and its provenance are always written in the same set()", () => {
    const sets = [...block.matchAll(/\.set\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) {
      const hasUid = /studyInstanceUID:/.test(s);
      const hasProvenance = /studyUidProvenance:/.test(s);
      expect(hasUid === hasProvenance).toBe(true);
    }
    expect(block).toContain("studyUidProvenance: decision.provenance");
  });

  it("the update only lands while the row is still unbound or already holds this UID", () => {
    expect(block).toContain("isNull(radiologyWorklistTable.studyInstanceUID)");
    expect(block).toContain(`eq(radiologyWorklistTable.studyInstanceUID, "")`);
    expect(block).toContain("eq(radiologyWorklistTable.studyInstanceUID, uid)");
  });

  it("a zero-row conditional update is re-read and re-decided, never retried", () => {
    expect(block).toContain("if (!updated)");
    expect(block).toContain("const recheck = canBindUidToRow(current, uid)");
    expect(block).toContain("reason: recheck.reason");
    // One write attempt only: a resolver that retries after losing the race is
    // how a binding eventually lands on whatever the archive said last.
    expect((block.match(/\.update\(radiologyWorklistTable\)/g) ?? []).length).toBe(1);
  });

  it("a uid owned by another worklist row is a conflict, not a 500", () => {
    expect(block).toContain("isWorklistUidRaceViolation(err, uid)");
    expect(block).toContain(`reason: "uid-owned-by-another-worklist-row"`);
  });

  it("only a resolved decision reaches the write; every other status returns early", () => {
    expect(block).toContain('if (decision.status !== "resolved" || !decision.studyInstanceUID || !decision.provenance)');
  });

  it("the resolver never searches Orthanc by patient name", () => {
    expect(block).not.toContain("patientName:");
    expect(block).not.toContain("dateExact");
  });

  it("no response shape hands back a uid without saying it is resolved", () => {
    for (const m of block.matchAll(/status: "(\w+)"/g)) {
      if (m[1] === "resolved") continue;
      const chunk = block.slice(m.index ?? 0, (m.index ?? 0) + 300);
      expect(chunk).toContain("studyInstanceUID: null");
    }
  });
});

describe("purge scrub nulls provenance with the UID", () => {
  const src = readFileSync(resolve(__dirname, "./orthancPurge.ts"), "utf8");
  const start = src.indexOf("studyInstanceUID: null,");
  const block = src.slice(start, start + 700);

  it("both go null", () => {
    expect(block).toContain("studyInstanceUID: null,");
    expect(block).toContain("studyUidProvenance: null,");
  });

  it("provenance is nulled before the UID line could be deleted alone", () => {
    expect(block.indexOf("studyUidProvenance: null,")).toBeLessThan(block.indexOf("weasisUrl: null,"));
  });
});

describe("intake stamps the strongest provenance", () => {
  const src = readFileSync(resolve(__dirname, "../../routes/internal-radiology.ts"), "utf8");

  it("a pushed study records PACS_INTAKE, and carries no provenance without a UID", () => {
    expect(src).toContain("studyUidProvenance: studyInstanceUID ? STUDY_UID_PROVENANCE.pacsIntake : null,");
  });

  it("it is set inside the same values object as studyInstanceUID", () => {
    // Bounded on the object literal's own markers, not a character window: the
    // explanatory comment between the two keys is longer than any fixed slice.
    const start = src.indexOf("const values = {");
    expect(start, "intake values object not found").toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("};", start));
    expect(block).toContain("studyInstanceUID,");
    expect(block).toContain("studyUidProvenance: studyInstanceUID ? STUDY_UID_PROVENANCE.pacsIntake : null,");
  });
});

describe("D1-11 the viewer will not launch on anything it did not see resolved", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../diagnostic-erp/src/components/EmbeddedWadoViewer.tsx"),
    "utf8",
  );

  it("the launch uid is gated on status === 'resolved'", () => {
    expect(src).toContain(`resolved?.status === "resolved"`);
    expect(src).toMatch(/const boundUid =[\s\S]{0,200}resolved\?\.status === "resolved"/);
  });

  it("the old unconditional trust of the response body is gone", () => {
    expect(src).not.toContain("const effectiveUid = initialUid || (resolved?.studyInstanceUID");
  });

  it("ambiguous and conflict each get their own visible message", () => {
    expect(src).toContain(`resolved?.status === "ambiguous"`);
    expect(src).toContain(`resolved?.status === "conflict"`);
    expect(src).toContain(`resolved?.reason === "no-strong-identifier"`);
  });

  it("the unresolved panel is still the component that renders when there is no uid", () => {
    expect(src).toContain("<p>No StudyInstanceUID available for this worklist entry.</p>");
  });
});

describe("D1-12 provenance survives the API round trip", () => {
  it("the detail field selection includes it", () => {
    const src = readFileSync(resolve(__dirname, "../pacsWorklistDetailFields.ts"), "utf8");
    expect(src).toContain("studyUidProvenance: radiologyWorklistTable.studyUidProvenance,");
  });

  it("the column exists on the table, nullable and without a default", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../lib/db/src/schema/radiologyWorklist.ts"),
      "utf8",
    );
    expect(src).toContain('studyUidProvenance: text("study_uid_provenance"),');
    // Anchored on the drizzle call shape, not on the SQL name: a pattern like
    // `study_uid_provenance[^)]*\.notNull\(\)` cannot cross the closing paren of
    // text(), so it can never fire even when the column is made NOT NULL.
    expect(src).not.toMatch(/studyUidProvenance:\s*text\([^)]*\)\.notNull/);
    expect(src).not.toMatch(/studyUidProvenance:\s*text\([^)]*\)\.default/);
  });

  it("the startup safety net is additive only", () => {
    const src = readFileSync(resolve(__dirname, "../../index.ts"), "utf8");
    expect(src).toContain(
      "ALTER TABLE radiology_worklist ADD COLUMN IF NOT EXISTS study_uid_provenance TEXT;",
    );
    expect(src).not.toMatch(/ALTER TABLE radiology_worklist (DROP|ALTER) COLUMN study_uid_provenance/);
  });
});
