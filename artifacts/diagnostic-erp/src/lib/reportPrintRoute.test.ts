/**
 * Reaching paper from the Reporting Workspace.
 *
 * Two defects, both measured before being fixed:
 *
 *  - The only button that prints the report on the final layout was hidden until
 *    a draft id existed. `handlePrintLikeFinal` saves the draft itself, so the
 *    requirement was pointless, and it removed the print action from the first
 *    half-minute of every study — which is how long a normal report takes to read.
 *  - The command palette's "Print report" called `window.print()`. The ERP has no
 *    print stylesheet and the report lives in one accordion section, so that
 *    printed the worklist, the viewer and other patients' rows instead of the
 *    report.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canPrintLikeFinal } from "@/components/radiology/ReportExportPanel";

describe("the print action is available when he needs it", () => {
  it("shows while the study is still unsaved", () => {
    // The handler creates the draft; the button must not wait for one.
    expect(canPrintLikeFinal({ onPrintLikeFinal: async () => {} })).toBe(true);
  });

  it("does not offer a live-merge print for a report that is already signed", () => {
    expect(canPrintLikeFinal({
      onPrintLikeFinal: async () => {},
      linkedReportId: "RPT-4711",
    })).toBe(false);
  });

  it("stays away when nothing can perform the print", () => {
    expect(canPrintLikeFinal({})).toBe(false);
    expect(canPrintLikeFinal({ onPrintLikeFinal: null })).toBe(false);
  });
});

describe("no route prints the application", () => {
  it("the command palette never calls window.print", () => {
    const src = readFileSync(
      resolve(__dirname, "../components/radiology/zai-workspace/command-palette.tsx"),
      "utf8",
    );
    // A grep guard, deliberately: the fault it prevents is printing the ERP chrome,
    // and that is a property of which function the command calls, not of runtime
    // behaviour we can reach without a browser here.
    expect(src).not.toContain("window.print(");
    expect(src).toContain("onPrintReport");
  });
});

describe("the top bar reaches paper without opening Layout / Export", () => {
  const src = readFileSync(
    resolve(__dirname, "../components/radiology/workspace/WorkspaceTopBar.tsx"),
    "utf8",
  );

  it("offers the same print route the panel button runs", () => {
    // One action, one implementation: the strip button and the panel button must not
    // grow separate print code.
    expect(src).toMatch(/canPrintLikeFinal\(\{[^}]*onPrintLikeFinal: handlePrintLikeFinal/);
    expect(src).toMatch(/onClick=\{\(\) => void handlePrintLikeFinal\(\)\}/);
    expect(src).toContain('data-testid="btn-workspace-print"');
    expect(src).not.toContain("window.print(");
  });

  it("applies the same rule about a signed report", () => {
    // The gate is shared, not re-typed — a second copy of the condition is how the
    // panel button came to require a draft id that the handler creates itself.
    expect(src).toContain("linkedReportId");
    expect(src).not.toMatch(/canPrintLikeFinal\(\{(?![^}]*linkedReportId)/);
  });
});
