/**
 * resolvePatientIdentifiers.test.ts — proves the check cannot become vacuous.
 *
 * The failure this guards against is quiet and total: an empty identifier list
 * means the burned-in matcher has nothing to look for, so every image is
 * reported clean and leaves the clinic. Every test here is therefore about what
 * happens when the patient IS NOT known — it must be a refusal, never an
 * allow-list of nothing.
 *
 * No database: the query layer is mocked at the shape the module uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  patient: null as null | Record<string, unknown>,
  worklist: null as null | { accessionNumber: string | null },
}));

const TABLES = vi.hoisted(() => ({
  patients: { __table: "patients" },
  worklist: { __table: "radiology_worklist" },
}));

vi.mock("@workspace/db", () => ({
  patientsTable: TABLES.patients,
  radiologyWorklistTable: TABLES.worklist,
  eq: (col: unknown, value: unknown) => ({ __col: col, value }),
  and: (...p: unknown[]) => p.flat(),
  db: {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async () => {
            if (table?.__table === "patients") return state.patient ? [state.patient] : [];
            if (table?.__table === "radiology_worklist") {
              return state.worklist ? [state.worklist] : [];
            }
            return [];
          },
        }),
      }),
    }),
  },
}));

import {
  identifiersFromPatientRow,
  resolvePatientIdentifiersForEgress,
} from "./resolvePatientIdentifiers";

const PATIENT = {
  firstName: "Abhinash",
  lastName: "Singh",
  dateOfBirth: "1980-04-12",
  patientId: "MRN-44771",
  phone: "9812345678",
};

beforeEach(() => {
  state.patient = null;
  state.worklist = null;
});

describe("an unknown patient must never become an empty allow-list", () => {
  it("a study with no linked patient refuses", async () => {
    state.patient = PATIENT;
    const r = await resolvePatientIdentifiersForEgress({ patientId: null, worklistId: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not linked to a patient record");
    // Proved against the vacuous-pass shape specifically: no identifiers at all.
    if (r.ok) throw new Error("must not resolve identifiers for an unlinked study");
  });

  it("a patient id that no longer has a row refuses rather than proceeding", async () => {
    state.patient = null;
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("could not be read");
  });

  it("a patient with no name, no DOB and no number refuses", async () => {
    // The realistic shape of a half-entered registration row.
    state.patient = {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      patientId: "",
      phone: null,
    };
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no name, date of birth or identifier");
  });

  it("never returns an identifier set with nothing in it", async () => {
    // The invariant, stated directly: if this resolves, there IS something to
    // forbid. Without it the gate below would be decoration.
    const cases = [
      { patientId: null, worklistId: null },
      { patientId: 1, worklistId: null },
      { patientId: 42, worklistId: 7 },
    ];
    for (const c of cases) {
      state.patient = c.patientId === 1 ? null : PATIENT;
      const r = await resolvePatientIdentifiersForEgress(c);
      if (r.ok) {
        const i = r.identifiers;
        expect(i.patientName || i.dateOfBirth || i.mrn || i.accessionNumber).toBeTruthy();
      }
    }
  });
});

describe("a known patient forbids every form an overlay might print", () => {
  it("resolves full name, given name, surname, DOB and MRN", async () => {
    state.patient = PATIENT;
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identifiers.patientName).toBe("Abhinash Singh");
      expect(r.identifiers.firstName).toBe("Abhinash");
      expect(r.identifiers.lastName).toBe("Singh");
      expect(r.identifiers.dateOfBirth).toBe("1980-04-12");
      expect(r.identifiers.mrn).toBe("MRN-44771");
    }
  });

  it("takes the accession from the worklist, because that is what PACS prints", async () => {
    state.patient = PATIENT;
    state.worklist = { accessionNumber: "ACC-2026-0091" };
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: 9 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identifiers.accessionNumber).toBe("ACC-2026-0091");
  });

  it("a missing accession does not invalidate the rest of the identity", async () => {
    state.patient = PATIENT;
    state.worklist = { accessionNumber: "   " };
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: 9 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identifiers.accessionNumber).toBeFalsy();
  });

  it("adds the initialised form and the phone to the forbidden terms", () => {
    const i = identifiersFromPatientRow(PATIENT);
    expect(i.extraForbiddenTerms).toContain("A. Singh");
    expect(i.extraForbiddenTerms).toContain("9812345678");
  });

  it("does not invent a surname-only initial form for a one-word name", () => {
    const i = identifiersFromPatientRow({
      firstName: "",
      lastName: "Unknown",
      dateOfBirth: "1990-01-01",
      patientId: "X1",
      phone: null,
    });
    expect(i.patientName).toBe("Unknown");
    expect(i.firstName).toBeNull();
    expect(i.extraForbiddenTerms ?? []).toEqual([]);
  });

  it("treats a null phone as absent rather than the string null", () => {
    const i = identifiersFromPatientRow({ ...PATIENT, phone: null });
    const terms = i.extraForbiddenTerms ?? [];
    expect(terms).not.toContain("null");
    expect(terms.every((t) => t.length >= 3)).toBe(true);
  });

  it("reports where the identity came from, for the audit row", async () => {
    state.patient = PATIENT;
    const r = await resolvePatientIdentifiersForEgress({ patientId: 42, worklistId: null });
    expect(r.ok && r.resolvedFrom).toBe("patient_row");
  });
});
