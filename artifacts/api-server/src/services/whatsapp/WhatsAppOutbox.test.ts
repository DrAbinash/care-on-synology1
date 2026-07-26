// Outbox + safety-control unit tests, covering the deterministic logic
// enqueueWhatsAppMessage()/dispatchPendingWaOutbox() are built on: idempotency
// keys, retry backoff, dead-letter thresholds, phone normalization, allowlist
// parsing, and quiet hours. These are pure functions exported specifically for
// testability (see WhatsAppOutbox.ts) — the DB-touching orchestration around
// them (the actual enqueue/dispatch functions) requires a live Postgres and is
// exercised by DEPLOYMENT.md's smoke test / manual verification instead, the
// same boundary services/integration/outbox.test.ts draws for its own
// dispatcher. DATABASE_URL is set to a dummy value purely so this file's
// module-level `import { db } from "@workspace/db"` doesn't throw at import
// time — none of the functions under test perform any I/O.
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_whatsapp";

let mod: typeof import("./WhatsAppOutbox");
beforeAll(async () => { mod = await import("./WhatsAppOutbox"); });

describe("normalizePhone", () => {
  it("prefixes the country code onto a bare local number", async () => {
    expect(mod.normalizePhone("9876543210", "91")).toBe("919876543210");
  });

  it("leaves an already-E.164-length number untouched (no double-prefixing)", () => {
    expect(mod.normalizePhone("919876543210", "91")).toBe("919876543210");
  });

  it("strips spaces, dashes and a leading +", () => {
    expect(mod.normalizePhone("+91 98765-43210", "91")).toBe("919876543210");
  });

  it("returns null for an empty/unparseable number", () => {
    expect(mod.normalizePhone("", "91")).toBeNull();
    expect(mod.normalizePhone("abc", "91")).toBeNull();
  });
});

describe("defaultIdempotencyKey", () => {
  it("is deterministic for the same purpose + phone + text", () => {
    const input = { recipientPhone: "919876543210", messagePurpose: "bill_created" as const, text: "Your bill is ready" };
    const a = mod.defaultIdempotencyKey(input, "919876543210");
    const b = mod.defaultIdempotencyKey(input, "919876543210");
    expect(a).toBe(b);
  });

  it("differs when the message text differs (a changed amount gets a new key)", () => {
    const base = { recipientPhone: "919876543210", messagePurpose: "bill_created" as const };
    const a = mod.defaultIdempotencyKey({ ...base, text: "Amount: 100" }, "919876543210");
    const b = mod.defaultIdempotencyKey({ ...base, text: "Amount: 200" }, "919876543210");
    expect(a).not.toBe(b);
  });

  it("differs across message purposes for the same recipient + text (report vs reminder don't collide)", () => {
    const a = mod.defaultIdempotencyKey({ recipientPhone: "919876543210", messagePurpose: "report_ready", text: "x" }, "919876543210");
    const b = mod.defaultIdempotencyKey({ recipientPhone: "919876543210", messagePurpose: "dues_reminder", text: "x" }, "919876543210");
    expect(a).not.toBe(b);
  });

  it("differs across recipients for identical purpose + text", () => {
    const input = (phone: string) => ({ recipientPhone: phone, messagePurpose: "otp" as const, text: "123456 is your code" });
    const a = mod.defaultIdempotencyKey(input("919876543210"), "919876543210");
    const b = mod.defaultIdempotencyKey(input("919812345678"), "919812345678");
    expect(a).not.toBe(b);
  });

  it("keys a template send by template name + language, not by rendered components", () => {
    const input = { recipientPhone: "919876543210", messagePurpose: "bill_created" as const, template: { name: "bill_ready", languageCode: "en" } };
    const a = mod.defaultIdempotencyKey(input, "919876543210");
    const b = mod.defaultIdempotencyKey(input, "919876543210");
    expect(a).toBe(b);
    expect(a).toContain("bill_ready");
  });
});

describe("parseAllowlist", () => {
  it("parses a JSON array of strings", () => {
    expect(mod.parseAllowlist('["919876543210","919812345678"]')).toEqual(["919876543210", "919812345678"]);
  });
  it("returns an empty array for empty/missing input", () => {
    expect(mod.parseAllowlist("")).toEqual([]);
  });
  it("returns an empty array for malformed JSON instead of throwing", () => {
    expect(() => mod.parseAllowlist("{not valid json")).not.toThrow();
    expect(mod.parseAllowlist("{not valid json")).toEqual([]);
  });
  it("filters out non-string entries defensively", () => {
    expect(mod.parseAllowlist('["919876543210", 123, null, "919812345678"]')).toEqual(["919876543210", "919812345678"]);
  });
});

describe("backoffMs (retry backoff growth)", () => {
  it("uses the base delay for the first attempt", () => {
    expect(mod.backoffMs(1, 30)).toBe(30_000);
  });
  it("doubles for each subsequent attempt", () => {
    expect(mod.backoffMs(2, 30)).toBe(60_000);
    expect(mod.backoffMs(3, 30)).toBe(120_000);
    expect(mod.backoffMs(4, 30)).toBe(240_000);
  });
  it("caps at 1 hour no matter how many attempts", () => {
    expect(mod.backoffMs(20, 30)).toBe(60 * 60 * 1000);
  });
});

