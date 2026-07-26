import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Security sweep — internal endpoint auth must fail CLOSED and compare secrets
// in constant time.
//
// internal-backup.ts previously failed OPEN outside production: with
// INTERNAL_API_KEY unset and NODE_ENV !== "production" it logged a warning and
// called next(), so any box not explicitly marked production served
// full-database backup downloads to any caller that could reach the port.
// internal-cron.ts already failed closed but compared its bearer secret with
// `!==`, leaking timing while 13 other call sites in the server use
// crypto.timingSafeEqual.
//
// Source-contract style (no server boot): pins both guards so a regression that
// reintroduces an unauthenticated path, or a non-constant-time compare, fails.

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupSrc = readFileSync(join(__dirname, "internal-backup.ts"), "utf8");
const cronSrc = readFileSync(join(__dirname, "internal-cron.ts"), "utf8");

describe("internal-backup.ts — full-database backup endpoint auth", () => {
  test("fails closed when INTERNAL_API_KEY is unset, in EVERY environment", () => {
    // Behavioural, not literal: the 503 text now names the specific weakness
    // (see lib/secretStrength.ts), so pinning the old string only tested the
    // wording. What matters is that a bad/absent key yields 503 and never
    // reaches next(). secretStrength.test.ts drives the real middleware and
    // asserts exactly that, including for the production value "1234".
    expect(backupSrc).toMatch(/res\.status\(503\)[\s\S]{0,120}INTERNAL_API_KEY/);
    // The non-production bypass must be gone: no NODE_ENV branch may decide
    // whether this endpoint is authenticated.
    expect(backupSrc).not.toContain('process.env["NODE_ENV"] === "production"');
    expect(backupSrc).not.toContain("internal backup endpoint unprotected");
  });

  test("the guard has no next() path that skips key verification", () => {
    // Only ONE next() — the one after a successful constant-time comparison.
    const nextCalls = backupSrc.match(/^\s*next\(\);/gm) ?? [];
    expect(nextCalls.length).toBe(1);
  });

  test("compares the bearer secret in constant time", () => {
    expect(backupSrc).toContain("crypto.timingSafeEqual(ab, bb)");
    expect(backupSrc).toMatch(/if \(!safeEqual\(provided, \w+\)\)/);
    expect(backupSrc).not.toContain("provided !== expected");
  });
});

describe("internal-cron.ts — cron trigger endpoint auth", () => {
  test("still fails closed when CRON_SECRET is unset", () => {
    expect(cronSrc).toMatch(/res\.status\(503\)[\s\S]{0,120}CRON_SECRET/);
  });

  test("compares the bearer secret in constant time", () => {
    expect(cronSrc).toContain("crypto.timingSafeEqual(ab, bb)");
    expect(cronSrc).toMatch(/if \(!safeEqual\(provided, \w+\)\)/);
    expect(cronSrc).not.toContain("provided !== expected");
  });
});
