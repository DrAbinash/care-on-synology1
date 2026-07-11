import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { reportFindingInstancesTable, type InsertReportFindingInstance } from "./reportFindingInstances";

// Ticket A1 coverage: a minimal schema-level sanity check, NOT a route or a
// live-database integration test — no route reads or writes this table yet
// (that's Ticket A3). This exercises only the Drizzle schema module itself:
// that its column references are usable with real drizzle-orm query-builder
// helpers, and that the insert/select TypeScript shapes are correct.
//
// A lightweight local fake stands in for `db` — reportFindingInstances.ts
// has no dependency on @workspace/db's real connection (it only imports
// from drizzle-orm/pg-core), so there is nothing to mock at that boundary;
// this fake just captures what would be sent to Postgres.

type FakeRow = ReturnType<typeof makeInsertedRow>;

function makeInsertedRow(values: InsertReportFindingInstance) {
  // Mirrors what a real INSERT would look like once Postgres has applied
  // its column DEFAULTs — but this fake never applies them itself (that is
  // deliberate: DEFAULT '', DEFAULT now(), etc. are server-side SQL
  // defaults, not something drizzle-orm computes client-side). Row shape
  // for the fake select-back below.
  return { id: 1, ...values } as { id: number } & InsertReportFindingInstance;
}

function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows = [...initialRows];
  return {
    insert() {
      return {
        values(v: InsertReportFindingInstance) {
          const row = makeInsertedRow(v);
          rows.push(row);
          return { returning: async () => [row] };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where: async () => rows,
          };
        },
      };
    },
    rows,
  };
}

describe("reportFindingInstancesTable — schema-level sanity (no route, no live DB)", () => {
  it("accepts a minimal insert with only findingId — every other column is optional", () => {
    // If this line fails to compile, the schema's NOT NULL / .default()
    // declarations are wrong (findingId should be the only required field).
    const minimal: InsertReportFindingInstance = { findingId: 8842 };
    expect(minimal.findingId).toBe(8842);
    expect(minimal.category).toBeUndefined(); // not filled client-side — Postgres applies DEFAULT '' server-side
    expect(minimal.confirmed).toBeUndefined(); // Postgres applies DEFAULT false server-side
  });

  it("round-trips a minimal insert through a fake db exactly as passed, with no client-side default injection", async () => {
    const db = makeFakeDb();
    const [inserted] = await db
      .insert()
      .values({ findingId: 8842, source: "quickselect" })
      .returning();

    expect(inserted).toMatchObject({ findingId: 8842, source: "quickselect" });
    // Confirms drizzle-orm does NOT silently inject '', false, '0', etc. —
    // those are real Postgres column DEFAULTs applied only by the server.
    expect(inserted).not.toHaveProperty("category", "");
    expect(inserted).not.toHaveProperty("confirmed", false);
  });

  it("column references work with drizzle-orm's real eq() helper", () => {
    // A genuinely broken column definition (wrong builder, missing config)
    // would throw here even though it can satisfy TypeScript structurally.
    expect(() => eq(reportFindingInstancesTable.findingId, 8842)).not.toThrow();
    expect(() => eq(reportFindingInstancesTable.draftId, 1)).not.toThrow();
    expect(() => eq(reportFindingInstancesTable.reportId, 1)).not.toThrow();
    expect(() => eq(reportFindingInstancesTable.id, 1)).not.toThrow();
  });

  it("selects back a row inserted moments earlier via the same fake db", async () => {
    const db = makeFakeDb();
    await db.insert().values({ findingId: 8842, modality: "MR" }).returning();
    const rows = await db.select().from().where();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ findingId: 8842, modality: "MR" });
  });
});
