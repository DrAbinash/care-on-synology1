/**
 * MyDailySummary.activityLog.test.ts — the activity log has to answer "which bill,
 * whose study, and why did money go back" on the row itself.
 *
 * Two kinds of proof, because this package has no DOM harness: the day-attribution
 * helper is called directly (it is real logic, and exporting it is cheaper than
 * grepping for its arguments), and the rendering is a source contract. Every
 * contract below is paired with a positive control — a check that could pass by
 * matching nothing is not a check, and the refunds row is exactly the place where
 * "the data was there and nobody rendered it" was the bug.
 *
 * The refund table itself lives in `components/RefundActivityTable.tsx`, shared
 * with the Dashboard's control logs. Asserting against that file rather than a
 * copy inside the page is what keeps the two screens from drifting apart again.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { billRaisedOnAnotherDay } from "@/components/RefundActivityTable";

const pageSrc = readFileSync(resolve(__dirname, "./MyDailySummary.tsx"), "utf8");
const tableSrc = readFileSync(
  resolve(__dirname, "../components/RefundActivityTable.tsx"),
  "utf8",
);

/** Slice a panel out of the page by its own comment markers, never by a budget. */
function panel(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + 1);
  expect(start, `${startMarker} is missing — the panel was renamed or deleted`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} is missing — the slice has no end`).toBeGreaterThan(start);
  const text = src.slice(start, end);
  expect(text.length, `${startMarker} sliced to nothing`).toBeGreaterThan(200);
  return text;
}

describe("billRaisedOnAnotherDay — a refund on an old bill says so", () => {
  it("is silent when the bill and the refund share a day", () => {
    expect(billRaisedOnAnotherDay("2026-10-08T04:30:00Z", "2026-10-08T09:00:00Z")).toBeNull();
  });

  it("names the day the bill was raised when they differ", () => {
    // Asserted loosely on the number and the month word: the string is produced by
    // Intl with the en-IN locale, and pinning its exact punctuation would fail on
    // a Node upgrade while saying nothing about correctness.
    const label = billRaisedOnAnotherDay("2026-10-05T06:00:00Z", "2026-10-08T06:00:00Z");
    expect(label).toContain("5");
    expect(String(label).toLowerCase()).toContain("oct");
  });

  it("compares days in the clinic's timezone, not the server's", () => {
    // 19:30Z on 7 Oct is 01:00 IST on 8 Oct — the same reporting day as a refund at
    // 01:00Z (06:30 IST). A UTC day comparison would badge this as an old bill.
    expect(billRaisedOnAnotherDay("2026-10-07T19:30:00Z", "2026-10-08T01:00:00Z")).toBeNull();
    // 19:30Z on 6 Oct is 01:00 IST on 7 Oct, against a refund on 8 Oct IST: old bill.
    expect(billRaisedOnAnotherDay("2026-10-06T19:30:00Z", "2026-10-08T01:00:00Z")).toContain("7");
  });

  it("says nothing rather than guessing on a missing or unreadable date", () => {
    expect(billRaisedOnAnotherDay("", "2026-10-08T06:00:00Z")).toBeNull();
    expect(billRaisedOnAnotherDay("not-a-date", "2026-10-08T06:00:00Z")).toBeNull();
    expect(billRaisedOnAnotherDay("2026-10-05T06:00:00Z", "")).toBeNull();
    expect(billRaisedOnAnotherDay("2026-10-05T06:00:00Z", "not-a-date")).toBeNull();
  });
});

describe("the shared refund table shows what the payload carries", () => {
  it("labels the row with the bill's own number, not its row id", () => {
    expect(tableSrc).toMatch(/\{r\.billNumber \|\| `#\$\{r\.billId\}`\}/);
    expect(tableSrc).toMatch(/href=\{`\/billing\/\$\{r\.billId\}`\}/);
    // Positive control: this is verbatim what the row used to render, so the ban
    // below is a real prohibition and not a pattern that matches nothing.
    const oldRow = '<Link href="/billing/9725" className="text-primary">Bill #{r.billId}</Link>';
    expect(oldRow).toContain("Bill #{r.billId}");
    expect(tableSrc).not.toContain("Bill #{r.billId}");
  });

  it("shows patient, referral doctor, amount, kind, reason, time and who paid it out", () => {
    for (const needle of [
      "r.patientName",
      "r.referringDoctor",
      "inr(Math.abs(Number(r.amount)))",
      "r.method",
      "REFUND_KIND_LABEL[r.refundKind",
      "r.reason",
      "time(r.createdAt)",
      "r.recordedBy",
    ]) {
      expect(tableSrc, `the refund row must show ${needle}`).toContain(needle);
    }
    for (const heading of ["Bill #", "Patient", "Referral doctor", "Refunded", "Reason"]) {
      expect(tableSrc).toContain(heading);
    }
  });

  it("says a reason was never recorded instead of leaving the column blank", () => {
    expect(tableSrc).toContain("no reason recorded");
    expect(tableSrc).toMatch(/r\.reason[\s\S]{0,200}no reason recorded/);
  });

  it("keeps the cancelled-bill and old-bill badges", () => {
    expect(tableSrc).toContain('r.billStatus === "cancelled"');
    expect(tableSrc).toContain("billRaisedOnAnotherDay(r.billCreatedAt, r.createdAt)");
  });
});

