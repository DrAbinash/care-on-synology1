import { describe, expect, it } from "vitest";
import { shouldOpenFormFFinalizeStep } from "@/lib/pcpndtFinalizeGate";
import { isObstetricUsgStudy } from "@/lib/usgModality";

describe("shouldOpenFormFFinalizeStep", () => {
  it("non-OB USG: no Form F step", () => {
    expect(shouldOpenFormFFinalizeStep({
      isObstetricUsg: isObstetricUsgStudy("US", "Abdomen ultrasound"),
      compliance: { compliant: false },
    })).toBe(false);
  });

  it("eligible OB USG + complete Form F: no step", () => {
    expect(shouldOpenFormFFinalizeStep({
      isObstetricUsg: isObstetricUsgStudy("USG", "Obstetric anomaly scan"),
      compliance: { compliant: true },
    })).toBe(false);
  });

  it("eligible OB USG + incomplete Form F: open step", () => {
    expect(shouldOpenFormFFinalizeStep({
      isObstetricUsg: isObstetricUsgStudy("US", "Fetal growth scan"),
      compliance: { compliant: false },
    })).toBe(true);
  });

  it("eligible OB USG + compliance still loading: open step (fail-closed)", () => {
    expect(shouldOpenFormFFinalizeStep({
      isObstetricUsg: true,
      compliance: undefined,
    })).toBe(true);
  });
});
