/**
 * deskBillAnnouncements.test.ts — the one place that decides "this printed bill
 * never reached the ledger".
 *
 * The SQL itself is exercised against a real Postgres at request level
 * (routes/deskBillAnnouncements.request.test.ts). What is unit-tested here is
 * the two rules a fake query can actually witness: what the predicate ASKS for
 * (it must match the partial unique index on bills, or a cancelled bill would
 * close an alarm), and what it REFUSES to do with client-supplied values.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ANNOUNCE_GRACE_MINUTES,
  DEFAULT_ANNOUNCE_ROW_LIMIT,
  coerceAnnouncement,
  summarizeDeskBillWitnesses,
} from "./deskBillAnnouncements";

type Captured = { text: string; params?: unknown[] };

function recordingQuery(rows: Array<Record<string, unknown>>, captured: Captured[]) {
  return async (text: string, params?: unknown[]) => {
    captured.push({ text, params });
    return rows;
  };
}

describe("summarizeDeskBillWitnesses — the predicate", () => {
  it("joins delivery to bills on client_ref and excludes cancelled bills", async () => {
    const captured: Captured[] = [];
    await summarizeDeskBillWitnesses(recordingQuery([{ announced_total: 0, outstanding_count: 0 }], captured));
    const sql = captured[0].text;
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("b.client_ref = a.client_ref");
    // A cancelled bill is NOT delivery. This is the same predicate the partial
    // unique index bills_client_ref_uidx is built on, and if the two ever
    // disagree a replayed-then-cancelled bill would silence its own alarm.
    expect(sql).toContain("b.status <> 'cancelled'");
    expect(sql).toContain("a.state = 'pending'");
  });

  it("interpolates the grace window as a sanitized integer, never as text", async () => {
    const captured: Captured[] = [];
    await summarizeDeskBillWitnesses(recordingQuery([], captured), { graceMinutes: 12 });
    expect(captured[0].text).toContain("12 * INTERVAL '1 minute'");
    expect(captured[0].params).toBeUndefined();
  });

  it("refuses to interpolate anything that is not a number", async () => {
    const captured: Captured[] = [];
    // The hostile value cannot reach the SQL text: it is clamped, and the
    // default is what survives.
    await summarizeDeskBillWitnesses(recordingQuery([], captured), {
      graceMinutes: "0); DROP TABLE bills; --" as unknown as number,
    });
    expect(captured[0].text).toContain(`${DEFAULT_ANNOUNCE_GRACE_MINUTES} * INTERVAL '1 minute'`);
    expect(captured[0].text).not.toContain("DROP");

    const negative: Captured[] = [];
    await summarizeDeskBillWitnesses(recordingQuery([], negative), { graceMinutes: -500 });
    expect(negative[0].text).toContain("0 * INTERVAL '1 minute'");
  });

  it("counts the oldest announcement, not the newest, and reports minutes", async () => {
    const captured: Captured[] = [];
    const s = await summarizeDeskBillWitnesses(
      recordingQuery([{ announced_total: 9, outstanding_count: 4, outstanding_amount: "4500.50", oldest_seconds: 7380 }], captured),
      { rowLimit: 5 },
    );
    expect(s.oldestMinutes).toBe(123);
    expect(s.outstandingAmount).toBe(4500.5);
    // ORDER BY first_announced_at ASC: the row that has been missing longest is
    // the one an operator reads first.
    expect(captured[1].text).toContain("ORDER BY a.first_announced_at ASC");
    expect(captured[1].text).toContain(`LIMIT ${5}`);
  });

  // The failure mode this pins is subtle and total: a desk whose queue cannot
  // replay re-announces that same queue on every 5-second sync tick, and the
  // UPSERT refreshes last_announced_at each time. Measured from that column, a
  // bill stuck for two days is always "0 minutes old", never older than the
  // grace window, and so never appears at all — the light would sit green over
  // exactly the outage it was built to catch, and the FAIL threshold would be
  // unreachable.
  it("measures age from the FIRST announcement, not from the tick that refreshed it", async () => {
    const captured: Captured[] = [];
    await summarizeDeskBillWitnesses(
      recordingQuery([{ announced_total: 1, outstanding_count: 1, oldest_seconds: 7200 }], captured),
      { graceMinutes: 20 },
    );
    expect(captured[0].text).toContain("a.first_announced_at < NOW() - (20 * INTERVAL '1 minute')");
    expect(captured[0].text).toContain("min(a.first_announced_at)");
    for (const q of captured) expect(q.text).not.toContain("last_announced_at");
  });

  it("asks for no row page at all when nothing is outstanding", async () => {
    const captured: Captured[] = [];
    const s = await summarizeDeskBillWitnesses(recordingQuery([{ announced_total: 3, outstanding_count: 0 }], captured));
    expect(captured).toHaveLength(1);
    expect(s.rows).toEqual([]);
    expect(s.oldestMinutes).toBeNull();
  });

  it("defaults the row page rather than letting a caller widen it without bound", async () => {
    const captured: Captured[] = [];
    await summarizeDeskBillWitnesses(recordingQuery([{ outstanding_count: 1, oldest_seconds: 60 }], captured), {
      rowLimit: 100_000,
    });
    expect(captured[1].text).toContain(`LIMIT ${DEFAULT_ANNOUNCE_ROW_LIMIT}`);
  });

  it("a missing table is a distinguishable answer, not a zero", async () => {
    const s = await summarizeDeskBillWitnesses(async () => {
      throw Object.assign(new Error("some other fault"), { code: "42601" });
    }).catch((err: unknown) => err);
    // Anything but 42P01 must propagate — swallowing it would report "no
    // witness table" over a real query bug.
    expect(s).toBeInstanceOf(Error);

    const absent = await summarizeDeskBillWitnesses(async () => {
      throw Object.assign(new Error('relation "desk_bill_announcements" does not exist'), { code: "42P01" });
    });
    expect(absent).toEqual({
      tablePresent: false,
      announcedTotal: 0,
      outstandingCount: 0,
      outstandingAmount: 0,
      oldestMinutes: null,
      rows: [],
    });
  });
});

describe("coerceAnnouncement — client-supplied witness rows", () => {
  const base = { clientRef: "11111111-2222-3333-4444-555555555555" };

  it("accepts a normal desk announcement", () => {
    const v = coerceAnnouncement({ ...base, patientId: 42, testCount: 3, totalAmount: 1250.5, workstation: "desk-pc-1" });
    expect(v).toMatchObject({
      clientRef: base.clientRef,
      state: "pending",
      patientId: 42,
      testCount: 3,
      totalAmount: 1250.5,
      workstation: "desk-pc-1",
    });
  });

  it("refuses an unusable client_ref instead of poisoning the unique index", () => {
    expect(coerceAnnouncement({})).toBeNull();
    expect(coerceAnnouncement({ clientRef: "" })).toBeNull();
    expect(coerceAnnouncement({ clientRef: "   " })).toBeNull();
    expect(coerceAnnouncement({ clientRef: "x".repeat(65) })).toBeNull();
    expect(coerceAnnouncement("not an object")).toBeNull();
    expect(coerceAnnouncement(null)).toBeNull();
  });

  it("only ever two states, and anything else reads as pending", () => {
    expect(coerceAnnouncement({ ...base, state: "withdrawn" })?.state).toBe("withdrawn");
    expect(coerceAnnouncement({ ...base, state: "synced" })?.state).toBe("pending");
    expect(coerceAnnouncement({ ...base, state: 42 })?.state).toBe("pending");
  });

  it("clamps an amount a hostile client would use to inflate the alarm", () => {
    expect(coerceAnnouncement({ ...base, totalAmount: 1e30 })?.totalAmount).toBe(10_000_000);
    expect(coerceAnnouncement({ ...base, totalAmount: -500 })?.totalAmount).toBe(0);
    expect(coerceAnnouncement({ ...base, totalAmount: "abc" })?.totalAmount).toBe(0);
    expect(coerceAnnouncement({ ...base, totalAmount: 100.456 })?.totalAmount).toBe(100.46);
  });

  it("trims and bounds the free-text fields", () => {
    const v = coerceAnnouncement({
      ...base,
      workstation: `  ${"w".repeat(300)}  `,
      lastError: "e".repeat(900),
      provisionalBillNumber: "  OFF-2026-abc  ",
    });
    expect(v?.workstation).toHaveLength(120);
    expect(v?.lastError).toHaveLength(300);
    expect(v?.provisionalBillNumber).toBe("OFF-2026-abc");
  });

  it("keeps a client_ref's identity but not its surrounding whitespace", () => {
    expect(coerceAnnouncement({ clientRef: `  ${base.clientRef}  ` })?.clientRef).toBe(base.clientRef);
  });
});