describe("both activity screens mount that one table", () => {
  const dashboardSrc = readFileSync(resolve(__dirname, "./Dashboard.tsx"), "utf8");

  it("My Daily Summary and the Dashboard render the same component, not copies", () => {
    expect(pageSrc).toMatch(/<RefundActivityTable refunds=\{refunds\} testId="activity-refunds-table" \/>/);
    expect(dashboardSrc).toMatch(/<RefundActivityTable[\s\S]{0,120}testId="dashboard-refunds-table"/);
    // Positive control for the ban: a screen that re-invented the row would still
    // be able to print the row id, which is the defect this whole change is about.
    expect(pageSrc).not.toMatch(/tab === "refunds"[\s\S]{0,400}Bill #\{/);
    expect(dashboardSrc).not.toMatch(/tab === "refunds"[\s\S]{0,400}Bill #\{/);
  });
});

describe("the Cancellations tab stops discarding the patient and the doctor", () => {
  const cancellations = panel(pageSrc, "{/* Cancellations — list */}", "{/* Refunds — the shared table");

  it("shows who the cancelled bill belonged to", () => {
    expect(cancellations).toContain("c.patientName");
    expect(cancellations).toContain("c.referringDoctor");
    expect(cancellations).toContain("No referral");
    // Positive control: the payload has carried both for this whole time.
    expect(pageSrc).toMatch(/patientName\?: string;\s*\n\s*referringDoctor\?: string \| null;\s*\n\s*cancelledAt: string;/);
  });
});

describe("Payments Collected by Me — the same rule for money coming in", () => {
  const box = panel(pageSrc, '{/* Secondary boxes — collapsible', "{data && data.bills.length > 0 && (");

  it("names the bill, the patient and the referral on the row", () => {
    expect(box).toContain("{p.billNumber}");
    expect(box).toContain("p.patientName");
    expect(box).toContain("p.referringDoctor");
    expect(box).toContain("No referral");
    // Positive control: this is the line as it was — a row id and a timestamp, with
    // the patient and the doctor left in the payload.
    const oldRow = '<Link href={`/billing/${p.billId}`}>Bill #{p.billId}</Link>';
    expect(oldRow).toContain("Bill #{p.billId}");
    expect(box).not.toContain("Bill #{p.billId}");
  });

  it("says when today's collection pays a bill raised on an earlier day", () => {
    // billCreatedAt was already in the payload and used by nothing.
    expect(box).toContain("billRaisedOnAnotherDay(p.billCreatedAt, p.createdAt)");
  });

  it("the server sends those fields, and the page's type admits them", () => {
    const apiSrc = readFileSync(
      resolve(__dirname, "../../../api-server/src/routes/my-daily-summary.ts"),
      "utf8",
    );
    const paymentsPayload = apiSrc.slice(
      apiSrc.indexOf("payments: paymentItems.map("),
      apiSrc.indexOf("suspensePayments:"),
    );
    expect(paymentsPayload.length).toBeGreaterThan(100);
    for (const field of ["billNumber:", "patientName:", "referringDoctor:"]) {
      expect(paymentsPayload, `the payments payload must carry ${field}`).toContain(field);
    }
    expect(pageSrc).toMatch(/payments: \{[\s\S]{0,260}billNumber: string;/);
  });
});
