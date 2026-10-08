/**
 * Source contract for the two Banking lists that used to print a bill's row id.
 *
 * The runtime behaviour is pinned by banking.billNumber.request.test.ts, which needs
 * PostgreSQL and therefore only runs in CI. What CAN be checked here, on any box, is
 * the two ways this change could silently fail:
 *  - the bill number is fetched by an INNER join, so a payment whose bill row is gone
 *    disappears from a list that totals money;
 *  - `db.select()` was replaced by an explicit column list and a column was dropped,
 *    which deletes a table's contents from the UI without any error.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSrc = readFileSync(resolve(__dirname, "./banking.ts"), "utf8");

/** Slice from a marker to the next top-level route, bounded on syntax not length. */
function routeBody(marker: string): string {
  const start = routeSrc.indexOf(marker);
  expect(start, `${marker} is gone — the route was renamed or deleted`).toBeGreaterThanOrEqual(0);
  const rest = routeSrc.slice(start + marker.length);
  const end = rest.search(/\nrouters?\.(get|post|patch|put|delete)\(|\n\/\/ ---- /);
  const body = end === -1 ? rest : rest.slice(0, end);
  expect(body.length, `${marker} sliced to nothing`).toBeGreaterThan(60);
  return body;
}

describe("GET /fraud/alerts", () => {
  const body = routeBody('router.get("/fraud/alerts"');

  it("reads the bill number and the patient, and reaches the bill through the payment when needed", () => {
    expect(body).toContain("billNumber: billsTable.billNumber");
    expect(body).toContain("patientFirstName: patientsTable.firstName");
    expect(body).toContain("patientName: patientFirstName");
    // Alerts name a bill OR the payment they flagged; COALESCE is the whole point.
    expect(body).toMatch(/COALESCE\(\s*\$\{fraudAlertsTable\.billId\},\s*\$\{paymentsTable\.billId\}\s*\)/);
    expect(body).toMatch(/leftJoin\(\s*paymentsTable,\s*eq\(fraudAlertsTable\.paymentId,\s*paymentsTable\.id\)\s*\)/);
    expect(body).toMatch(/leftJoin\(\s*billsTable,/);
    expect(body).toMatch(/leftJoin\(\s*patientsTable,\s*eq\(billsTable\.patientId,\s*patientsTable\.id\)\s*\)/);
    expect(body).not.toMatch(/innerJoin\(/);
    // Positive control for the two bans above: the defective shapes really do match.
    expect('await db.select().from(t).innerJoin(billsTable, eq(t.billId, billsTable.id))').toMatch(/innerJoin\(/);
    expect("sql`${billsTable.id} = COALESCE(${fraudAlertsTable.billId}, ${paymentsTable.billId})`")
      .toMatch(/COALESCE\(\s*\$\{fraudAlertsTable\.billId\},\s*\$\{paymentsTable\.billId\}\s*\)/);
  });

  it("keeps every alert column while adding two", () => {
    // Without the spread, `db.select({ billNumber })` would return only that field
    // and the table would render blank rows.
    expect(body).toMatch(/\.\.\.getTableColumns\(fraudAlertsTable\)/);
    expect(
      /\.\.\.getTableColumns\(fraudAlertsTable\)/.test('db.select({ billNumber: billsTable.billNumber })'),
    ).toBe(false);
  });

  it("never sends a patient identifier that the alert cannot be tied to a bill for", () => {
    // The name comes from bills → patients, so an alert with no bill must yield null
    // rather than a name invented from some other row. Reading the join order is the
    // only way to check this without a database.
    expect(body).toMatch(/patientName: patientFirstName\s*\?\s*`\$\{patientFirstName\} \$\{patientLastName \?\? ""\}`\.trim\(\)\s*:\s*null/);
  });
});

describe("GET /refunds", () => {
  const body = routeBody('router.get("/refunds"');

  it("reads the bill number with a left join and keeps the request's columns", () => {
    expect(body).toContain("billNumber: billsTable.billNumber");
    expect(body).toMatch(/leftJoin\(\s*billsTable,\s*eq\(refundRequestsTable\.billId,\s*billsTable\.id\)\s*\)/);
    expect(body).not.toMatch(/innerJoin\(/);
    expect(body).toMatch(/\.\.\.getTableColumns\(refundRequestsTable\)/);
  });
});
