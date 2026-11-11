import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { radiologyStudiesTable as T } from "@workspace/db/schema";
import {
  mwlOrdersInternalStatuses,
  mwlOrdersStatusCondition,
  mwlTier4ModalityCondition,
} from "./mwlReturnLegSql";

// The intake cascade and the worklist feed are covered by mocked tests that
// never send SQL anywhere, which is how two broken fragments shipped: one that
// Postgres refuses to parse (the feed answered HTTP 500 for every multi-status
// filter) and one that parses and silently widens across patients. The first
// block renders without a driver; the second executes the same fragments in a
// real PostgreSQL, over inline rows, so the answer is the database's own.

const dialect = new PgDialect();
const renderWhere = (condition: SQL) => dialect.sqlToQuery(condition).sql;

describe("mwlOrdersStatusCondition — the predicate the worklist feed sends", () => {
  it("renders a list predicate Postgres accepts, not = ANY( (…​) )", () => {
    const statuses = mwlOrdersInternalStatuses("ALL");
    const rendered = renderWhere(mwlOrdersStatusCondition(statuses));
    expect(rendered).toContain(`"radiology_studies"."status" in (`);
    expect(rendered).not.toMatch(/=\s*ANY\s*\(/);
    expect(dialect.sqlToQuery(mwlOrdersStatusCondition(statuses)).params).toEqual(statuses);
  });

  it("ALL admits a printed film and refuses a cancelled order", () => {
    expect(mwlOrdersInternalStatuses("ALL")).toContain("reported_final");
    expect(mwlOrdersInternalStatuses("ALL")).toContain("delivered");
    expect(mwlOrdersInternalStatuses("ALL")).not.toContain("cancelled");
    expect(mwlOrdersInternalStatuses("SCHEDULED")).toEqual(["scheduled"]);
    expect(mwlOrdersInternalStatuses("COMPLETED")).toEqual([
      "acquired", "reported_preliminary", "reported_final", "delivered",
    ]);
  });
});

describe("mwlTier4ModalityCondition — the arrival leg back to the booking", () => {
  it("treats the booked CR and the arriving DX as one queue", () => {
    const rendered = renderWhere(mwlTier4ModalityCondition("DX"));
    expect(rendered).toContain(`lower("radiology_studies"."modality") in (`);
    // Exactly the two film codes: anything wider and a CT could link to a film.
    expect(dialect.sqlToQuery(mwlTier4ModalityCondition("DX")).params).toEqual(["dx", "cr"]);
    // XR is a storage SOP-class name, not a DICOM modality: only the two codes
    // this clinic actually exchanges (booked CR, arriving DX) are widened.
    expect(renderWhere(mwlTier4ModalityCondition("XR"))).toContain("= lower(");
    expect(renderWhere(mwlTier4ModalityCondition("CT"))).toContain("= lower(");
  });

  it("keeps the ultrasound arm inside its own parentheses", () => {
    const composed = and(
      eq(T.patientId, 1),
      eq(T.studyDate, "2026-11-11"),
      mwlTier4ModalityCondition("US"),
    )!;
    const rendered = renderWhere(composed);
    // drizzle parenthesises the conjunction but NOT a fragment spliced into it,
    // so a bare `OR` here reads as
    // `patient = $1 and date = $2 and modality in (…) OR department = 'usg'`
    // — Postgres would then return every USG row in the database, including
    // other patients', because AND binds tighter than OR.
    const lastArm = rendered.slice(rendered.lastIndexOf(" and ") + " and ".length);
    expect(lastArm.startsWith("(") && lastArm.endsWith(")")).toBe(true);
    expect(lastArm).toContain(" or ");
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = !!DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
const db = drizzle(pool);

// Inline rows, so nothing is created in the schema any other test shares.
// `own_booking` stands in for the caller's patient + date guards.
const FILM_ROWS = sql`(values
    ('own-film-cr',        true,  'CR', 'radiology', 'scheduled'),
    ('other-patient-film', false, 'CR', 'radiology', 'scheduled'),
    ('own-us',             true,  'US', 'radiology', 'delivered'),
    ('other-usg-dept',     false, 'CT', 'usg',       'scheduled'),
    ('cancelled-film',     true,  'CR', 'radiology', 'cancelled')
  ) as f(kind, own_booking, modality, department, status)`;

const kindsFrom = async (condition: SQL) => {
  const result = await db.execute(
    sql`select kind from ${FILM_ROWS} where ${condition} order by kind`,
  );
  // node-postgres hands back its own result object, not a bare row array.
  const rows = (result as unknown as { rows?: { kind: string }[] }).rows ?? result;
  return (rows as { kind: string }[]).map((r) => r.kind);
};

describe.skipIf(!hasDb)("mwlReturnLegSql executed by PostgreSQL", () => {
  afterAll(async () => {
    if (hasDb) await pool.end();
  });

  it("a DX arrival finds its own CR booking and no other patient's film", async () => {
    const found = await kindsFrom(
      and(
        sql`f.own_booking = true`,
        mwlTier4ModalityCondition("DX", { modality: sql`f.modality` }),
      )!,
    );
    // 'cancelled-film' is here too on purpose: this arm answers "same patient,
    // same day, same film queue" and nothing else — status is its own predicate
    // (and tier 4 only fires when exactly one row comes back anyway).
    expect(found).toEqual(["cancelled-film", "own-film-cr"]);
  });

  it("the ultrasound arm cannot escape the caller's own-booking guard", async () => {
    const found = await kindsFrom(
      and(
        sql`f.own_booking = true`,
        mwlTier4ModalityCondition("US", {
          modality: sql`f.modality`,
          department: sql`f.department`,
        }),
      )!,
    );
    // 'other-usg-dept' is the row the un-parenthesised OR used to drag in:
    // a different patient's study, matched only for having department 'usg'.
    expect(found).toEqual(["own-us"]);
  });

  it("a CT arrival still compares literally", async () => {
    const found = await kindsFrom(
      and(sql`f.own_booking = true`, mwlTier4ModalityCondition("CT", { modality: sql`f.modality` }))!,
    );
    expect(found).toEqual([]);
  });

  it("the multi-status list predicate parses and filters", async () => {
    const statuses = mwlOrdersInternalStatuses("ALL");
    const found = await kindsFrom(
      and(sql`f.own_booking = true`, mwlOrdersStatusCondition(statuses, sql`f.status`))!,
    );
    // The cancelled film stays out; the delivered one is exactly what the old
    // ALL list omitted, and is why a printed film vanished from the feed.
    expect(found).toEqual(["own-film-cr", "own-us"]);
  });
});
