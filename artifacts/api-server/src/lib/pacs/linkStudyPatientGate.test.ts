/**
 * Behaviour pins for the link-study identity gate (PR #1170, leg 1).
 *
 * POST /api/radiology/pacs-worklist/:id/link-study used to accept ANY studyId:
 * it copied radiology_studies.patient_id onto the worklist row with no
 * identity check at all — the one door into "patient A's PACS study becomes
 * patient B's" with neither a refusal nor a record of why. The auto-link path
 * already refuses cross-patient writes under an APPROVED decision, and the
 * match-decision route requires a reason; this gate gives the MANUAL door the
 * same spine, with one addition the owner mandated: an explicit, reason-
 * carrying, audited override for the legitimate patient-correction workflow
 * (a worklist row registered under the wrong patient, corrected by linking
 * the study that carries the right one).
 *
 * Pure module — no db, no express. The route wiring is pinned separately in
 * routes/linkStudyPatientGuard.contract.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateLinkStudyPatientGate,
  LINK_PATIENT_MISMATCH,
  LINK_PATIENT_UNPROVABLE,
} from "./linkStudyPatientGate";

describe("linkStudyPatientGate — the manual link's identity decision", () => {
  it("1. an intake row with no patient yet takes any study (the unbilled-scan assignment)", () => {
    // The legitimate primary workflow: a PACS study arrived, the bill was
    // found, the link assigns the patient. Nothing is contradicted.
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: null, studyPatientId: 77 });
    expect(out.decision).toBe("link");
    expect(out).not.toHaveProperty("overridden", true);
  });

  it("2. the same patient links silently — no override, no reason needed", () => {
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: 12, studyPatientId: 12 });
    expect(out.decision).toBe("link");
    expect(out).not.toHaveProperty("overridden", true);
  });

  it("3. a provably different patient is refused with the mismatch code", () => {
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: 12, studyPatientId: 13 });
    expect(out.decision).toBe("refuse");
    if (out.decision === "refuse") {
      expect(out.code).toBe(LINK_PATIENT_MISMATCH);
      expect(out.message).toContain("different patient");
    }
  });

  it("4. the refusal names the door out loud: the override reason", () => {
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: 12, studyPatientId: 13 });
    if (out.decision === "refuse") {
      // No dead-end promise: the message offers the real authorized path.
      expect(out.message).toContain("overrideReason");
    }
  });

  it("5. the refusal says what the write would have done — moved the row to another patient", () => {
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: 12, studyPatientId: 13 });
    if (out.decision === "refuse") {
      expect(out.message).toMatch(/worklist/i);
    }
  });

  it("6. an explicit reason of real length authorizes the cross-patient link", () => {
    const out = evaluateLinkStudyPatientGate({
      worklistPatientId: 12,
      studyPatientId: 13,
      overrideReason: "  Registration error: row booked under wrong patient, verified on Form F  ",
    });
    expect(out.decision).toBe("link");
    if (out.decision === "link") {
      expect(out.overridden).toBe(true);
      if (out.overridden) {
        // Trimmed — what the audit row stores is the sentence, not the padding.
        expect(out.overrideReason).toBe("Registration error: row booked under wrong patient, verified on Form F");
      }
    }
  });

  it("7. a token reason (under 3 chars after trim) does not authorize anything", () => {
    const out = evaluateLinkStudyPatientGate({
      worklistPatientId: 12,
      studyPatientId: 13,
      overrideReason: "  ab  ",
    });
    expect(out.decision).toBe("refuse");
  });

  it("8. a non-string reason (true, numbers, objects) is not an override", () => {
    for (const bad of [true, 1, { reason: "ok" }, ["ok"]]) {
      const out = evaluateLinkStudyPatientGate({
        worklistPatientId: 12,
        studyPatientId: 13,
        overrideReason: bad,
      });
      expect(out.decision).toBe("refuse");
    }
  });

  it("9. a study with no recorded patient is unprovable, not equal — refused without a reason", () => {
    // Absence of a mismatch is not a match (ADR-005 doctrine). The write would
    // also null the worklist row's patient, so it must never be silent.
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: 12, studyPatientId: null });
    expect(out.decision).toBe("refuse");
    if (out.decision === "refuse") {
      expect(out.code).toBe(LINK_PATIENT_UNPROVABLE);
      expect(out.message).toContain("cannot confirm");
    }
  });

  it("10. the unprovable case opens with the same authorized override door", () => {
    const out = evaluateLinkStudyPatientGate({
      worklistPatientId: 12,
      studyPatientId: null,
      overrideReason: "Legacy study row has no patient; bill desk verified identity in person",
    });
    expect(out.decision).toBe("link");
    if (out.decision === "link") expect(out.overridden).toBe(true);
  });

  it("11. an intake row with no patient takes a study with no patient too (pure assignment)", () => {
    const out = evaluateLinkStudyPatientGate({ worklistPatientId: null, studyPatientId: null });
    expect(out.decision).toBe("link");
    expect(out).not.toHaveProperty("overridden", true);
  });

  it("12. a stray reason on a SAME-patient link is not recorded as an override", () => {
    // The audit trail must mean something: MANUAL_LINK_OVERRIDE rows are only
    // written when the link actually crossed (or could not disprove) a patient
    // boundary. A same-patient link with a reason string is just a link.
    const out = evaluateLinkStudyPatientGate({
      worklistPatientId: 12,
      studyPatientId: 12,
      overrideReason: "just in case",
    });
    expect(out.decision).toBe("link");
    expect(out).not.toHaveProperty("overridden", true);
  });
});

