/**
 * worklistFewClicks.test.ts — source contracts for the second few-clicks pass,
 * worklist half (owner's order: radiologists use FEW CLICKS, easy quick reports).
 *
 * WHY SOURCE CONTRACTS: this package has no DOM harness (vitest runs in the
 * node environment), so the row affordances cannot be clicked here. What CAN be
 * pinned mechanically is the wiring: the row opens the study, inner controls
 * opt out, the keyboard path exists, and the queue's date default is the
 * last-two-IST-days window the Reporting Workspace documents. Pure behavior of
 * the default window itself lives in dateRangePresets.studyDate.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(__dirname, "../pages/RadiologyWorklist.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("worklist row opens the study (few-clicks pass 2)", () => {
  it("the row itself is focusable and labeled", () => {
    expect(src).toContain("tabIndex={entry.id === -1 ? -1 : 0}");
    expect(src).toContain('data-testid={`worklist-row-${entry.id}`}');
    expect(src).toContain("cursor-pointer");
  });

  it("clicking anywhere on the row (except its own controls) opens the study", () => {
    const rowOpen = src.indexOf('onClick={entry.id === -1 ? undefined : (e) => {');
    expect(rowOpen).toBeGreaterThan(0);
    const guard = src.indexOf(
      'closest("button, a, input, select, textarea, label, [role=\'button\']")',
      rowOpen,
    );
    const nav = src.indexOf("navigate(reportingWorkspacePath(entry.id))", rowOpen);
    expect(guard).toBeGreaterThan(rowOpen);
    expect(nav).toBeGreaterThan(guard);
  });

  it("Enter and Space on the focused row open the study, guarded the same way", () => {
    const keyOpen = src.indexOf('onKeyDown={entry.id === -1 ? undefined : (e) => {');
    expect(keyOpen).toBeGreaterThan(0);
    const enterPin = src.indexOf('if (e.key !== "Enter" && e.key !== " ") return;', keyOpen);
    const guardPin = src.indexOf("closest(", keyOpen);
    const preventDefault = src.indexOf("e.preventDefault();", keyOpen);
    const navPin = src.indexOf("navigate(reportingWorkspacePath(entry.id))", keyOpen);
    expect(enterPin).toBeGreaterThan(keyOpen);
    expect(guardPin).toBeGreaterThan(keyOpen);
    expect(preventDefault).toBeGreaterThan(enterPin);
    expect(navPin).toBeGreaterThan(preventDefault);
  });

  it("the sentinel debug row stays inert", () => {
    // Both handlers and the tabIndex gate on entry.id === -1.
    const count = src.match(/entry\.id === -1 \? undefined/g)?.length ?? 0;
    expect(count).toBe(2);
    expect(src).toContain("tabIndex={entry.id === -1 ? -1 : 0}");
  });
});

describe("queue date defaults (few-clicks pass 2)", () => {
  it("the list opens on the last two IST calendar days by default", () => {
    expect(src).toContain("const [dateFrom, setDateFrom] = useState(() => daysAgoISO(1));");
    expect(src).toContain("const [dateTo, setDateTo] = useState(() => todayISO());");
    expect(src).toContain(
      'import { DATE_PRESETS, daysAgoISO, studyDateInRange, todayISO } from "@/lib/dateRangePresets";',
    );
  });

  it("Clear remains the explicit all-time override", () => {
    const clearIdx = src.indexOf('onClick={() => { setSearch("");');
    expect(clearIdx).toBeGreaterThan(0);
    expect(src.indexOf('setDateFrom("");', clearIdx)).toBeGreaterThan(clearIdx);
    expect(src.indexOf('setDateTo("");', clearIdx)).toBeGreaterThan(clearIdx);
  });
});
