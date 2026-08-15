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

  test("Clinic Systems panel has a USG ERP pipeline pause switch", () => {
    expect(src).toContain('data-testid="usg-erp-pipeline-switch"');
    expect(src).toContain('api.put("/api/usg-extraction/settings", { pipelineEnabled })');
    expect(src).toContain("Do not stop sending from the USG machine");
  });

  test("dense desktop ribbon + grid layout markers (no orange ICICI branding)", () => {
    expect(src).toContain('data-testid="clinic-systems-health-ribbon"');
    expect(src).toContain("xl:grid-cols-4");
    expect(src).toContain("buildDs225PulsePill");
    expect(src).not.toContain("ORANGE_OK_DOT");
    expect(src).not.toContain("bg-orange-500");
    expect(src).not.toContain('accent === "orange"');
    // Same ops/emergency queries as before — no extra polling endpoints.
    expect(src).toContain("/api/admin/operations/health?includeOptional=1&timeout=4500");
    expect(src).toContain("/api/emergency-billing/status");
    expect(src).toContain("refetchInterval: 90_000");
  });
});
