import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Regression: Clinic Systems hover panels used `pointer-events-none`, so the
 * "Open settings" link could appear on hover but was unreachable with the mouse.
 */
describe("InfrastructurePulseStrip hover panel", () => {
  const src = readFileSync(
    new URL("./InfrastructurePulseStrip.tsx", import.meta.url),
    "utf8",
  );

  test("Open settings link is mouse-reachable (interactive panel + close delay)", () => {
    expect(src).toContain('data-testid={`clinic-systems-open-settings-${pill.key}`}');
    expect(src).toContain("PANEL_CLOSE_DELAY_MS");
    expect(src).toContain("onMouseEnter={openPanel}");
    expect(src).toContain("onMouseLeave={scheduleClosePanel}");
    // Hover bridge must use padding (pt-1), not margin-only gap.
    expect(src).toContain("min-w-[14rem] max-w-xs pt-1");
    expect(src).toContain('data-testid={`clinic-systems-pill-panel-${pill.key}`}');
    const panelClassMatch = src.match(
      /className=\{`absolute left-0 top-full z-20[^`]*`\}/,
    );
    expect(panelClassMatch?.[0] ?? "").not.toContain("pointer-events-none");
  });

  test("status pills with detailsHref are themselves links (click without hovering)", () => {
    expect(src).toContain("{pill.detailsHref ? (");
    expect(src).toContain("<Link href={pill.detailsHref}");
  });
});
