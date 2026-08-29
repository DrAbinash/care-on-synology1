import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

const pagesDir = resolve(__dirname);
const componentsDir = resolve(__dirname, "../components");

function read(rel: string) {
  return readFileSync(resolve(__dirname, rel), "utf8");
}

/** Pages explicitly hardened in the care-mobile-scroll patch series. */
const PATCH_HARDENED_PAGES = [
  "Accounting.tsx",
  "BillDetail.tsx",
  "BillingDesk.tsx",
  "DailySummary.tsx",
  "DayClose.tsx",
  "Doctors.tsx",
  "OrderDetail.tsx",
  "PatientDetail.tsx",
  "Staff.tsx",
];

const SCROLL_WRAPPER_RE = /overflow-x-auto|overflow-auto|touch-pan-x|<MobileTableScroll/;

function listPageFiles(): string[] {
  return readdirSync(pagesDir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
}

function wideTablesLackingScrollWrapper(src: string, file: string): string[] {
  const issues: string[] = [];
  const tableRe = /<table\b/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 800), m.index);
    const after = src.slice(m.index, m.index + 1200);
    // Print/export HTML templates (not rendered in the ERP scroll shell).
    if (/class="table"/.test(after.slice(0, 80))) continue;
    const isWide =
      /min-w-\[[^\]]+\]/.test(after) ||
      (after.match(/<th\b/g)?.length ?? 0) >= 7;
    if (!isWide) continue;
    if (SCROLL_WRAPPER_RE.test(before)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    issues.push(`${file}:${line}`);
  }
  return issues;
}

describe("mobile scroll — shell components", () => {
  it("Layout main allows horizontal scroll (does not clip wide tables)", () => {
    const layout = read("../components/Layout.tsx");
    expect(layout).toMatch(
      /<main className="[^"]*overflow-x-auto[^"]*"/,
    );
    expect(layout).toMatch(/<main className="[^"]*min-w-0[^"]*"/);
  });

  it("ModuleErrorBoundary allows horizontal scroll on success path", () => {
    const boundary = read("../components/ModuleErrorBoundary.tsx");
    const wrapper = boundary.match(
      /<div className="([^"]+)">\s*\{this\.props\.children\}/,
    );
    expect(wrapper?.[1]).toContain("overflow-y-auto");
    expect(wrapper?.[1]).toContain("overflow-x-auto");
    expect(wrapper?.[1]).toContain("min-w-0");
    expect(wrapper?.[1]).not.toContain("overflow-x-hidden");
  });

  it("Dialog and AlertDialog scroll tall forms on mobile", () => {
    for (const file of ["../components/ui/dialog.tsx", "../components/ui/alert-dialog.tsx"]) {
      const src = read(file.replace("../components/", "../components/"));
      expect(src).toContain("max-h-[min(90dvh,100%)]");
      expect(src).toContain("overflow-y-auto");
    }
  });
});

