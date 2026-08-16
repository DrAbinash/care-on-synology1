import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "advanced-dashboard.ts"), "utf8");

/**
 * REGRESSION: Postgres resolves `ORDER BY alias::numeric` against FROM-clause
 * columns, not SELECT aliases. That produced:
 *   column "gross_billing" does not exist
 * on GET /api/dashboard/advanced-summary (Owner Dashboard modality block).
 * The same class of bug was fixed for total_billing in Jul 2026; this pins
 * both ORDER BY clauses to the underlying aggregate expressions.
 */
describe("advanced-dashboard modality SQL — ORDER BY alias cast", () => {
  test("does not ORDER BY gross_billing::numeric (alias cast)", () => {
    expect(src).not.toMatch(/ORDER BY\s+gross_billing\s*::\s*numeric/i);
  });

  test("orders modality rows by the SUM(price) aggregate expression", () => {
    expect(src).toMatch(
      /ORDER BY\s+COALESCE\(\s*SUM\(\s*ot\.price\s*::\s*numeric\s*\)\s*,\s*0\s*\)\s+DESC/,
    );
  });

  test("staff total_billing ORDER BY still uses aggregate (prior fix)", () => {
    expect(src).not.toMatch(/ORDER BY\s+total_billing\s*::\s*numeric/i);
    expect(src).toMatch(
      /ORDER BY\s+COALESCE\(\s*SUM\(\s*total_amount\s*::\s*numeric\s*\)\s*FILTER/,
    );
  });
});
