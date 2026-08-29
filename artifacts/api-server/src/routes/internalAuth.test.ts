import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupSrc = readFileSync(join(__dirname, "internal-backup.ts"), "utf8");
const authSrc = readFileSync(join(__dirname, "../lib/internalApiKeyAuth.ts"), "utf8");
const cronSrc = readFileSync(join(__dirname, "internal-cron.ts"), "utf8");

describe("internal-backup.ts — full-database backup endpoint auth", () => {
  test("uses the shared strong-key guard", () => {
    expect(backupSrc).toContain("requireStrongInternalApiKey");
    expect(backupSrc).not.toContain("provided !== expected");
  });

  test("does not bypass auth in non-production", () => {
    expect(backupSrc).not.toContain('process.env["NODE_ENV"] === "production"');
    expect(backupSrc).not.toContain("internal backup endpoint unprotected");
  });
});

describe("internalApiKeyAuth.ts — shared bearer guard", () => {
  test("compares secrets in constant time", () => {
    expect(authSrc).toContain("crypto.timingSafeEqual(ab, bb)");
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
