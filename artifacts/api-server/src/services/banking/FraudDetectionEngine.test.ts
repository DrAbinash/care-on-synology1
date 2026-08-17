import { describe, expect, it } from "vitest";
import {
  CLINIC_TIME_ZONE,
  hourInTimeZone,
  isUnusualPaymentHour,
} from "./FraudDetectionEngine";

describe("FraudDetectionEngine timing helpers", () => {
  it("maps UTC evening to Kolkata late-night correctly", () => {
    // 2026-08-17 17:30 UTC = 23:00 IST → unusual
    const late = new Date("2026-08-17T17:30:00.000Z");
    expect(hourInTimeZone(late, CLINIC_TIME_ZONE)).toBe(23);
    expect(isUnusualPaymentHour(late)).toBe(true);

    // 2026-08-17 04:30 UTC = 10:00 IST → normal business hours
    const morning = new Date("2026-08-17T04:30:00.000Z");
    expect(hourInTimeZone(morning, CLINIC_TIME_ZONE)).toBe(10);
    expect(isUnusualPaymentHour(morning)).toBe(false);
  });

  it("treats 22:00–04:59 clinic-local as unusual", () => {
    expect(isUnusualPaymentHour(new Date("2026-08-17T16:30:00.000Z"))).toBe(true); // 22:00 IST
    expect(isUnusualPaymentHour(new Date("2026-08-17T23:29:00.000Z"))).toBe(true); // 04:59 IST
    expect(isUnusualPaymentHour(new Date("2026-08-17T23:30:00.000Z"))).toBe(false); // 05:00 IST
  });
});

describe("FraudDetectionEngine rule intent (regression guards)", () => {
  it("exports CLINIC_TIME_ZONE Asia/Kolkata (not server local)", () => {
    expect(CLINIC_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it("source no longer treats bill age alone as backdated fraud", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./FraudDetectionEngine.ts", import.meta.url), "utf8"),
    );
    // Old bug: createdAt < now-30d flagged legitimate historic bills.
    expect(src).not.toMatch(/more than 30 days ago\. Possible backdated entry/);
    expect(src).toMatch(/Future-dated bill/);
    // Old bug: updatedAt > paymentTime fired on QR/PDF counter bumps.
    expect(src).not.toMatch(/billUpdated > paymentTime/);
    expect(src).toMatch(/total below collections/);
  });
});
