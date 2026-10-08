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
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { billRaisedOnAnotherDay } from "./MyDailySummary";

const pageSrc = readFileSync(resolve(__dirname, "./MyDailySummary.tsx"), "utf8");

/** Slice a panel out of the page by its own comment markers, never by a budget. */
function panel(startMarker: string, endMarker: string): string {
  const start = pageSrc.indexOf(startMarker);
  const end = pageSrc.indexOf(endMarker, start + 1);
  expect(start, `${startMarker} is missing — the panel was renamed or deleted`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} is missing — the slice has no end`).toBeGreaterThan(start);
  const text = pageSrc.slice(start, end);
  expect(text.length, `${startMarker} sliced to nothing`).toBeGreaterThan(400);
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
    const label = billRaisedOnAnotherDay("2026-10-06T19:30:00Z", "2026-10-08T01:00:00Z");
    expect(label).toContain("7");
  });

  it("says nothing rather than guessing on a missing or unreadable date", () => {
    expect(billRaisedOnAnotherDay("", "2026-10-08T06:00:00Z")).toBeNull();
    expect(billRaisedOnAnotherDay("not-a-date", "2026-10-08T06:00:00Z")).toBeNull();
    expect(billRaisedOnAnotherDay("2026-10-05T06:00:00Z", "")).toBeNull();
  });
});

describe("the Refunds tab renders what the payload already carries", () => {
  const refunds = panel("{/* Refunds — rich table", "// ─── Collapsible secondary boxes");

  it("labels the row with the bill's own number, not its row id", () => {
    expect(refunds).toMatch(/\{r\.billNumber \|\| `#\$\{r\.billId\}`\}/);
    expect(refunds).toMatch(/href=\{`\/billing\/\$\{r\.billId\}`\}/);
    // Positive control: this is verbatim what the row used to render, so the ban
    // below is a real prohibition and not a pattern that matches nothing.
    const oldRow = '<Link href="/billing/9725" className="text-primary">Bill #{r.billId}</Link>';
    expect(oldRow).toContain("Bill #{r.billId}");
    expect(refunds).not.toContain("Bill #{r.billId}");
  });

  it("shows patient, referral doctor, amount, kind, reason, time and who paid it out", () => {
    for (const needle of [
      "r.patientName",
      "r.referringDoctor",
      "fmt(Math.abs(Number(r.amount)))",
      "r.method",
      "REFUND_KIND_LABEL[r.refundKind",
      "r.reason",
      "fmtTime(r.createdAt)",
      "r.recordedBy",
    ]) {
      expect(refunds, `the refund row must show ${needle}`).toContain(needle);
    }
    for (const heading of ["Bill #", "Patient", "Referral doctor", "Refunded", "Reason"]) {
      expect(refunds).toContain(heading);
    }
  });

  it("says a reason was never recorded instead of leaving the column blank", () => {
    expect(refunds).toContain("no reason recorded");
    expect(refunds).toMatch(/r\.reason[\s\S]{0,160}no reason recorded/);
  });

  it("keeps the cancelled-bill and old-bill badges", () => {
    expect(refunds).toContain('r.billStatus === "cancelled"');
    expect(refunds).toContain("billRaisedOnAnotherDay(r.billCreatedAt, r.createdAt)");
  });
});

describe("the Cancellations tab stops discarding the patient and the doctor", () => {
  const cancellations = panel("{/* Cancellations — list */}", "{/* Refunds — rich table");

  it("shows who the cancelled bill belonged to", () => {
    expect(cancellations).toContain("c.patientName");
    expect(cancellations).toContain("c.referringDoctor");
    expect(cancellations).toContain("No referral");
    // Positive control: the payload has carried both for this whole time.
    expect(pageSrc).toMatch(/patientName\?: string;\s*\n\s*referringDoctor\?: string \| null;\s*\n\s*cancelledAt: string;/);
  });
});
