/**
 * Every column the Drizzle schema declares must be created by the migration chain.
 * ==========================================================================
 * This asserts the class of defect, not one instance of it.
 * `radiology_image_references.presentation_json`, the three Composer Apply columns, the
 * eight radiology reporting columns and both `purchase_invoices` tables were all declared
 * in lib/db/src/schema/*.ts, all written by route code, and created by no migration. Each
 * one turned an ordinary request into an HTTP 500 on the database the clinic actually
 * builds — `care-db-patch-v2` applies migrations/*.sql and never pushes the Drizzle
 * schema — and none of them were visible in a test: the unit suites mock row shapes, and
 * the API only self-heals the columns it happens to ALTER at boot.
 *
 * So the check runs against a real database built the real way, which is what CI's
 * `pnpm db:smoke` + `pnpm db:bootstrap` leave DATABASE_URL pointing at. It reads the
 * expected columns through drizzle's own table metadata rather than a hand-kept list,
 * because a list of expected columns is precisely the thing that goes stale when someone
 * adds one.
 *
 * The reverse direction (a column in the database that the schema does not declare) is
 * deliberately NOT asserted: production carries such columns, and dropping one to reach
 * parity is a data-loss migration, not a fix.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { getTableColumns } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./index";

const dbUrl = process.env.DATABASE_URL;

describe.skipIf(!dbUrl)("the schema routes use is the schema migrations build", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it("creates every declared column of every declared table", async () => {
    const declared = new Map<string, string[]>();
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const columns = Object.values(getTableColumns(value as never)).map((c) => (c as { name: string }).name);
      declared.set(getTableConfig(value as never).name, columns);
    }
    // Without this the suite would pass by discovering nothing.
    expect(declared.size, "tables discovered in the schema").toBeGreaterThan(400);

    const live = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    const present = new Set(live.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const liveTables = new Set(live.rows.map((r) => r.table_name));

    const absentTables: string[] = [];
    const missingColumns: string[] = [];
    for (const [tableName, columns] of declared) {
      if (!liveTables.has(tableName)) absentTables.push(tableName);
      for (const column of columns) {
        if (!present.has(`${tableName}.${column}`)) missingColumns.push(`${tableName}.${column}`);
      }
    }

    expect(
      { absentTables: absentTables.sort(), missingColumns: missingColumns.sort() },
      `${missingColumns.length} declared column(s) and ${absentTables.length} declared table(s) are created by no migration`,
    ).toEqual({ absentTables: [], missingColumns: [] });
  });
});
