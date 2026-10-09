/**
 * Unit tests for the key-image access grant (`keyImageAccessToken.ts`).
 *
 * These are the refusal paths that must never serve pixels. The request-level
 * suite (`keyImageAccessControl.request.test.ts`) drives the same module over
 * real HTTP through the real mount; this file pins the crypto contract itself,
 * including expiry and cross-file replay, without a database.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_IMAGE_GRANT_TTL_SECONDS,
  mintKeyImageGrant,
  verifyKeyImageGrant,
} from "./keyImageAccessToken";

const SECRET = "vitest-key-image-secret";
const FILE = "6f0f6f7a-1f2c-4a3b-9d1e-0a2b3c4d5e6f.jpg";

const envKeys = ["SESSION_SECRET", "JWT_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

function withSecretUnset(): void {
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}
function restoreEnv(): void {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

describe("mintKeyImageGrant / verifyKeyImageGrant", () => {
  afterEach(restoreEnv);

  it("round-trips a grant for exactly the file it was minted for", () => {
    const grant = mintKeyImageGrant(FILE, { secret: SECRET });
    expect(grant.token).toContain(".");
    expect(grant.token).not.toContain(FILE); // the payload is encoded, not plaintext-in-clear-text
    const checked = verifyKeyImageGrant(grant.token, FILE, { secret: SECRET });
    expect(checked.ok).toBe(true);
  });

  it("binds the grant to one file: a valid grant for a.jpg cannot open b.jpg", () => {
    const forA = mintKeyImageGrant("a.jpg", { secret: SECRET });
    expect(verifyKeyImageGrant(forA.token, "b.jpg", { secret: SECRET })).toEqual({
      ok: false,
      reason: "file_mismatch",
    });
    // ...and the same grant still works on its own file.
    expect(verifyKeyImageGrant(forA.token, "a.jpg", { secret: SECRET }).ok).toBe(true);
  });

  it("expires on the server clock, and reports expiry distinctly from tampering", () => {
    const mintedAt = Date.parse("2026-10-09T10:00:00Z");
    const grant = mintKeyImageGrant(FILE, { secret: SECRET, nowMs: mintedAt });
    expect(grant.expiresAt.getTime()).toBe(mintedAt + KEY_IMAGE_GRANT_TTL_SECONDS * 1000);

    expect(
      verifyKeyImageGrant(grant.token, FILE, {
        secret: SECRET,
        nowMs: mintedAt + (KEY_IMAGE_GRANT_TTL_SECONDS - 30) * 1000,
      }).ok,
    ).toBe(true);

    expect(
      verifyKeyImageGrant(grant.token, FILE, {
        secret: SECRET,
        nowMs: mintedAt + (KEY_IMAGE_GRANT_TTL_SECONDS + 5) * 1000,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered signature and a tampered payload", () => {
    const grant = mintKeyImageGrant(FILE, { secret: SECRET });
    const [body, sig] = grant.token.split(".");

    expect(verifyKeyImageGrant(`${body}.${sig.slice(0, -2)}xx`, FILE, { secret: SECRET })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // A forged payload re-signed with nothing is still a bad signature.
    const forged = `${Buffer.from(JSON.stringify({ f: "other.jpg", exp: 9_999_999_999 })).toString("base64url")}.${sig}`;
    expect(verifyKeyImageGrant(forged, "other.jpg", { secret: SECRET })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a grant signed with a different secret", () => {
    const grant = mintKeyImageGrant(FILE, { secret: "secret-A" });
    expect(verifyKeyImageGrant(grant.token, FILE, { secret: "secret-B" })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("treats missing, malformed and empty as refusals, never as an open door", () => {
    for (const bad of [null, undefined, "", "no-dot-here", ".", "abc.", "%%not-base64%%.zz"]) {
      const r = verifyKeyImageGrant(bad as string | null, FILE, { secret: SECRET });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(["missing", "malformed", "bad_signature"]).toContain(r.reason);
    }
  });

  it("refuses everything when no signing secret is configured (fail closed, no public fallback)", () => {
    withSecretUnset();
    expect(() => mintKeyImageGrant(FILE)).toThrow(/SESSION_SECRET/);
    // A token minted earlier cannot be verified without the secret either.
    const token = mintKeyImageGrant(FILE, { secret: SECRET }).token;
    expect(verifyKeyImageGrant(token, FILE)).toEqual({
      ok: false,
      reason: "secret_unavailable",
    });
  });

  it("uses the deployed SESSION_SECRET and falls back to JWT_SECRET, like the existing share tokens", () => {
    process.env.SESSION_SECRET = "from-session-secret";
    const a = mintKeyImageGrant(FILE);
    expect(verifyKeyImageGrant(a.token, FILE).ok).toBe(true);

    delete process.env.SESSION_SECRET;
    process.env.JWT_SECRET = "from-jwt-secret";
    const b = mintKeyImageGrant(FILE);
    expect(verifyKeyImageGrant(b.token, FILE).ok).toBe(true);
    // A SESSION_SECRET token is not valid once only JWT_SECRET remains.
    expect(verifyKeyImageGrant(a.token, FILE)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses to mint for an empty file name", () => {
    expect(() => mintKeyImageGrant("  ", { secret: SECRET })).toThrow(/file name/);
  });

  it("never mint an expiry in the past, even if a caller asks for a silly TTL", () => {
    const grant = mintKeyImageGrant(FILE, { secret: SECRET, ttlSeconds: 0 });
    expect(verifyKeyImageGrant(grant.token, FILE, { secret: SECRET }).ok).toBe(true);
  });
});
