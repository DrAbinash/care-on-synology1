/**
 * worklistFeedbackStates.test.ts — the worklist must separate errors from
 * empty lists, clear every filter it claims to, and keep PHI-dumping debug
 * tooling out of production chrome (audit F-20/F-21/F-22).
 *
 * F-20: an always-visible Debug chip exposed username, email, role, a session
 *       token prefix and permissions; a 'Raw API' view dumped full PHI JSON;
 *       a sentinel patient-row fixture shipped in the production toolbar; a
 *       leftover console.log and window.alert for AI errors.
 * F-21: the toolbar Clear reset search/status/modality/lock/AI-draft/dates
 *       but silently left the AI-compose filter, the AI sort toggle and the
 *       overnight age/status chips engaged.
 * F-22: on fetch or auth failure the entries array defaulted to empty and
 *       the page rendered the 'no rows' empty state; the error was only
 *       visible inside the debug panel, with no retry in the main area.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const page = readFileSync(
  resolve(PKG_DIR, "src/pages/RadiologyWorklist.tsx"),
  "utf8",
).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("F-20: debug tooling is dev/admin only and leaks no token prefix", () => {
  it("the debug chip, raw API view and sentinel toggle are gated", () => {
    expect(page).toMatch(/const debugToolsAllowed = import\.meta\.env\.DEV/);
    expect(page).toMatch(/\{debugToolsAllowed \? \(\s*<PacsDebugPanel/);
    expect(page).toMatch(/\{debugToolsAllowed && showRawJson && \(/);
  });

  it("no token prefix is printed", () => {
    expect(page).not.toMatch(/token\.slice\(0, 12\)/);
    expect(page).not.toMatch(/Token prefix/);
    expect(page).toContain("present (prefix withheld)");
  });

  it("AI errors are toasted, not window.alert-ed, and no console.log remains", () => {
    expect(page).not.toMatch(/window\.alert/);
    expect(page).toMatch(/title: "AI draft error", description: ai\.lastError/);
    expect(page).not.toMatch(/console\.log\(/);
  });
});

describe("F-21: Clear resets the full filter set", () => {
  it("both Clear paths reset AI-compose, AI sort and the overnight chips", () => {
    // Toolbar Clear and the empty-state Clear All Filters.
    const clears = page.match(/setAiComposeFilter\("all"\);/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
    expect((page.match(/setSortAiCompose\(false\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((page.match(/setOvernightAgeChip\("last_24h"\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((page.match(/setOvernightStatusChip\("all"\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the Clear visibility chip lights for the previously-forgotten filters too", () => {
    expect(page).toMatch(/aiComposeFilter !== "all" \|\| sortAiCompose \|\| overnightAgeChip !== "last_24h" \|\| overnightStatusChip !== "all"/);
  });
});

describe("F-22: an error renders as an error, with a retry", () => {
  it("the error state precedes the empty state in the render chain", () => {
    const errorAt = page.indexOf("isError && entries.length === 0 ?");
    const emptyAt = page.indexOf("trulyEmpty && !showSentinel ?");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(emptyAt);
  });

  it("the error state says the list is not empty and offers a retry", () => {
    expect(page).toContain('data-testid="worklist-error-state"');
    expect(page).toContain('data-testid="worklist-error-retry"');
    expect(page).toMatch(/void refetch\(\)/);
  });
});
