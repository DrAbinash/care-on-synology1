// ============================================================================
// PR-I11A — the standalone (entrypoint) bootstrap must fail closed exactly like
// the TypeScript one it mirrors.
//
// `docker/api-entrypoint.sh` runs this script before the API starts whenever it
// sees any Hope env var, and it kept its own copy of the published partner key.
// Two implementations of one decision is how they drift, so these tests pin that
// the two agree on the credential rule AND on the hash the inbound auth
// middleware will later compare — a divergence in the second one registers a
// partner that can never authenticate.
// ============================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  MIN_PARTNER_KEY_LENGTH,
  hashApiKey,
  resolvePartnerKey,
} from "./bootstrap-hope-care-integration.mjs";
import {
  MIN_PARTNER_KEY_LENGTH as TS_MIN,
  hashPartnerApiKey,
  resolvePartnerCredential,
} from "../artifacts/api-server/src/lib/bootstrapHopeCareIntegration";

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNTH = `intgk_${"c".repeat(64)}`;

describe("the standalone bootstrap fails closed", () => {
  test("no partner key is reachable from this module's exports", () => {
    // Value-shaped rather than name-shaped: renaming the constant back would not
    // get past this, and no issued key can ever be a 64-fold repeat.
    const exported = readFileSync(resolve(HERE, "bootstrap-hope-care-integration.mjs"), "utf8");
    expect(exported).not.toMatch(/intgk_[0-9a-f]{20,}/);
  });

  test("an unset key is refused with a reason that names the variable", () => {
    const r = resolvePartnerKey(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("HOPE_PARTNER_KEY is not set");
  });

  test("a whitespace key is refused", () => {
    expect(resolvePartnerKey("   ").ok).toBe(false);
  });

  test("a truncated key is refused before it can register an unusable partner", () => {
    const r = resolvePartnerKey(SYNTH.slice(0, MIN_PARTNER_KEY_LENGTH - 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/characters/);
  });

  test("a full-length key is used verbatim, trimmed", () => {
    expect(resolvePartnerKey(`  ${SYNTH}\t`)).toEqual({ ok: true, rawKey: SYNTH });
  });
});

describe("the two bootstrap implementations agree", () => {
  test("on the minimum key length", () => {
    expect(TS_MIN).toBe(MIN_PARTNER_KEY_LENGTH);
  });

  test("on the accept/refuse decision for the same env value", () => {
    for (const value of [undefined, "", "   ", "intgk_short", SYNTH, ` ${SYNTH} `]) {
      const mjs = resolvePartnerKey(value);
      const ts = resolvePartnerCredential({ HOPE_PARTNER_KEY: value });
      expect(mjs.ok, JSON.stringify(value)).toBe(ts.ok);
      if (!mjs.ok && !ts.ok) expect(mjs.reason, JSON.stringify(value)).toBe(ts.reason);
    }
  });

  test("on the hash each writes for the same key", () => {
    // Equality with the *middleware's* hash is proven end-to-end in
    // bootstrapHopeCareIntegration.db.test.ts (D7), which authenticates a real
    // request through requireIntegrationPartnerAuth against a row the bootstrap
    // wrote. What is pinned here is that the two bootstraps cannot disagree about
    // which hash to store: a partner registered by one and looked up by the other
    // would 401 forever with nothing wrong in the configuration.
    const expected = createHash("sha256").update(SYNTH).digest("hex");
    expect(hashApiKey(SYNTH)).toBe(expected);
    expect(hashPartnerApiKey(SYNTH)).toBe(expected);
  });
});
