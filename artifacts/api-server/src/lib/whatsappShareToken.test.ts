/**
 * Unit tests — signed share tokens (WhatsApp Delivery v2).
 */
import { describe, expect, it } from "vitest";
import { mintShareToken, verifyShareToken } from "./whatsappShareToken";

const SECRET = "test-share-secret-for-unit-tests";

describe("whatsappShareToken", () => {
  it("accepts a fresh token and rejects expired / garbage", () => {
    const { token, expiresAt } = mintShareToken("bill", 42, {
      ttlDays: 7,
      secret: SECRET,
      nowMs: Date.parse("2026-09-25T12:00:00Z"),
    });
    expect(expiresAt.toISOString()).toContain("2026-10-02");

    const ok = verifyShareToken(token, {
      expectKind: "bill",
      secret: SECRET,
      nowMs: Date.parse("2026-09-26T12:00:00Z"),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.payload.recordId).toBe(42);
      expect(ok.payload.kind).toBe("bill");
    }

    const expired = verifyShareToken(token, {
      expectKind: "bill",
      secret: SECRET,
      nowMs: Date.parse("2026-10-03T12:00:00Z"),
    });
    expect(expired).toEqual({ ok: false, reason: "expired" });

    expect(verifyShareToken("not-a-token", { secret: SECRET })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyShareToken("aaa.bbb", { secret: SECRET })).toEqual({ ok: false, reason: "bad_signature" });

    const wrongKind = verifyShareToken(token, {
      expectKind: "report",
      secret: SECRET,
      nowMs: Date.parse("2026-09-26T12:00:00Z"),
    });
    expect(wrongKind).toEqual({ ok: false, reason: "kind_mismatch" });
  });

  it("report tokens mint independently", () => {
    const { token } = mintShareToken("report", 99, { secret: SECRET, ttlDays: 7 });
    const v = verifyShareToken(token, { expectKind: "report", secret: SECRET });
    expect(v.ok).toBe(true);
  });
});
