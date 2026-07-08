import { describe, expect, test, vi, beforeEach } from "vitest";

// Regression tests for the incident where GET /api/website/settings returned
// 500 with:
//   duplicate key value violates unique constraint "site_settings_pkey"
//   Key (id)=(1) already exists.
//
// Root cause: the old getOrCreateSettings() did a plain SELECT, and if no
// row was found, an unconditional INSERT with no ON CONFLICT handling. Any
// time two requests raced to be "the first" caller (e.g. two browser tabs
// loading the public site cold, or a GET landing between two PATCH calls),
// the second INSERT crashed instead of just returning the row the first
// caller had just created.
//
// These tests drive a hand-rolled in-memory fake of the `db` chain so we can
// simulate that exact race deterministically, without a real Postgres
// instance.

type Row = { id: number } & Record<string, unknown>;

function makeFakeDb(initialRows: Row[]) {
  let rows: Row[] = [...initialRows];
  const calls = { selects: 0, inserts: 0 };

  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          calls.selects += 1;
          // Only id=1 is ever queried in getOrCreateSettings; return
          // whatever is currently "in the table".
          return rows.filter((r) => r.id === 1);
        },
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        onConflictDoNothing: async () => {
          calls.inserts += 1;
          // Simulate a real unique constraint on id: only insert if not
          // already present (this is exactly what ON CONFLICT DO NOTHING
          // does in Postgres — it never throws).
          if (!rows.some((r) => r.id === v.id)) {
            rows.push({ ...v });
          }
          return undefined;
        },
      }),
    }),
  };

  return { db, calls, getRows: () => rows };
}

describe("getOrCreateSettings — concurrency-safe singleton row (site_settings id=1)", () => {
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    vi.resetModules();
  });

  test("when id=1 already exists, a GET returns it as-is and never inserts (never overwrites existing settings)", async () => {
    fake = makeFakeDb([{ id: 1, siteTitle: "Care Diagnostics", isPublished: true }]);
    vi.doMock("@workspace/db", () => ({
      db: fake.db,
      siteSettingsTable: { id: "id" },
      sitePagesTable: {}, sitePopupsTable: {}, siteFaqsTable: {}, sitePhotosTable: {},
    }));
    vi.doMock("@workspace/db/schema", () => ({ portalSessionsTable: {}, usersTable: {} }));

    const { getOrCreateSettings } = await import("./website");
    const result = await getOrCreateSettings();

    expect(result).toEqual({ id: 1, siteTitle: "Care Diagnostics", isPublished: true });
    expect(fake.calls.inserts).toBe(0); // never attempts to (re)create an existing row
    expect(fake.getRows()).toHaveLength(1); // untouched
  });

  test("when id=1 is missing, it is created exactly once and returned", async () => {
    fake = makeFakeDb([]);
    vi.doMock("@workspace/db", () => ({
      db: fake.db,
      siteSettingsTable: { id: "id" },
      sitePagesTable: {}, sitePopupsTable: {}, siteFaqsTable: {}, sitePhotosTable: {},
    }));
    vi.doMock("@workspace/db/schema", () => ({ portalSessionsTable: {}, usersTable: {} }));

    const { getOrCreateSettings } = await import("./website");
    const result = await getOrCreateSettings();

    expect(result.id).toBe(1);
    expect(fake.calls.inserts).toBe(1);
    expect(fake.getRows()).toHaveLength(1);
  });

  test("simulated race — two concurrent callers both see id=1 missing, insert races, neither throws, both return the same row", async () => {
    fake = makeFakeDb([]);
    vi.doMock("@workspace/db", () => ({
      db: fake.db,
      siteSettingsTable: { id: "id" },
      sitePagesTable: {}, sitePopupsTable: {}, siteFaqsTable: {}, sitePhotosTable: {},
    }));
    vi.doMock("@workspace/db/schema", () => ({ portalSessionsTable: {}, usersTable: {} }));

    const { getOrCreateSettings } = await import("./website");

    // Both "requests" race the full getOrCreateSettings flow concurrently —
    // this is what used to throw "duplicate key value violates unique
    // constraint site_settings_pkey" under the old plain-INSERT code.
    const [a, b] = await Promise.all([getOrCreateSettings(), getOrCreateSettings()]);

    expect(a.id).toBe(1);
    expect(b.id).toBe(1);
    expect(fake.getRows()).toHaveLength(1); // exactly one row was ever created
  });
});
