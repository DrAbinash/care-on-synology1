import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSrc = readFileSync(resolve(__dirname, "./MyDailySummary.tsx"), "utf8");
const boundarySrc = readFileSync(
  resolve(__dirname, "../components/ModuleErrorBoundary.tsx"),
  "utf8",
);
const drilldownSrc = readFileSync(
  resolve(__dirname, "../components/SummaryDrilldownModal.tsx"),
  "utf8",
);

describe("My Daily Summary — page fills the pane and scrolls", () => {
  it("gives the page its own full-height overflow-y-auto scroller", () => {
    expect(pageSrc).toContain('data-testid="my-daily-summary-page"');
    expect(pageSrc).toMatch(
      /data-testid="my-daily-summary-page"[\s\S]{0,80}h-full min-h-0 overflow-y-auto|h-full min-h-0 overflow-y-auto[\s\S]{0,80}data-testid="my-daily-summary-page"/,
    );
  });

  it("does not clip the page at the module error-boundary wrapper", () => {
    const successWrapper = boundarySrc.match(
      /<div className="([^"]+)">\s*\{this\.props\.children\}/,
    );
    expect(successWrapper?.[1]).toBeTruthy();
    expect(successWrapper![1]).toContain("overflow-y-auto");
    expect(successWrapper![1]).not.toContain("overflow-hidden");
    expect(successWrapper![1]).toContain("h-full");
    expect(successWrapper![1]).toContain("min-h-0");
  });

  it("keeps KPI drilldown content scrollable inside a max-height dialog", () => {
    expect(drilldownSrc).toMatch(
      /DialogContent className="[^"]*max-h-\[85vh\][^"]*min-h-0[^"]*overflow-hidden/,
    );
    expect(drilldownSrc).toContain("overflow-auto flex-1");
  });
});
