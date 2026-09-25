/**
 * Unit tests — WhatsApp Delivery v2 pure lib.
 */
import { describe, expect, it } from "vitest";
import {
  assertPhiMinimalMessage,
  buildWaLink,
  deliveryMessage,
  maskPhoneForAudit,
  normalizePhoneForWa,
  parseStationChoice,
  resolveDeliveryChannel,
  resolveDeliveryTargets,
} from "./whatsappDelivery";

describe("normalizePhoneForWa", () => {
  it("handles 0xxx / 10-digit / 91xxx / +91 / garbage", () => {
    expect(normalizePhoneForWa("09876543210")).toBe("919876543210");
    expect(normalizePhoneForWa("9876543210")).toBe("919876543210");
    expect(normalizePhoneForWa("919876543210")).toBe("919876543210");
    expect(normalizePhoneForWa("+91 98765-43210")).toBe("919876543210");
    expect(normalizePhoneForWa("")).toBeNull();
    expect(normalizePhoneForWa("abc")).toBeNull();
    expect(normalizePhoneForWa("0000000000")).toBeNull();
    expect(normalizePhoneForWa(null)).toBeNull();
  });
});

describe("buildWaLink", () => {
  it("builds wa.me deep link with encoded text", () => {
    const link = buildWaLink("9876543210", "Hello from Care");
    expect(link).toBe("https://wa.me/919876543210?text=Hello%20from%20Care");
  });

  it("returns null for bad phone", () => {
    expect(buildWaLink("bad", "x")).toBeNull();
  });
});

describe("resolveDeliveryTargets — routing matrix", () => {
  const cases: Array<{
    routing: "patient_only" | "patient_and_doctor" | "doctor_only";
    patient?: string | null;
    doctor?: string | null;
    expectKinds: string[];
  }> = [
    { routing: "patient_only", patient: "9876543210", doctor: "9123456780", expectKinds: ["patient"] },
    { routing: "patient_only", patient: null, doctor: "9123456780", expectKinds: ["missing"] },
    { routing: "doctor_only", patient: "9876543210", doctor: "9123456780", expectKinds: ["doctor"] },
    { routing: "doctor_only", patient: "9876543210", doctor: null, expectKinds: ["missing"] },
    {
      routing: "patient_and_doctor",
      patient: "9876543210",
      doctor: "9123456780",
      expectKinds: ["patient", "doctor"],
    },
    {
      routing: "patient_and_doctor",
      patient: null,
      doctor: "9123456780",
      expectKinds: ["missing", "doctor"],
    },
    {
      routing: "patient_and_doctor",
      patient: "9876543210",
      doctor: null,
      expectKinds: ["patient", "missing"],
    },
    {
      routing: "patient_and_doctor",
      patient: null,
      doctor: null,
      expectKinds: ["missing", "missing"],
    },
  ];

  for (const c of cases) {
    it(`${c.routing} patient=${c.patient ?? "∅"} doctor=${c.doctor ?? "∅"}`, () => {
      const targets = resolveDeliveryTargets({
        routing: c.routing,
        patientPhone: c.patient,
        doctorPhone: c.doctor,
      });
      expect(targets.map((t) => t.kind)).toEqual(c.expectKinds);
    });
  }
});

describe("deliveryMessage — PHI rule", () => {
  it("report/bill carry only clinic + link + expiry (no diagnosis/amounts)", () => {
    const report = deliveryMessage("report", {
      clinicName: "Care Diagnostics",
      tokenUrl: "https://care.example/share/report/tok",
      expiryDays: 7,
    });
    const bill = deliveryMessage("bill", {
      clinicName: "Care Diagnostics",
      tokenUrl: "https://care.example/share/bill/tok",
      expiryDays: 7,
    });
    expect(report).toContain("Care Diagnostics");
    expect(report).toContain("share/report/tok");
    expect(report).toContain("7 days");
    expect(assertPhiMinimalMessage("report", report).ok).toBe(true);
    expect(assertPhiMinimalMessage("bill", bill).ok).toBe(true);
    // Explicitly no clinical / money strings
    for (const bad of ["herniation", "₹1200", "diagnosis", "paid", "balance"]) {
      expect(report.toLowerCase()).not.toContain(bad.toLowerCase());
      expect(bill.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });

  it("booking carries name + slot + ref, never clinical", () => {
    const msg = deliveryMessage("booking", {
      clinicName: "Care Diagnostics",
      patientName: "Ravi Kumar",
      slotLabel: "26 Sept 10:00 AM USG",
      bookingRef: "OB-1001",
    });
    expect(msg).toContain("Ravi Kumar");
    expect(msg).toContain("OB-1001");
    expect(msg).toContain("Care Diagnostics");
    expect(assertPhiMinimalMessage("booking", msg).ok).toBe(true);
    expect(msg.toLowerCase()).not.toContain("diagnosis");
    expect(msg.toLowerCase()).not.toContain("impression");
  });
});

describe("channel stub + audit mask + station memory", () => {
  it("Lane 1 channel is wa-me; cloud stub notConfigured", () => {
    expect(resolveDeliveryChannel()).toEqual({ kind: "wa-me" });
    expect(resolveDeliveryChannel({ cloudConfigured: true })).toEqual({
      kind: "cloud-api",
      notConfigured: true,
    });
  });

  it("masks phone to last 4", () => {
    expect(maskPhoneForAudit("9876543210")).toBe("****3210");
  });

  it("parses station choice JSON", () => {
    expect(parseStationChoice('{"routing":"doctor_only"}')?.routing).toBe("doctor_only");
    expect(parseStationChoice("nope")).toBeNull();
  });
});
