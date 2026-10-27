/**
 * Contracts for the Banking fraud-alert table's shape.
 *
 * This package has no DOM harness, so a table's columns cannot be counted by
 * rendering them. They CAN be counted by reading the source — and they should be,
 * because adding a column and forgetting its empty-state `colSpan` produces a table
 * that looks fine until it is empty, at which point the "no alerts" message spans the
 * wrong number of columns and the row is visibly broken. That is a real failure mode
 * of exactly this edit, and nothing else here would notice it.
 *
 * The counts are taken from the JSX itself rather than a character budget, so the
 * test cannot pass by slicing to nothing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "./Banking.tsx"), "utf8");

/** The `<Table>…</Table>` block that renders a given query's rows. */
function tableOf(queryName: string): string {
  const anchor = src.indexOf(`{(${queryName}.data ?? []).map(`);
  expect(anchor, `${queryName} no longer maps rows — the table was restructured`).toBeGreaterThanOrEqual(0);
  const start = src.lastIndexOf("<Table>", anchor);
  const end = src.indexOf("</Table>", anchor);
  expect(start, `${queryName}: no <Table> above the row map`).toBeGreaterThan(0);
  expect(end, `${queryName}: no </Table> below the row map`).toBeGreaterThan(anchor);
  const text = src.slice(start, end);
  expect(text.length, `${queryName}: the slice is empty`).toBeGreaterThan(400);
  return text;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

/**
 * Column count. `<TableHead>` alone under-counts: the last column of every table on
 * this page is `<TableHead className="text-right">Actions</TableHead>`, so a pattern
 * that stops at the `>` reported 7 columns for an 8-column table and made a correct
 * `colSpan={8}` look like the bug. Count the tag, whatever follows it.
 */
const HEAD_RE = /<TableHead[\s>]/g;
const CELL_RE = /<TableCell[\s>]/g;

describe("the fraud alert table says who it happened to", () => {
  const table = tableOf("fraudAlertsQuery");

  it("reads the bill number and the patient out of the payload", () => {
    expect(table).toMatch(/\{a\.billNumber \|\| `#\$\{a\.billId\}`\}/);
    expect(table).toContain("a.patientName");
    expect(table).toContain("<TableHead>Patient</TableHead>");
    // Positive control: the header and the field are asserted together, so deleting
    // one of the two fails here rather than quietly shrinking the table.
    expect(count(table, HEAD_RE)).toBe(8);
    // 8 cells in the row, plus the one cell the empty state owns.
    expect(count(table, CELL_RE)).toBe(9);
  });

  it("gives the empty-state row the same column count as the header", () => {
    const headers = count(table, HEAD_RE);
    const colspan = /colSpan=\{(\d+)\}/.exec(table);
    expect(colspan, "the empty-state row lost its colSpan").not.toBeNull();
    expect(Number(colspan![1]), "colSpan must equal the number of columns").toBe(headers);
  });

  it("shows a dash rather than a blank when an alert is tied to no bill", () => {
    expect(table).toContain('{a.patientName || "—"}');
    expect(table).toMatch(/!a\.billId && !a\.billNumber && !a\.paymentId && "—"/);
  });
});

describe("the refund request table", () => {
  const table = tableOf("refundsQuery");

  it("names the bill and keeps the reason it already showed", () => {
    expect(table).toMatch(/\{r\.billNumber \|\| `#\$\{r\.billId\}`\}/);
    expect(table).toContain("r.reason");
  });

  it("has a header, a row and an empty state that agree", () => {
    const headers = count(table, HEAD_RE);
    const cells = count(table, CELL_RE);
    const colspan = /colSpan=\{(\d+)\}/.exec(table);
    expect(headers).toBe(7);
    expect(cells).toBe(headers + 1);
    expect(Number(colspan![1])).toBe(headers);
  });
});
