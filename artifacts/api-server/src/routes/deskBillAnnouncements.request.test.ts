/**
 * deskBillAnnouncements.request.test.ts — REAL request-level coverage for the
 * desk bill witness.
 *
 * This is the route that decides whether the clinic ever learns that a billing
 * desk printed a bill the ledger has not received. Its behaviour cannot be
 * asserted from source text: the load-bearing rule ("this bill was delivered")
 * is a SQL join against `bills`, and the failure mode this feature exists to
 * close is precisely a rule that reads as implemented while answering nothing.
 * So every case here executes the route against PostgreSQL.
 *
 * Skipped automatically when no DATABASE_URL is configured.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import { billsTable, portalSessionsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { seedBillingFixture, type BillingFixture } from "../testSupport/billingFixtures";

const dbAvailable = hasDatabaseUrl();

/**
 * Every client_ref this suite hands out, recorded so cleanup can name exactly
 * its own rows and never touch a real desk's witnesses.
 *
 * They are plain UUIDs, not a marker-prefixed string, because that is the only
 * shape the ledger can hold: `clientRef` is `z.string().uuid()` on both
 * CreateOrderBody and CreateBillBody (lib/api-zod/src/generated/api.ts:606,
 * :1002), so a prefixed test ref makes POST /api/billing/save answer 400 before
 * it ever reaches `bills` — which is how the two delivery cases failed on CI.
 * The desk generates `genUUID()` at its single enqueue site
 * (BillingDesk.tsx:1526), so a UUID here is also the honest production shape.
 * Scoping therefore moves to the recorded list plus the workstation marker.
 */
const issuedRefs: string[] = [];
const ref = () => {
  const clientRef = randomUUID();
  issuedRefs.push(clientRef);
  return clientRef;
};

/** The envelope workstation every announcement in this suite stamps, its scope key. */
const MARKER_WORKSTATION = "vitest-desk-pc";

/**
 * The table is created by applying the SAME migration file production applies,
 * rather than a copy of it — so this suite can never pass against a helper the
 * clinic does not have, and a dev DB built by `db:push` (which does not run
 * migrations/*.sql) still gets the real shape. Re-runnable by design.
 */
async function ensureDeskBillWitnessTable(): Promise<void> {
  const present = await pool.query(
    "SELECT to_regclass('public.desk_bill_announcements') IS NOT NULL AS present",
  );
  if (present.rows[0]?.present) return;
  const migration = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../migrations/add_desk_bill_announcements.sql",
  );
  await db.execute(sql.raw(readFileSync(migration, "utf8")));
}

/**
 * Rows are cleaned by the refs this suite issued and by its own workstation
 * string, rather than through the API, because the API has no delete route on
 * purpose: a witness may only be closed by a real bill.
 */
async function purgeWitnesses(): Promise<void> {
  await pool.query(
    "DELETE FROM desk_bill_announcements WHERE client_ref = ANY($1::text[]) OR workstation = $2",
    [issuedRefs, MARKER_WORKSTATION],
  );
  issuedRefs.length = 0;
}

