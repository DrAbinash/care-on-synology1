import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import * as bootstrapModule from "./bootstrapHopeCareIntegration";
import {
  hashPartnerApiKey,
  resolvePartnerCredential,
  shouldBootstrapHopeCare,
  bootstrapHopeCareIntegration,
} from "./bootstrapHopeCareIntegration";

// A synthetic key with the shape of an issued one (`intgk_` + 64 hex from
// generateIntegrationKey()). No real credential appears in this file.
const SYNTH = `intgk_${"0".repeat(64)}`;

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
        INTEGRATION_HOPE_CALLBACK_URL: "http://172.16.1.139:7080/api/integration/care-callback",
      }),
    ).toBe(true);
  });

  test("ignores blank partner key", () => {
    expect(shouldBootstrapHopeCare({ HOPE_PARTNER_KEY: "   " })).toBe(false);
  });
});

// ── I11-A ────────────────────────────────────────────────────────────────────
// This repository is public and used to carry the partner key as a `DEFAULT_*`
// constant that the bootstrap fell back to whenever `HOPE_PARTNER_KEY` was
// unset. A host that was never configured therefore got a credential anyone
// could read off GitHub, and `HOPE_CARE_INTEGRATION_FORCE=1` — committed in the
// Synology templates — armed that path by default. Arming stays as it is: what
// must change is that a credential is never invented.
describe("resolvePartnerCredential", () => {
  test("a host with no partner key gets no credential", () => {
    const r = resolvePartnerCredential({ HOPE_CARE_INTEGRATION_FORCE: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/HOPE_PARTNER_KEY/);
  });

  test("whitespace is not a credential", () => {
    const r = resolvePartnerCredential({ HOPE_PARTNER_KEY: "   \t " });
    expect(r.ok).toBe(false);
  });

  test("an empty string is not a credential", () => {
    expect(resolvePartnerCredential({ HOPE_PARTNER_KEY: "" }).ok).toBe(false);
  });

  test("a key too short to be an issued one is refused", () => {
    const r = resolvePartnerCredential({ HOPE_PARTNER_KEY: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/characters/);
  });

  test("the environment-provided key is used verbatim, trimmed", () => {
    const r = resolvePartnerCredential({ HOPE_PARTNER_KEY: `  ${SYNTH}  ` });
    expect(r).toEqual({ ok: true, rawKey: SYNTH });
  });

  test("the reason never echoes the configured value", () => {
    const long = `intgk_${"a".repeat(64)}`;
    const r = resolvePartnerCredential({ HOPE_PARTNER_KEY: long.slice(0, 8) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(long.slice(0, 8));
  });
});

describe("no partner key is shipped in this repository", () => {
  test("the module exports no default partner key", () => {
    expect(Object.keys(bootstrapModule)).not.toContain("DEFAULT_HOPE_PARTNER_KEY");
    expect((bootstrapModule as Record<string, unknown>).DEFAULT_HOPE_PARTNER_KEY).toBeUndefined();
  });

  test("an armed host with no key skips before any database is touched", async () => {
    // @workspace/db throws at import when DATABASE_URL is unset, so a resolution
    // here proves the skip happened on the pure path. A host that only exported
    // DATABASE_URL later (or never) cannot be the one that registers a partner.
    delete process.env.DATABASE_URL;
    const r = await bootstrapHopeCareIntegration({ HOPE_CARE_INTEGRATION_FORCE: "1" });
    expect(r.skipped).toBe(true);
    if (r.skipped) expect(r.reason).toMatch(/HOPE_PARTNER_KEY/);
  });

  test("a callback URL alone does not register a partner either", async () => {
    delete process.env.DATABASE_URL;
    const r = await bootstrapHopeCareIntegration({
      INTEGRATION_HOPE_CALLBACK_URL: "http://172.16.1.139:7080/api/integration/care-callback",
    });
    expect(r.skipped).toBe(true);
    if (r.skipped) expect(r.reason).toMatch(/HOPE_PARTNER_KEY/);
  });
});

describe("hashPartnerApiKey", () => {
  test("is plain SHA-256 hex of the raw key", () => {
    expect(hashPartnerApiKey(SYNTH)).toBe(createHash("sha256").update(SYNTH).digest("hex"));
    expect(hashPartnerApiKey(SYNTH)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("distinct keys hash distinctly (no truncation to a prefix)", () => {
    expect(hashPartnerApiKey(SYNTH)).not.toBe(hashPartnerApiKey(`intgk_${"1".repeat(64)}`));
  });
});
