/**
 * R1 — the intake cascade must not hand one patient's billed study to another
 * patient's incoming DICOM study.
 *
 * The decision is pure (intakeIdentityGuard.ts) so every case here runs without
 * Postgres. The last group is a source contract: the guard has to sit BEFORE
 * the write, because a guard that runs after `db.update(radiologyStudiesTable)`
 * would refuse the link while the wrong-patient row is already committed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessIntakeIdentity } from "./intakeIdentityGuard";

describe("assessIntakeIdentity", () => {
  it("refuses a reused accession that resolves to a different patient", () => {
    // Patient A's billed study (id 12), patient B's incoming study (id 77).
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: null },
      { resolvedPatientId: 77, studyInstanceUID: "1.2.840.999" },
    );
    expect(verdict).toEqual({ matched: false, reason: "patient-id-conflicts" });
  });

  it("refuses a different StudyInstanceUID already recorded on the row", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: "1.2.840.111" },
      { resolvedPatientId: 12, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: false, reason: "study-uid-conflicts" });
  });

  it("patient conflict outranks uid conflict — the person is the worse error", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: "1.2.840.111" },
      { resolvedPatientId: 77, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: false, reason: "patient-id-conflicts" });
  });

  it("binds a uid onto a billed study that has none yet — the normal booked-then-imaged path", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: null },
      { resolvedPatientId: 12, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("links an incoming patient onto a billed study registered without one", () => {
    // Register-first is the clinic's normal order: the accession is booked, the
    // patient row is chosen later. Refusing this would block every such study.
    const verdict = assessIntakeIdentity(
      { patientId: null, studyInstanceUid: null },
      { resolvedPatientId: 77, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("accepts agreement on both facts", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: "1.2.840.222" },
      { resolvedPatientId: 12, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("treats a re-intake of the same study as compatible, not a repeat conflict", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: " 1.2.840.222 " },
      { resolvedPatientId: 12, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("compares a stringified fk against a numeric one", () => {
    // Drizzle returns integer() as number, but the cascade also feeds rows built
    // elsewhere; "12" vs 12 must not read as two different patients.
    const verdict = assessIntakeIdentity(
      { patientId: "12", studyInstanceUid: null },
      { resolvedPatientId: 12, studyInstanceUID: null },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("ignores blank strings rather than reading them as a recorded identity", () => {
    const verdict = assessIntakeIdentity(
      { patientId: "", studyInstanceUid: "" },
      { resolvedPatientId: 77, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("leaves an unmatched incoming patient free to link — absence is not conflict", () => {
    const verdict = assessIntakeIdentity(
      { patientId: 12, studyInstanceUid: null },
      { resolvedPatientId: null, studyInstanceUID: "1.2.840.222" },
    );
    expect(verdict).toEqual({ matched: true });
  });

  it("passes a candidate the cascade never found", () => {
    expect(assessIntakeIdentity(null, { resolvedPatientId: 77 })).toEqual({ matched: true });
  });
});

describe("intake route wiring (source contract)", () => {
  const src = () =>
    readFileSync(resolve(__dirname, "../../routes/internal-radiology.ts"), "utf8");

  it("assesses identity before the billed-study write", () => {
    const text = src();
    const guardAt = text.indexOf("assessIntakeIdentity(");
    // Two routes in this file update radiology_studies; the one that matters is
    // the intake write, which is the first of them.
    const writeAt = text.indexOf(".update(radiologyStudiesTable)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(writeAt);
  });

  it("a refused match clears the picked study, so nothing downstream writes onto it", () => {
    const text = src();
    const guardAt = text.indexOf("assessIntakeIdentity(");
    const writeAt = text.indexOf(".update(radiologyStudiesTable)");
    const between = text.slice(guardAt, writeAt);
    expect(between).toContain("rStudy = undefined");
    // resolvedStudyId and the billed-study update are both derived from / gated
    // on rStudy, so clearing it is what actually stops the write.
    expect(between).toContain("let resolvedStudyId: number | null = rStudy ? rStudy.id : null;");
  });

  it("the accession tier stops guessing between equal-accession rows", () => {
    // This tier used to `.limit(1)` on a key the same file documents as not
    // unique. Two rows sharing a bogus accession must not merge.
    const text = src();
    const tier = text.slice(
      text.indexOf("// 2. Matched by accessionNumber"),
      text.indexOf("// 3. Matched by StudyInstanceUID"),
    );
    expect(tier).toContain("pickUniqueRow");
    expect(tier).not.toContain(".limit(1)");
  });
});
