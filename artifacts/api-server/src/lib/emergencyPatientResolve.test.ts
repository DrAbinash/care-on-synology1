import { describe, expect, it } from "vitest";
import {
  applyManualPatientResolution,
  classifyPatientMatch,
  isSafeToAutoImport,
  PatientResolutionError,
} from "@workspace/emergency-billing";

describe("emergency patient resolve contract", () => {
  const a = { carePatientId: 10, uhid: "P-00010", firstName: "Ravi", lastName: "Kumar", phone: "9876543210", sex: "M" };
  const b = { carePatientId: 11, uhid: "P-00011", firstName: "Abinash", lastName: "Kumar", phone: "9876543210", sex: "M" };

  it("keeps unresolved same-phone rows blocked", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [a, b]);
    expect(d.matchClass).toBe("CONFLICT");
    expect(isSafeToAutoImport(d.matchClass, false, false)).toBe(false);
  });

  it("select existing must be a matcher candidate", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [a, b]);
    const resolved = applyManualPatientResolution(d, { action: "select_existing", carePatientId: 11 });
    expect(resolved.matchClass).toBe("EXACT_MATCH");
    expect(isSafeToAutoImport(resolved.matchClass, false, false)).toBe(true);
    expect(() => applyManualPatientResolution(d, { action: "select_existing", carePatientId: 77 })).toThrow(PatientResolutionError);
  });

  it("create-new is safe without merging candidates", () => {
    const d = classifyPatientMatch({
      carePatientId: null, uhid: null, firstName: "abinash", lastName: "kumar", mobile: "9876543210", sex: "M",
    }, [a, b]);
    const resolved = applyManualPatientResolution(d, { action: "create_new", carePatientId: 50 });
    expect(resolved.matchClass).toBe("NEW_PATIENT");
    expect(isSafeToAutoImport(resolved.matchClass, false, false)).toBe(true);
  });

  it("imported rows cannot be re-resolved", () => {
    const d = classifyPatientMatch({
      carePatientId: 10, uhid: "P-00010", firstName: "Ravi", lastName: "Kumar", mobile: "9876543210", sex: "M",
    }, [a]);
    expect(() => applyManualPatientResolution(d, { action: "select_existing", carePatientId: 10 }, { alreadyImported: true }))
      .toThrow(/read-only/);
  });
});
