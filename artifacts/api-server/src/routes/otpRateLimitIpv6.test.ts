import { describe, expect, test } from "vitest";
import { ipKeyGenerator } from "express-rate-limit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Patient-OTP rate limiters — IPv6 bucketing.
//
// Production logged ERR_ERL_KEY_GEN_IPV6 twice on every boot: the shared
// keyGenerator (`ipPlusPhoneKey`) interpolated raw `req.ip` into its composite
// key. For IPv6 that means every address in an attacker's /64 (2^64 of them,
// all routed to them) minted a FRESH bucket with a full budget — 6 sends and
// 12 verifies per 15 min each — so the file's own stated property ("an attacker
// rotating source addresses can't stack the per-IP budget against one target")
// did not hold. The phone segment does not save it: phone is a *component* of
// the key, so for a targeted attack it is constant and only the IP varies.
//
// express-rate-limit's own default keyGenerator normalises IPv6 to a /56 via
// ipKeyGenerator; this restores that for the IP half while keeping |phone.
//
// Two levels of assertion below: the real /56 collapsing behaviour, and a
// source contract so the raw-req.ip form cannot come back.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "patientPortal.ts"), "utf8");

describe("ipKeyGenerator gives the anti-rotation property the limiters need", () => {
  test("two addresses in the same IPv6 /64 collapse to ONE bucket key", () => {
    const a = "2001:db8:1234:5678::1";
    const b = "2001:db8:1234:5678::dead:beef";
    expect(a).not.toBe(b); // genuinely different source addresses
    expect(ipKeyGenerator(a)).toBe(ipKeyGenerator(b));
  });

  test("a different prefix is still a distinct bucket (not over-collapsed)", () => {
    expect(ipKeyGenerator("2001:db8:1234:5678::1")).not.toBe(
      ipKeyGenerator("2001:dead:beef:9999::1"),
    );
  });

  test("IPv4 addresses are unaffected", () => {
    expect(ipKeyGenerator("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKeyGenerator("203.0.113.9")).not.toBe(ipKeyGenerator("203.0.113.10"));
  });
});

describe("patientPortal wires the helper into the OTP limiter key", () => {
  test("the helper is imported", () => {
    expect(src).toContain('import rateLimit, { ipKeyGenerator } from "express-rate-limit";');
  });

  test("the key function runs the IP through ipKeyGenerator, not raw req.ip", () => {
    expect(src).toContain("return `${ipKeyGenerator(req.ip ?? \"\")}|${phone}`;");
    // The raw form must not return: express-rate-limit's validator is a literal
    // source scan for "req.ip" without "ipKeyGenerator", so this is also what
    // keeps the startup ValidationError from reappearing.
    expect(src).not.toContain("return `${req.ip}|${phone}`;");
  });

  test("ip+phone bucketing is preserved and both limiters still use it", () => {
    expect(src).toContain("keyGenerator: ipPlusPhoneKey");
    expect((src.match(/keyGenerator: ipPlusPhoneKey/g) ?? []).length).toBe(2);
    // Budgets unchanged — this fix must not loosen the limits.
    expect(src).toContain("max: 6,");
    expect(src).toContain("max: 12,");
  });

  test("the DB-side backstops that actually bound brute force are still present", () => {
    // These are what kept the exposure to defence-in-depth rather than an open
    // door; assert they did not get removed along the way.
    expect(src).toContain("OTP_MAX_ATTEMPTS");
    expect(src).toContain("OTP_RESEND_COOLDOWN_MS");
  });
});
