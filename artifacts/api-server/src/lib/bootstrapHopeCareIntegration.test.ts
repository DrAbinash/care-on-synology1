import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_HOPE_PARTNER_KEY,
  hashPartnerApiKey,
  shouldBootstrapHopeCare,
} from "./bootstrapHopeCareIntegration";

describe("shouldBootstrapHopeCare", () => {
  test("skips when no Hope integration env is set", () => {
    expect(shouldBootstrapHopeCare({})).toBe(false);
  });

  test("runs when HOPE_CARE_INTEGRATION_FORCE=1", () => {
    expect(shouldBootstrapHopeCare({ HOPE_CARE_INTEGRATION_FORCE: "1" })).toBe(true);
  });

  test("runs when HOPE_PARTNER_KEY is set", () => {
    expect(shouldBootstrapHopeCare({ HOPE_PARTNER_KEY: "intgk_abc" })).toBe(true);
  });

  test("runs when INTEGRATION_HOPE_SIGNING_SECRET is set", () => {
    expect(
      shouldBootstrapHopeCare({ INTEGRATION_HOPE_SIGNING_SECRET: "secret" }),
    ).toBe(true);
  });

  test("runs when INTEGRATION_HOPE_CALLBACK_URL is set", () => {
    expect(
      shouldBootstrapHopeCare({
        INTEGRATION_HOPE_CALLBACK_URL: "http://192.168.1.137:7080/api/integration/care-callback",
      }),
    ).toBe(true);
  });

  test("ignores blank partner key", () => {
    expect(shouldBootstrapHopeCare({ HOPE_PARTNER_KEY: "   " })).toBe(false);
  });
});

describe("hashPartnerApiKey", () => {
  test("matches SHA-256 hex used by partner auth middleware", () => {
    const expected = createHash("sha256").update(DEFAULT_HOPE_PARTNER_KEY).digest("hex");
    expect(hashPartnerApiKey(DEFAULT_HOPE_PARTNER_KEY)).toBe(expected);
    expect(hashPartnerApiKey(DEFAULT_HOPE_PARTNER_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});