describe.skipIf(!dbAvailable)("/api/desk-bills — request level", () => {
  let app: Express;
  let fx: BillingFixture;

  beforeAll(async () => {
    await ensureDeskBillWitnessTable();
    // A crashed earlier run left its witnesses behind, and they would be counted
    // as if this suite had announced them.
    await purgeWitnesses();
    app = await createTestApp();
    fx = await seedBillingFixture();
  }, 120_000);

  afterAll(async () => {
    await purgeWitnesses();
    await fx?.cleanup();
  }, 120_000);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const announce = (items: unknown[], token: string = fx.token) =>
    request(app)
      .post("/api/desk-bills/announcements")
      .set(auth(token))
      .send({ workstation: MARKER_WORKSTATION, items });

  /** graceMinutes=0 because the point of these tests is the join, not the window. */
  const outstanding = (token: string = fx.token) =>
    request(app).get("/api/desk-bills/outstanding?graceMinutes=0").set(auth(token));

  const item = (clientRef: string, over: Record<string, unknown> = {}) => ({
    clientRef,
    provisionalBillNumber: "OFF-20261113-abc",
    patientId: fx.patientId,
    testCount: 1,
    totalAmount: fx.testPrice,
    lastError: "Failed to fetch",
    ...over,
  });

  test("an announced bill with no ledger row is outstanding", async () => {
    const clientRef = ref();
    const post = await announce([item(clientRef)]);
    expect(post.status).toBe(200);
    expect(post.body).toEqual({ ok: true, accepted: 1, failed: 0 });

    const res = await outstanding();
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    const row = res.body.rows.find((r: { clientRef: string }) => r.clientRef === clientRef);
    expect(row).toBeTruthy();
    expect(row.provisionalBillNumber).toBe("OFF-20261113-abc");
    expect(Number(row.totalAmount)).toBe(fx.testPrice);
    expect(row.workstation).toBe("vitest-desk-pc");
    expect(row.lastError).toBe("Failed to fetch");
  });

  test("delivering the bill for real closes the witness — derived, not claimed", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    expect(
      (await outstanding()).body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef),
    ).toBe(true);

    const saved = await request(app)
      .post("/api/billing/save")
      .set(auth(fx.token))
      .send({
        patientId: fx.patientId,
        tests: [{ testId: fx.testId, price: fx.testPrice }],
        payments: [{ amount: fx.testPrice, method: "cash" }],
        clientRef,
      });
    expect(saved.status).toBe(201);

    const after = await outstanding();
    expect(after.body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(false);
    // Nothing in the announcement said it was synced, and the desk never sent a
    // second request. The bill row is the only reason this closed.
    expect(after.body.outstandingCount).toBeLessThan(after.body.announcedTotal);
  });

  test("a CANCELLED bill does not close the witness", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    const saved = await request(app)
      .post("/api/billing/save")
      .set(auth(fx.token))
      .send({
        patientId: fx.patientId,
        tests: [{ testId: fx.testId, price: fx.testPrice }],
        payments: [{ amount: fx.testPrice, method: "cash" }],
        clientRef,
      });
    expect(saved.status).toBe(201);
    expect((await outstanding()).body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(false);

    await db
      .update(billsTable)
      .set({ status: "cancelled" })
      .where(eq(billsTable.clientRef, clientRef));

    // The predicate must match the partial unique index bills_client_ref_uidx
    // exactly; a cancelled bill is not delivery, and a replay the cashier voided
    // has to keep alarming.
    expect((await outstanding()).body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(true);
  });

  test("re-announcing the same bill is one witness, not two", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    await announce([item(clientRef, { lastError: "502 Bad Gateway" })]);

    const res = await outstanding();
    const rows = res.body.rows.filter((r: { clientRef: string }) => r.clientRef === clientRef);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastError).toBe("502 Bad Gateway");
  });

  test("a withdrawn announcement stops alarming", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    expect((await outstanding()).body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(true);

    await announce([item(clientRef, { state: "withdrawn", totalAmount: 0 })]);
    expect((await outstanding()).body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(false);
  });

  test("an empty manifest is the normal case, not a bad request", async () => {
    const res = await announce([]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, accepted: 0 });
  });

  test("garbage items answer 200 and write nothing — telemetry must never break the workflow", async () => {
    // This POST runs on the same tick that then replays real bills. A 500 here
    // would make the desk's sync loop treat a healthy server as an outage.
    const res = await announce([
      {},
      { clientRef: "" },
      { clientRef: "x".repeat(200) },
      "not an object",
      null,
      { clientRef: ref(), totalAmount: 1e30, patientId: "abc", testCount: -4 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(1);
    expect(res.body.failed).toBe(0);
  });

  test("one row that the database refuses cannot erase the rest of the manifest", async () => {
    const good = ref();
    // coerceAnnouncement accepts any finite positive patientId, so this is the
    // one thing the column itself rejects: 2^31 does not fit an integer. The
    // per-row catch is what stops it cancelling the valid witness next to it.
    const res = await announce([
      item(ref(), { patientId: 2_147_483_648 }),
      item(good),
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, accepted: 1, failed: 1 });
    const rows = (await outstanding()).body.rows;
    expect(rows.some((r: { clientRef: string }) => r.clientRef === good)).toBe(true);
  });

  // The desk re-announces a queue it cannot deliver on every 5-second sync tick,
  // and the UPSERT refreshes last_announced_at each time. If the alarm measured
  // from that, this bill would be two seconds old forever and the Daily Summary
  // would read "all delivered" while the drawer held the cash.
  test("a re-announced bill ages from its FIRST announcement, so the alarm can be reached", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    // Two and a half hours of stuck ticks, expressed as the row the ticks wrote.
    await pool.query(
      "UPDATE desk_bill_announcements SET first_announced_at = NOW() - INTERVAL '150 minutes', last_announced_at = NOW() - INTERVAL '150 minutes' WHERE client_ref = $1",
      [clientRef],
    );
    await announce([item(clientRef)]);

    // The DEFAULT grace window, not graceMinutes=0: this is the question the
    // street light actually asks.
    const res = await request(app).get("/api/desk-bills/outstanding").set(auth(fx.token));
    const row = res.body.rows.find((r: { clientRef: string }) => r.clientRef === clientRef);
    expect(row).toBeTruthy();
    expect(row.minutesUnsynced).toBeGreaterThanOrEqual(150);
    // And the aggregate agrees, because FAIL is only reachable if it does.
    expect(res.body.oldestMinutes).toBeGreaterThanOrEqual(150);
  });

  test("refuses an unauthenticated announcement and an unauthenticated read", async () => {
    expect((await request(app).post("/api/desk-bills/announcements").send({ items: [] })).status).toBe(401);
    expect((await request(app).get("/api/desk-bills/outstanding")).status).toBe(401);
  });

  test("staff without the /billing permission cannot announce or read", async () => {
    const marker = `vitest-${randomUUID().slice(0, 8)}`;
    const token = `vitest-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest No Billing ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "receptionist",
        permissions: JSON.stringify(["/patients"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    try {
      expect((await announce([item(ref())], token)).status).toBe(403);
      expect((await outstanding(token)).status).toBe(403);
    } finally {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, user.id)).catch(() => {});
      await purgeWitnesses();
    }
  });

  test("graceMinutes is honoured, so a just-queued bill is not yet an alarm", async () => {
    const clientRef = ref();
    await announce([item(clientRef)]);
    // The default window: this announcement is seconds old, so it is still
    // "in flight" and must not appear.
    const res = await request(app).get("/api/desk-bills/outstanding").set(auth(fx.token));
    expect(res.body.rows.some((r: { clientRef: string }) => r.clientRef === clientRef)).toBe(false);
  });
});
