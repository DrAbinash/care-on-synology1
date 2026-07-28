import { describe, expect, test, vi } from "vitest";
import { staffLoginRateLimitKey, staffLoginResponseCountsTowardLimit } from "./portalLoginLimiter";

vi.mock("express-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("express-rate-limit")>();
  return {
    ...actual,
    ipKeyGenerator: (req: { ip?: string }) => req.ip ?? "127.0.0.1",
    default: actual.default,
  };
});

function makeReq(body: Record<string, unknown> = {}, ip = "192.168.1.50"): import("express").Request {
  return { body, ip } as unknown as import("express").Request;
}

function makeRes(statusCode: number): import("express").Response {
  return { statusCode } as unknown as import("express").Response;
}

describe("staffLoginRateLimitKey", () => {
  test("keys by normalized username when present", () => {
    expect(staffLoginRateLimitKey(makeReq({ username: "Reception@Clinic.com" }))).toBe(
      "staff-login:reception@clinic.com",
    );
  });

  test("falls back to email field for legacy clients", () => {
    expect(staffLoginRateLimitKey(makeReq({ email: "Admin@Example.com" }))).toBe(
      "staff-login:admin@example.com",
    );
  });

  test("falls back to IP when username missing", () => {
    expect(staffLoginRateLimitKey(makeReq({}, "10.0.0.5"))).toBe("10.0.0.5");
  });
});

describe("staffLoginResponseCountsTowardLimit", () => {
  test("counts only wrong-credentials 401 responses", () => {
    expect(staffLoginResponseCountsTowardLimit(makeReq(), makeRes(401))).toBe(true);
    expect(staffLoginResponseCountsTowardLimit(makeReq(), makeRes(200))).toBe(false);
    expect(staffLoginResponseCountsTowardLimit(makeReq(), makeRes(400))).toBe(false);
    expect(staffLoginResponseCountsTowardLimit(makeReq(), makeRes(403))).toBe(false);
    expect(staffLoginResponseCountsTowardLimit(makeReq(), makeRes(429))).toBe(false);
  });
});
