import { describe, expect, it } from "vitest";
import {
  pickTokenCandidateByDicomName,
  type QueueTokenCandidate,
} from "./dicomIntakeQueueMatch";

function candidate(
  overrides: Partial<QueueTokenCandidate> & Pick<QueueTokenCandidate, "id" | "tokenNo">,
): QueueTokenCandidate {
  return {
    status: "waiting",
    ledgerId: 1,
    department: "USG",
    patientFirstName: "Abinash",
    patientLastName: "Singh",
    ...overrides,
  };
}

describe("pickTokenCandidateByDicomName", () => {
  it("matches DICOM LAST^FIRST to ERP First Last", () => {
    const picked = pickTokenCandidateByDicomName("SINGH^ABINASH", [
      candidate({ id: 1, tokenNo: 12 }),
    ]);
    expect(picked?.id).toBe(1);
  });

  it("prefers serving over waiting when multiple names match", () => {
    const picked = pickTokenCandidateByDicomName("SINGH^ABINASH", [
      candidate({ id: 1, tokenNo: 5, status: "waiting" }),
      candidate({ id: 2, tokenNo: 8, status: "serving" }),
    ]);
    expect(picked?.id).toBe(2);
  });

  it("does not match unrelated patients", () => {
    const picked = pickTokenCandidateByDicomName("SHARMA^PRIYA", [
      candidate({ id: 1, tokenNo: 3, patientFirstName: "Abinash", patientLastName: "Singh" }),
    ]);
    expect(picked).toBeUndefined();
  });
});