describe("isRetryableStatus", () => {
  it("treats 429 (rate limit) as retryable", () => {
    expect(mod.isRetryableStatus(429)).toBe(true);
  });
  it("treats 5xx as retryable", () => {
    expect(mod.isRetryableStatus(500)).toBe(true);
    expect(mod.isRetryableStatus(503)).toBe(true);
  });
  it("treats 4xx (other than 429) as permanent, not retryable", () => {
    expect(mod.isRetryableStatus(400)).toBe(false);
    expect(mod.isRetryableStatus(401)).toBe(false);
    expect(mod.isRetryableStatus(404)).toBe(false);
  });
});

describe("shouldDeadLetter", () => {
  it("dead-letters immediately on a non-retryable error, even on the first attempt", () => {
    expect(mod.shouldDeadLetter(false, 1, 5)).toBe(true);
  });
  it("keeps retrying a retryable error while attempts remain", () => {
    expect(mod.shouldDeadLetter(true, 1, 5)).toBe(false);
    expect(mod.shouldDeadLetter(true, 4, 5)).toBe(false);
  });
  it("dead-letters a retryable error once the attempt budget is exhausted", () => {
    expect(mod.shouldDeadLetter(true, 5, 5)).toBe(true);
    expect(mod.shouldDeadLetter(true, 6, 5)).toBe(true);
  });
});

describe("parseHHMM", () => {
  it("parses a valid HH:MM", () => {
    expect(mod.parseHHMM("21:30")).toEqual({ hour: 21, minute: 30 });
  });
  it("returns null for an empty string (quiet hours off)", () => {
    expect(mod.parseHHMM("")).toBeNull();
  });
  it("returns null for an out-of-range hour or minute", () => {
    expect(mod.parseHHMM("24:00")).toBeNull();
    expect(mod.parseHHMM("10:60")).toBeNull();
  });
  it("returns null for garbage input", () => {
    expect(mod.parseHHMM("not-a-time")).toBeNull();
  });
});

describe("isWithinQuietHours (safety: automated sends respect the configured window)", () => {
  // Times are constructed in UTC and interpreted as IST (UTC+5:30) via istHourMinute.
  it("is false when either bound is unset (quiet hours disabled)", () => {
    expect(mod.isWithinQuietHours("", "08:00")).toBe(false);
    expect(mod.isWithinQuietHours("21:00", "")).toBe(false);
  });

  it("is true inside a same-day window (e.g. 13:00-17:00 IST)", () => {
    // 15:00 IST == 09:30 UTC
    const now = new Date("2026-01-01T09:30:00Z");
    expect(mod.isWithinQuietHours("13:00", "17:00", now)).toBe(true);
  });

  it("is false outside a same-day window", () => {
    // 08:00 IST == 02:30 UTC
    const now = new Date("2026-01-01T02:30:00Z");
    expect(mod.isWithinQuietHours("13:00", "17:00", now)).toBe(false);
  });

  it("handles a window that wraps past midnight (22:00-07:00)", () => {
    // 23:00 IST == 17:30 UTC same day -> inside the wrapped window
    const insideLate = new Date("2026-01-01T17:30:00Z");
    expect(mod.isWithinQuietHours("22:00", "07:00", insideLate)).toBe(true);
    // 03:00 IST == 21:30 UTC previous day -> inside the wrapped window
    const insideEarly = new Date("2026-01-01T21:30:00Z");
    expect(mod.isWithinQuietHours("22:00", "07:00", insideEarly)).toBe(true);
    // 12:00 IST == 06:30 UTC -> outside the wrapped window
    const outside = new Date("2026-01-01T06:30:00Z");
    expect(mod.isWithinQuietHours("22:00", "07:00", outside)).toBe(false);
  });

  it("treats an identical start and end as disabled (degenerate window)", () => {
    const now = new Date("2026-01-01T09:30:00Z");
    expect(mod.isWithinQuietHours("10:00", "10:00", now)).toBe(false);
  });
});

describe("QUIET_HOURS_EXEMPT_PURPOSES / DAILY_LIMIT_EXEMPT_PURPOSES (safety: OTP can never be silently held back)", () => {
  it("exempts otp, manual_staff_send, chatbot_reply and test_send from quiet hours", () => {
    for (const p of ["otp", "manual_staff_send", "chatbot_reply", "test_send"] as const) {
      expect(mod.QUIET_HOURS_EXEMPT_PURPOSES.has(p)).toBe(true);
    }
  });
  it("exempts the same four purposes from the daily message limit", () => {
    for (const p of ["otp", "manual_staff_send", "chatbot_reply", "test_send"] as const) {
      expect(mod.DAILY_LIMIT_EXEMPT_PURPOSES.has(p)).toBe(true);
    }
  });
  it("does NOT exempt bulk/scheduled purposes — reminders and follow-ups must respect quiet hours and daily limits", () => {
    for (const p of ["appointment_reminder", "dues_reminder", "report_ready", "recall_followup", "feedback_invite"] as const) {
      expect(mod.QUIET_HOURS_EXEMPT_PURPOSES.has(p)).toBe(false);
      expect(mod.DAILY_LIMIT_EXEMPT_PURPOSES.has(p)).toBe(false);
    }
  });
});
