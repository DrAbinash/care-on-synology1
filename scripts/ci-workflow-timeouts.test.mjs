// Regression for PR #548: Tests + migration smoke sat >10 min on
// `sudo apt-get update && apt-get install poppler-utils` because jobs inherited
// GitHub's 6-hour default timeout. A sibling e2e job hung 2h on
// `playwright install --with-deps`. These assertions keep the caps in the
// workflow so a hung apt/playwright step fails in minutes, not hours.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const aptHelper = readFileSync(path.join(root, "scripts/ci-apt-install.sh"), "utf8");

describe("CI hang guards (PR #548 — apt-get sat past 10 min with no timeout)", () => {
  it("every job caps wall time so a hung step cannot sit for the 6h default", () => {
    for (const job of ["static", "test", "e2e-smoke"]) {
      const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith(`${job}:`));
      expect(block, `job ${job} missing`).toBeTruthy();
      expect(block).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
    }
  });

  it("CI apt and Chromium installs have bounded step timeouts", () => {
    expect(yml).toMatch(/Install CI apt packages[\s\S]*?timeout-minutes:\s*[1-9]/);
    const chromiumSteps = yml.match(/Install Chromium browser[\s\S]*?timeout-minutes:\s*[1-9]/g) || [];
    expect(chromiumSteps.length).toBeGreaterThanOrEqual(2);
    expect(yml).not.toContain("playwright install --with-deps chromium");
    expect(yml).toContain("playwright install chromium");
  });

  it("apt-get is not invoked unbounded from the workflow", () => {
    expect(yml).not.toMatch(/sudo apt-get update && sudo apt-get install/);
    expect(yml).toContain("scripts/ci-apt-install.sh");
    expect(aptHelper).toMatch(/timeout 240 apt-get update/);
    expect(aptHelper).toMatch(/timeout 240 apt-get install/);
    expect(aptHelper).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(aptHelper).toContain("fuser /var/lib/dpkg/lock-frontend");
  });
});
