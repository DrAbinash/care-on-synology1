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

describe("My Daily Summary — secondary boxes sit below Discounts Given", () => {
  it("collapses payments, bills, inventory, imaging, and peak boxes by default after discounts", () => {
    expect(pageSrc).toContain("function SummaryCollapsibleBox");
    expect(pageSrc).toContain("const [open, setOpen] = useState(false)");

    const moneyFlow = pageSrc.indexOf("Money flow");
    const discounts = pageSrc.indexOf("Discounts Given — detailed table");
    const payments = pageSrc.indexOf('title="Payments Collected by Me"');
    const bills = pageSrc.indexOf('title="Bills Created by Me"');
    const inventory = pageSrc.indexOf('title="Inventory"');
    const imagingVsPacs = pageSrc.indexOf('title="Imaging vs PACS"');
    const imagingBilled = pageSrc.indexOf('title="Imaging Billed"');
    const peak = pageSrc.indexOf('title="Clinic Peak / Billing Lane"');

    expect(discounts).toBeGreaterThan(moneyFlow);
    expect(payments).toBeGreaterThan(discounts);
    expect(bills).toBeGreaterThan(payments);
    expect(inventory).toBeGreaterThan(bills);
    expect(imagingVsPacs).toBeGreaterThan(inventory);
    expect(imagingBilled).toBeGreaterThan(imagingVsPacs);
    expect(peak).toBeGreaterThan(imagingBilled);
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
