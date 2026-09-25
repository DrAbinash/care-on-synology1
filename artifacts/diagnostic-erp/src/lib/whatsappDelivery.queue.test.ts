/**
 * Queue lifecycle + PHI + routing coverage (API-side pure helpers + lib re-export).
 * Full DB lifecycle is covered when DATABASE_URL is set; this file stays unit-only.
 */
import { describe, expect, it } from "vitest";
import {
  assertPhiMinimalMessage,
  buildWaLink,
  deliveryMessage,
  maskPhoneForAudit,
  resolveDeliveryTargets,
} from "../lib/whatsappDelivery";

describe("queue lifecycle message + link", () => {
  it("create→send payload builds wa.me and audit mask", () => {
    const msg = deliveryMessage("booking", {
      clinicName: "Care Diagnostics",
      patientName: "Anita",
      slotLabel: "26 Sept 10:00 AM",
      bookingRef: "OB-42",
    });
    const link = buildWaLink("9876543210", msg);
    expect(link).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(maskPhoneForAudit("9876543210")).toBe("****3210");
    expect(assertPhiMinimalMessage("booking", msg).ok).toBe(true);
  });
});

describe("routing matrix smoke", () => {
  it("patient_and_doctor marks missing phones", () => {
    const t = resolveDeliveryTargets({
      routing: "patient_and_doctor",
      patientPhone: null,
      doctorPhone: "9123456780",
    });
    expect(t.map((x) => x.kind)).toEqual(["missing", "doctor"]);
  });
});
