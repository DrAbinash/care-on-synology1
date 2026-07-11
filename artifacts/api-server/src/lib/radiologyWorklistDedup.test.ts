import { describe, it, expect } from "vitest";
import {
  shouldFallbackToAccessionLookup,
  isWorklistUidRaceViolation,
} from "./radiologyWorklistDedup";

// Regression coverage for the incident where POST /api/internal/radiology/studies
// returned 500 with "duplicate key value violates unique constraint
// radiology_worklist_accession_uq" because accession_number (external,
// frequently bad DICOM data — e.g. a referring doctor's name pushed instead
// of a real accession) was enforced as NOT NULL + globally UNIQUE.
//
// Fix summary:
//  - accession_number is now nullable and NOT unique (radiology_worklist_accession_uq
//    dropped, replaced with a plain lookup index).
//  - study_instance_uid is the true unique identifier (radiology_worklist_uid_uq,
//    a partial unique index excluding NULLs).
//  - accession-number-based dedup lookup only runs when the incoming study has
//    no studyInstanceUID at all, so two different studies sharing a bad
//    accession never get merged into one worklist row.
//  - INSERT races on studyInstanceUID are retried as an UPDATE instead of
//    surfacing a 500.

describe("shouldFallbackToAccessionLookup", () => {
  it("does NOT fall back to accession lookup when a studyInstanceUID is present", () => {
    // This is the core fix: a new study with a real UID must never be
    // matched/merged against an old row just because they share a bad,
    // duplicate accession number.
    expect(shouldFallbackToAccessionLookup("1.2.3.4.5", "DR.A.K.SINGH MCH")).toBe(false);
    expect(shouldFallbackToAccessionLookup("1.2.3.4.5", null)).toBe(false);
  });

  it("falls back to accession lookup only for legacy studies with no UID at all", () => {
    expect(shouldFallbackToAccessionLookup(null, "ACC-20260707-001")).toBe(true);
  });

  it("does nothing when neither identifier is present", () => {
    expect(shouldFallbackToAccessionLookup(null, null)).toBe(false);
    expect(shouldFallbackToAccessionLookup(null, "")).toBe(false);
  });
});

describe("isWorklistUidRaceViolation", () => {
  const uid = "1.2.840.10008.5.1.4.1.1.7";

  it("recognizes a 23505 unique violation on the studyInstanceUID index by constraint name", () => {
    const err = { code: "23505", constraint: "radiology_worklist_uid_uq" };
    expect(isWorklistUidRaceViolation(err, uid)).toBe(true);
  });

  it("recognizes a 23505 unique violation by detail message when constraint name is absent", () => {
    const err = { code: "23505", detail: "Key (study_instance_uid)=(1.2.840...) already exists." };
    expect(isWorklistUidRaceViolation(err, uid)).toBe(true);
  });

  it("does not treat an unrelated unique violation as a UID race", () => {
    const err = { code: "23505", constraint: "some_other_constraint", detail: "Key (id)=(5) already exists." };
    expect(isWorklistUidRaceViolation(err, uid)).toBe(false);
  });

  it("does not treat non-unique-violation errors as a race", () => {
    const err = { code: "23502", constraint: "radiology_worklist_uid_uq" };
    expect(isWorklistUidRaceViolation(err, uid)).toBe(false);
  });

  it("never matches when there was no studyInstanceUID on the incoming request", () => {
    const err = { code: "23505", constraint: "radiology_worklist_uid_uq" };
    expect(isWorklistUidRaceViolation(err, null)).toBe(false);
  });

  it("handles null/undefined errors safely", () => {
    expect(isWorklistUidRaceViolation(null, uid)).toBe(false);
    expect(isWorklistUidRaceViolation(undefined, uid)).toBe(false);
  });
});
