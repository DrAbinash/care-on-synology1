import { describe, expect, it } from "vitest";
import {
  MIN_EMERGENCY_VOID_REASON_LEN,
  normalizeEmergencyActorName,
  normalizeEmergencyVoidReason,
} from "./emergencyAdminOps";

describe("normalizeEmergencyVoidReason", () => {
  it("rejects empty / too-short reasons", () => {
    expect(normalizeEmergencyVoidReason("")).toBeNull();
    expect(normalizeEmergencyVoidReason("ab")).toBeNull();
    expect(normalizeEmergencyVoidReason("  x  ")).toBeNull();
    expect(normalizeEmergencyVoidReason(null)).toBeNull();
  });

  it("accepts trimmed reasons at the minimum length", () => {
    expect(normalizeEmergencyVoidReason("abc")).toBe("abc");
    expect(normalizeEmergencyVoidReason("  Test bill — discard  ")).toBe("Test bill — discard");
    expect(MIN_EMERGENCY_VOID_REASON_LEN).toBe(3);
  });
});

describe("normalizeEmergencyActorName", () => {
  it("falls back when blank", () => {
    expect(normalizeEmergencyActorName("")).toBe("CARE admin");
    expect(normalizeEmergencyActorName("  Dr Admin  ")).toBe("Dr Admin");
  });
});
