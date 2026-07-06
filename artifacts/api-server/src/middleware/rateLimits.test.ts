import { afterEach, describe, expect, test } from "vitest";
import { hasValidInternalApiKey } from "./rateLimits";

// Fix: DICOM auto-pull / internal radiology intake (POST /api/internal/radiology/*)
// was intermittently 429'd because it shared the same public generalLimiter
// quota as ordinary browser/API traffic. generalLimiter.skip now bypasses the
// public rate limit ONLY when a request under /internal/ carries a bearer
// token that exactly matches INTERNAL_API_KEY — everything else (missing key,
// wrong key, non-internal paths) is unaffected and still rate-limited exactly
// as before. This does not change or weaken authentication: every /internal/*
// route still independently verifies the key itself via requireInternalApiKey /
// requireStaffOrInternalAuth in internal-radiology.ts.

function makeReq(headers: Record<string, string>): import("express").Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as import("express").Request;
}

describe("hasValidInternalApiKey", () => {
  const ORIGINAL_KEY = process.env["INTERNAL_API_KEY"];

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env["INTERNAL_API_KEY"];
    else process.env["INTERNAL_API_KEY"] = ORIGINAL_KEY;
  });

  test("returns true when bearer token exactly matches INTERNAL_API_KEY", () => {
    process.env["INTERNAL_API_KEY"] = "secret-dicom-key-123";
    const req = makeReq({ authorization: "Bearer secret-dicom-key-123" });
    expect(hasValidInternalApiKey(req)).toBe(true);
  });

  test("returns false when bearer token is wrong", () => {
    process.env["INTERNAL_API_KEY"] = "secret-dicom-key-123";
    const req = makeReq({ authorization: "Bearer wrong-key" });
    expect(hasValidInternalApiKey(req)).toBe(false);
  });

  test("returns false when authorization header is missing", () => {
    process.env["INTERNAL_API_KEY"] = "secret-dicom-key-123";
    const req = makeReq({});
    expect(hasValidInternalApiKey(req)).toBe(false);
  });

  test("returns false when header is present but not a Bearer token", () => {
    process.env["INTERNAL_API_KEY"] = "secret-dicom-key-123";
    const req = makeReq({ authorization: "Basic secret-dicom-key-123" });
    expect(hasValidInternalApiKey(req)).toBe(false);
  });

  test("fails closed: returns false when INTERNAL_API_KEY is not configured at all", () => {
    delete process.env["INTERNAL_API_KEY"];
    const req = makeReq({ authorization: "Bearer anything" });
    expect(hasValidInternalApiKey(req)).toBe(false);
  });

  test("empty bearer token is rejected even when a key is configured", () => {
    process.env["INTERNAL_API_KEY"] = "secret-dicom-key-123";
    const req = makeReq({ authorization: "Bearer " });
    expect(hasValidInternalApiKey(req)).toBe(false);
  });
});
