// Regression for PR #548: Tests + migration smoke sat >10 min on
// `sudo apt-get update && apt-get install poppler-utils` because jobs inherited
// GitHub's 6-hour default timeout. A sibling e2e job hung 2h on
// `playwright install --with-deps`. These assertions keep the caps in the
// workflow so a hung apt/playwright step fails in minutes, not hours.
//
// Counter-regression for 2026-10-01: those caps then killed 3 of 4 runs because
// a *slow* mirror, not a hung one, cannot fit 33.4 MB in 240 s. So the caps are
// asserted to exist AND to leave the script's own budgets room to finish.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const aptHelper = readFileSync(path.join(root, "scripts/ci-apt-install.sh"), "utf8");

describe("CI hang guards (PR #548 — apt-get sat past 10 min with no timeout)", () => {
  it("every job caps wall time so a hung step cannot sit for the 6h default", () => {
    for (const job of ["static", "test"]) {
      const block = yml.split(/\n  (?=[a-z])/).find((chunk) => chunk.startsWith(`${job}:`));
      expect(block, `job ${job} missing`).toBeTruthy();
      expect(block).toMatch(/timeout-minutes:\s*[1-9][0-9]*/);
    }
  });

  it("CI apt and Chromium installs have bounded step timeouts", () => {
    expect(yml).toMatch(/Install CI apt packages[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).toMatch(/Install Chromium browser[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).toMatch(/Browser smoke \(login shell\)[\s\S]*?timeout-minutes:\s*[1-9]/);
    expect(yml).not.toContain("playwright install --with-deps chromium");
    expect(yml).toContain("playwright install chromium");
  });

  it("apt-get is not invoked unbounded from the workflow", () => {
    expect(yml).not.toMatch(/sudo apt-get update && sudo apt-get install/);
    expect(yml).toContain("scripts/ci-apt-install.sh");
    expect(aptHelper).toMatch(/timeout "\$APT_UPDATE_TIMEOUT_SECONDS" apt-get update/);
    expect(aptHelper).toMatch(/timeout "\$APT_INSTALL_TIMEOUT_SECONDS" apt-get install/);
    expect(aptHelper).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(aptHelper).toContain("fuser /var/lib/dpkg/lock-frontend");
  });

  it("the install budget fits a slow mirror and the step outlives it", () => {
    const num = (re) => Number(aptHelper.match(re)?.[1] ?? 0);
    const update = num(/CI_APT_UPDATE_TIMEOUT_SECONDS:-(\d+)/);
    const install = num(/CI_APT_INSTALL_TIMEOUT_SECONDS:-(\d+)/);
    // Measured 2026-10-01: `apt-get update` pulled its 12.6 MB index at ~8 MB/s
    // while the 33.4 MB of packages arrived at ~130 kB/s, so a 240s install cap
    // killed the step at mesa-libgallium on 3 of 4 runs (exit 124, before any
    // test ran). The cap has to be sized for throughput, not for a hang.
    expect(install, "install cap below measured slow-mirror download time").toBeGreaterThanOrEqual(420);
    expect(update).toBeGreaterThan(0);

    const step = Number(yml.match(/Install CI apt packages[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1] ?? 0);
    expect(step * 60, "workflow step preempts the script's own retry budgets").toBeGreaterThan(update + install);
  });
});