describe("mobile scroll — patch-hardened pages", () => {
  it.each(PATCH_HARDENED_PAGES)("%s has no page-root overflow-x-hidden", (file) => {
    const src = read(`./${file}`);
    // BillingDesk intentionally keeps overflow-x-hidden below lg for vertical page scroll.
    if (file === "BillingDesk.tsx") {
      expect(src).toContain("overflow-y-auto overflow-x-hidden lg:overflow-hidden");
      return;
    }
    expect(src).not.toMatch(
      /return\s*\(\s*<div[^>]*overflow-x-hidden/,
    );
  });

  it.each(
    PATCH_HARDENED_PAGES.filter((f) =>
      ["DayClose.tsx", "Staff.tsx", "Accounting.tsx", "BillDetail.tsx"].includes(f),
    ),
  )("%s wraps wide tables with touch-pan-x horizontal scroll", (file) => {
    const src = read(`./${file}`);
    expect(src).toContain("touch-pan-x");
    expect(src).toContain("overflow-x-auto");
  });

  it("BillingDesk uses single vertical scroll on mobile", () => {
    const src = read("./BillingDesk.tsx");
    expect(src).toContain("overflow-y-auto overflow-x-hidden lg:overflow-hidden");
    expect(src).toContain("lg:overflow-hidden");
    expect(src).toMatch(/lg:flex-1 lg:min-h-0 lg:overflow-y-auto/);
  });
});

describe("mobile scroll — all ERP pages with wide tables", () => {
  const allowlist = new Set([
    "MyDayClose.tsx:803",
    "RadiologyWorklist.tsx",
    "RadiologyReportingWorkspace.tsx",
    // Admin / settings mega-pages — tracked backlog (shell fix unblocks most).
    "Settings.tsx",
    "Reports.tsx",
    "Machines.tsx",
    "Inventory.tsx",
    "FormF.tsx",
  ]);

  const criticalPages = new Set([
    ...PATCH_HARDENED_PAGES,
    "Expenses.tsx",
    "Patients.tsx",
    "Orders.tsx",
    "Payments.tsx",
    "Dues.tsx",
    "MyDayClose.tsx",
    "Tests.tsx",
    "AcquisitionGateway.tsx",
    "AiPipelineManager.tsx",
    "AiAuditLog.tsx",
    "AiPipelineManager.tsx",
    "AiPromptEffectiveness.tsx",
    "AiQualityScores.tsx",
    "HRForms.tsx",
    "MwlManager.tsx",
    "ReportHub.tsx",
    "StorageLifecycle.tsx",
    "Billing.tsx",
    "Dashboard.tsx",
    "OnlineBookings.tsx",
    "OperationalHealth.tsx",
    "OutsourceLedger.tsx",
    "OutsourceWorklist.tsx",
    "OutsourcedCostReport.tsx",
    "PacsArchiveLifecycle.tsx",
    "PathologyRegistry.tsx",
    "Samples.tsx",
    "MeasurementRegistryManager.tsx",
    "MwlDashboard.tsx",
    "NetworkControlCenter.tsx",
    "DicomNodes.tsx",
    "RadiologyLegacy.tsx",
  ]);

  const pageFiles = listPageFiles();
  const failures: string[] = [];
  const criticalFailures: string[] = [];

  for (const file of pageFiles) {
    const src = readFileSync(join(pagesDir, file), "utf8");
    for (const issue of wideTablesLackingScrollWrapper(src, file)) {
      const key = issue;
      const fileOnly = file;
      if (allowlist.has(key) || allowlist.has(fileOnly)) continue;
      failures.push(issue);
      if (criticalPages.has(file)) criticalFailures.push(issue);
    }
  }

  it("critical ERP pages: every wide <table> has a horizontal scroll wrapper", () => {
    expect(
      criticalFailures,
      `Critical wide tables missing horizontal scroll wrapper:\n${criticalFailures.join("\n")}`,
    ).toEqual([]);
  });

  it("full audit backlog count stays bounded", () => {
    // Settings/Reports/Machines/Inventory/FormF are allowlisted; this guards regressions elsewhere.
    expect(failures.length).toBeLessThanOrEqual(0);
  });
});

describe("mobile scroll — page roots must not clip horizontally", () => {
  const allowedOverflowXHidden = new Set([
    "BillingDesk.tsx", // mobile vertical scroll only; lg split panes
    "MyDailySummary.tsx", // inner page scroller; boundary allows x-scroll
  ]);

  const offenders: string[] = [];
  for (const file of listPageFiles()) {
    if (allowedOverflowXHidden.has(file)) continue;
    const src = readFileSync(join(pagesDir, file), "utf8");
    if (/className="[^"]*overflow-x-hidden/.test(src)) {
      offenders.push(file);
    }
  }

  it("no page root uses overflow-x-hidden (except allowlisted)", () => {
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
