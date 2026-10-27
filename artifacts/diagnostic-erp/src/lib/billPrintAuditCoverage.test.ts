/**
 * Corridor audit F2 — every print of an already-issued bill is audited.
 *
 * Measured before the fix: BillDetail had three print paths and only one of
 * them logged. The billing-list print icon (?print=1 auto-print) and the
 * Print & Send button both rendered a receipt with no /reprint-log call, no
 * reason, and no audit row — an unlimited, untraceable paper trail for any
 * staff session. The modal (Re-print → reason → Log & Print) was the only
 * audited door.
 *
 * These are grep guards on purpose: the fault they prevent is "a print call
 * site exists that skips the audit", which is a property of which function
 * the button calls — not runtime behaviour we can reach without a browser.
 * The same style as reportPrintRoute.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BILL_DETAIL = readFileSync(
  resolve(__dirname, "../pages/BillDetail.tsx"),
  "utf8",
);
const BILLING_DESK = readFileSync(
  resolve(__dirname, "../pages/BillingDesk.tsx"),
  "utf8",
);
const BILLING_LIST = readFileSync(
  resolve(__dirname, "../pages/Billing.tsx"),
  "utf8",
);

describe("the two shortcut print paths are audited reprints (corridor audit F2)", () => {
  it("printAudited logs before it prints, and a log failure never blocks the print", () => {
    // The helper must await the audit POST first, swallow its failure (the
    // user has already chosen to print — the same contract submitReprint has
    // always had), and only then render the receipt into the print iframe.
    expect(BILL_DETAIL).toMatch(
      /const printAudited = async \(reason: string\) => \{[\s\S]*?await reprintLog\.mutateAsync\(\{ reprintedBy: by, reason \}\);[\s\S]*?catch \(e\) \{[\s\S]*?console\.error\("Reprint log failed:", e\);[\s\S]*?\}[\s\S]*?if \(html\) printViaIframe\(html\);/,
    );
  });

  it("the ?print=1 auto-print path goes through the audit helper", () => {
    expect(BILL_DETAIL).toContain(
      "void printAudited(BILL_PRINT_REASONS.listLink)",
    );
    // The one-shot guard still stands: the auto-print must fire exactly once
    // per tab (no duplicate audit rows under re-render).
    expect(BILL_DETAIL).toMatch(
      /autoPrintedRef\.done = true;[\s\S]*?void printAudited\(BILL_PRINT_REASONS\.listLink\)/,
    );
    expect(BILL_DETAIL).toContain("if (autoPrintedRef.done) return;");
  });

  it("the Print & Send button goes through the audit helper with its own reason", () => {
    expect(BILL_DETAIL).toContain(
      "void printAudited(BILL_PRINT_REASONS.printAndSend)",
    );
  });

  it("printViaIframe has exactly one execution site — inside the audited helper", () => {
    // The modal prints through the popup path (openBlankPrintWindow +
    // writeAndPrint), so a second printViaIframe( call would mean someone
    // added a fresh unaudited iframe print. Comments reference the name
    // without parentheses, so this count is execution sites.
    const sites = BILL_DETAIL.match(/printViaIframe\(/g) ?? [];
    expect(sites.length).toBe(1);
  });

  it("the preset reasons are audit-grade, non-empty strings", () => {
    // The server schema requires reason min(1); a blank preset would 400 the
    // log POST (and then silently swallow it) — the audit row would vanish
    // while the print still happened.
    const block = BILL_DETAIL.match(
      /const BILL_PRINT_REASONS = \{([\s\S]*?)\} as const;/,
    );
    expect(block).not.toBeNull();
    const reasons = block![1].match(/: "([^"]+)"/g) ?? [];
    expect(reasons.length).toBe(2);
    for (const r of reasons) {
      expect(r.length).toBeGreaterThan(': ""'.length);
    }
    expect(block![1]).toContain("Printed from");
  });

  it("the modal's user-typed reason flow is unchanged", () => {
    // Legitimate reprints keep their dialog: by + preset reason + optional
    // note, logged with the user's words — not the preset shortcut strings.
    expect(BILL_DETAIL).toMatch(
      /await reprintLog\.mutateAsync\(\{ reprintedBy: by, reason: why \}\)/,
    );
    expect(BILL_DETAIL).toContain(
      "disabled={!reprintBy.trim() || !reprintReason.trim()",
    );
  });
});

describe("legitimate first-print behaviour is preserved (corridor audit F2)", () => {
  it("the billing desk creation-time print is not a reprint and stays unaudited", () => {
    // Printing at bill creation is issuance, not a reprint — there is no
    // prior paper to account for. If this guard ever fails, someone added a
    // /reprint-log call to the issuance flow and every first receipt now
    // writes a spurious audit row (and an admin email).
    expect(BILLING_DESK).not.toContain("reprint-log");
    expect(BILLING_DESK).not.toContain("printAudited");
  });

  it("the billing list print shortcut still exists — same one-click UX, now audited", () => {
    expect(BILLING_LIST).toContain("?print=1");
  });
});
