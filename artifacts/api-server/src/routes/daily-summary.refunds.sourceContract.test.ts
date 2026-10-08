/**
 * Source contract for /api/daily-summary's payment and refund payloads.
 *
 * The screens that read them (Dashboard control logs, the Daily Summary report) now
 * render bill number, patient, referral doctor and the refund's reason, all of which
 * come from joining bills → patients → orders → doctors onto the payment rows.
 * Those payment rows are also the input to every cash figure on the page, so the
 * join has exactly one acceptable shape:
 *
 *   LEFT joins, each onto a primary key.
 *
 * An INNER join would silently drop a payment whose bill row is missing and change
 * the day's totals; a join onto a non-unique key would duplicate a payment and
 * double-count it. Neither is visible in the UI — the drawer would simply be wrong.
 *
 * The runtime side of this is daily-summary.refundDetails.request.test.ts, which
 * asserts the totals against PostgreSQL and only runs in CI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSrc = readFileSync(resolve(__dirname, "./daily-summary.ts"), "utf8");

function queryFrom(marker: string): string {
  const start = routeSrc.indexOf(marker);
  expect(start, `${marker} is gone`).toBeGreaterThanOrEqual(0);
  const rest = routeSrc.slice(start);
  const end = rest.indexOf(".limit(");
  expect(end, `${marker} has no .limit( — the slice has no end`).toBeGreaterThan(0);
  const body = rest.slice(0, end + ".limit(0)".length);
  expect(body.length).toBeGreaterThan(200);
  return body;
}

describe("the payment query that feeds the refund and suspense lists", () => {
  const q = queryFrom("const allPaymentItems = await db");

  it("joins every table LEFT, never INNER", () => {
    for (const table of ["billsTable", "patientsTable", "ordersTable", "doctorsTable"]) {
      expect(q, `must leftJoin ${table}`).toMatch(new RegExp(`leftJoin\\(\\s*${table},`));
    }
    expect(q).not.toMatch(/innerJoin\(/);
    // Positive control: the ban is a ban only if the shape it forbids would match.
    expect("db.select().from(paymentsTable).innerJoin(billsTable, eq(paymentsTable.billId, billsTable.id))")
      .toMatch(/innerJoin\(/);
  });

  it("joins each hop on the other side's primary key", () => {
    expect(q).toMatch(/leftJoin\(\s*billsTable,\s*eq\(paymentsTable\.billId,\s*billsTable\.id\)\s*\)/);
    expect(q).toMatch(/leftJoin\(\s*patientsTable,\s*eq\(billsTable\.patientId,\s*patientsTable\.id\)\s*\)/);
    expect(q).toMatch(/leftJoin\(\s*ordersTable,\s*eq\(billsTable\.orderId,\s*ordersTable\.id\)\s*\)/);
    expect(q).toMatch(/leftJoin\(\s*doctorsTable,\s*eq\(ordersTable\.doctorId,\s*doctorsTable\.id\)\s*\)/);
  });

  it("selects the facts the screens render", () => {
    for (const field of [
      "billNumber: billsTable.billNumber",
      "billCreatedAt: billsTable.createdAt",
      "billStatus: billsTable.status",
      "patientFirstName: patientsTable.firstName",
      "referringDoctor: doctorsTable.name",
    ]) {
      expect(q, `the query must read ${field}`).toContain(field);
    }
  });
});

describe("the refunds payload", () => {
  const start = routeSrc.indexOf("refunds: refundItems.map(");
  const payload = routeSrc.slice(start, routeSrc.indexOf("cancelledBillsDetail:", start));

  it("sends number, patient, doctor, kind and reason — and the row id too, as a fallback only", () => {
    expect(payload.length).toBeGreaterThan(150);
    for (const field of [
      "billNumber:", "patientName:", "referringDoctor:", "billStatus:", "refundKind:", "reason:", "billCreatedAt:",
    ]) {
      expect(payload, `the refund payload must carry ${field}`).toContain(field);
    }
    // The reason has one owner for its note vocabulary; a second parser would drift.
    expect(routeSrc).toContain("describeRefundNote(p.notes)");
    expect(routeSrc).toMatch(/import \{[\s\S]{0,200}describeRefundNote[\s\S]{0,200}\} from "\.\.\/lib\/dailySummaryCollectible"/);
  });

  it("the suspense bucket names its bill too", () => {
    const s = routeSrc.slice(
      routeSrc.indexOf("suspensePayments: ["),
      routeSrc.indexOf("bills: allBillRows.map("),
    );
    expect(s.length).toBeGreaterThan(80);
    expect(s).toContain("billNumber: p.billNumber ?? null");
  });
});
