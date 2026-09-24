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
      /data-testid="my-daily-summary-page"[\s\S]{0,80}h-full min-h-0 overflow-y-auto overflow-x-hidden|h-full min-h-0 overflow-y-auto overflow-x-hidden[\s\S]{0,80}data-testid="my-daily-summary-page"/,
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

describe("My Daily Summary — dated finance cluster sits under filters", () => {
  it("orders Clinic systems → date/staff → money flow → imaging → drawer close", () => {
    expect(pageSrc).toContain('title="Imaging & Pathology Billed"');
    expect(pageSrc).toContain('data-testid="imaging-billed-summary"');
    expect(pageSrc).toContain("Finance cluster (directly under date/staff filters)");
    expect(pageSrc).toContain("Drawer actions (below finance — Close My Drawer lives here)");

    const imagingBlock = pageSrc.slice(
      pageSrc.indexOf('title="Imaging & Pathology Billed"'),
      pageSrc.indexOf('title="Imaging & Pathology Billed"') + 900,
    );
    expect(imagingBlock).not.toMatch(/defaultOpen\b/);

    const datePicker = pageSrc.indexOf("Date Range Picker");
    const moneyFlow = pageSrc.indexOf("Money flow");
    const financialDetails = pageSrc.indexOf("Financial Details");
    const recon = pageSrc.indexOf("<UnifiedReconciliationPanel");
    const imagingBilled = pageSrc.indexOf('title="Imaging & Pathology Billed"');
    const drawerActions = pageSrc.indexOf("Drawer actions (below finance");
    const imagingVsPacs = pageSrc.indexOf('title="Imaging vs PACS"');
    const pageHeaderClose = pageSrc.indexOf("<PageHeader");
    const pulse = pageSrc.indexOf("{isOwner && <InfrastructurePulseStrip");
    const headerSlice = pageSrc.slice(pageHeaderClose, pulse);

    expect(pulse).toBeGreaterThan(pageHeaderClose);
    expect(headerSlice).not.toContain("Close My Drawer");
    expect(datePicker).toBeGreaterThan(pulse);
    expect(moneyFlow).toBeGreaterThan(datePicker);
    expect(financialDetails).toBeGreaterThan(moneyFlow);
    expect(recon).toBeGreaterThan(financialDetails);
    expect(imagingBilled).toBeGreaterThan(recon);
    expect(drawerActions).toBeGreaterThan(imagingBilled);
    expect(imagingVsPacs).toBeGreaterThan(drawerActions);
  });
});

describe("My Daily Summary — secondary boxes sit below Discounts Given", () => {
  it("collapses payments, bills, inventory, imaging-vs-pacs, and peak boxes by default after discounts", () => {
    expect(pageSrc).toContain("function SummaryCollapsibleBox");
    expect(pageSrc).toContain("const [open, setOpen] = useState(defaultOpen)");

    const moneyFlow = pageSrc.indexOf("Money flow");
    const discounts = pageSrc.indexOf("Discounts Given — detailed table");
    const payments = pageSrc.indexOf('title="Payments Collected by Me"');
    const bills = pageSrc.indexOf('title="Bills Created by Me"');
    const inventory = pageSrc.indexOf('title="Inventory"');
    const imagingVsPacs = pageSrc.indexOf('title="Imaging vs PACS"');
    const peak = pageSrc.indexOf('title="Clinic Peak / Billing Lane"');

    expect(discounts).toBeGreaterThan(moneyFlow);
    expect(payments).toBeGreaterThan(discounts);
    expect(bills).toBeGreaterThan(payments);
    expect(inventory).toBeGreaterThan(bills);
    expect(imagingVsPacs).toBeGreaterThan(inventory);
    expect(peak).toBeGreaterThan(imagingVsPacs);
  });
});

describe("My Daily Summary — recon row expanders mirror Discounts Given", () => {
  it("exposes expandable drilldowns for dues, cancel, refund, outstanding, expenses", () => {
    expect(pageSrc).toContain("function ExpandableReconRow");
    expect(pageSrc).toContain('data-testid={`recon-expand-${slug}`}');
    for (const label of [
      "Old Dues Collected",
      "Cancelled Bills",
      "Refunds",
      "Outstanding Dues",
      "Cash Expenses",
    ]) {
      expect(pageSrc).toContain(`label="${label}"`);
    }
    expect(pageSrc).toContain("byReferralTitle=\"By Category\"");
    expect(pageSrc).toContain("cashExpenseItems={data.cashExpenseItems ?? []}");
    expect(pageSrc).toContain("duesBills={data.duesBills}");
    expect(pageSrc).toContain("cancelledByMe={data.cancelledByMe}");
  });
});
