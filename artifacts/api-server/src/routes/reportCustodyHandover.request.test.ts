/**
 * Handing signed paper to a patient — request level.
 *
 * Runs the production router over supertest against PostgreSQL, for the reasons
 * the receive file has them and one more: the guarantee this PR is most likely to
 * be accused of breaking is the one that cannot be tested at all without a real
 * database and a real unique index — that a report cannot be handed over twice,
 * and that handing it over does not touch the column that holds somebody's
 * commission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable, ledgersTable, ordersTable, patientReportsTable, patientsTable,
  portalSessionsTable, reportCustodyEventsTable, testsTable, usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { findBillByNumber } from "../lib/billByNumber";

const dbReady = hasDatabaseUrl();
const uid = randomUUID();
const marker = `DLV${uid.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const digits = uid.replace(/\D/g, "");
const BODY_TEXT = `DELIVER-BODY-${marker}`;

let seq = 0;

describe.skipIf(!dbReady)("report custody handover — request level", () => {
  let app: Express;
  let testId = 0;
  let patientA = 0;
  let patientB = 0;
  /** A settled bill, and an outstanding one, plus an ambiguous bill number. */
  let paidBill = { id: 0, number: "" };
  let dueBill = { id: 0, number: "" };
  let ambiguousNumber = "";

  let receiveOnly = "";
  let clerk = "";
  let adminToken = "";
  const createdBillIds: number[] = [];

  async function makeStaff(name: string, permissions: string[], role = "receptionist"): Promise<string> {
    const token = `vitest-dlv-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${name.toLowerCase().replace(/\W+/g, "-")}-${marker}@vitest.invalid`,
        username: `${name.replace(/\W+/g, "")}-${marker}`,
        role,
        permissions: JSON.stringify(permissions),
        pin: "0000",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return token;
  }

  /**
   * A bill number the counter can actually be handed.
   *
   * Printed bill numbers are a 6-digit book stamp plus a 4-digit sequence, so a
   * longer fixture string is not a bill — the bare-number path refuses it, and the
   * test would then be measuring the parser instead of the desk. Searched for an
   * unused one because the ambiguity case has to be created by THESE two rows, not
   * by a leftover bill that happens to share the number.
   */
  async function freeBillNumber(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = `2026${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
      if ((await findBillByNumber(candidate)).status === "not_found") return candidate;
    }
    throw new Error("could not find an unused bill number");
  }

  async function makePatient(first: string) {
    const [p] = await db
      .insert(patientsTable)
      .values({
        patientId: `P-${first}-${marker}`,
        firstName: first,
        lastName: `Probe${marker}`,
        dateOfBirth: "1970-01-01",
        gender: "M",
        phone: `9${(Math.abs(Number(digits.slice(0, 9))) % 1_000_000_000)}`.slice(0, 10),
      })
      .returning({ id: patientsTable.id });
    return p.id;
  }

  async function makeBill(patientId: number, paid: string, total: string, billNumber: string, ledgerId: number) {
    seq += 1;
    // Order numbers are globally unique while bill numbers are unique per book —
    // which is precisely the asymmetry the ambiguous case depends on, so the two
    // bills that share a number must not share an order.
    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `O-${marker}-${seq}`, patientId })
      .returning({ id: ordersTable.id });
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber,
        orderId: order.id,
        patientId,
        subtotal: total,
        totalAmount: total,
        paidAmount: paid,
        balanceAmount: (Number(total) - Number(paid)).toFixed(2),
        status: Number(paid) >= Number(total) ? "paid" : "partial",
        ledgerId,
      })
      .returning({ id: billsTable.id });
    createdBillIds.push(bill.id);
    return { id: bill.id, number: billNumber };
  }

  async function makeReport(opts: {
    patientId: number; billId: number; status: string; signed: boolean;
  }) {
    seq += 1;
    const reportNumber = `RPT-20261026-${digits.slice(0, 8)}${String(seq).padStart(2, "0")}`;
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber,
        type: "radiology",
        patientId: opts.patientId,
        testId,
        billId: opts.billId,
        title: `Handover probe ${seq}`,
        status: opts.status,
        body: BODY_TEXT,
        signedAt: opts.signed ? new Date() : null,
        signatureId: opts.signed ? 1 : null,
        signedByName: opts.signed ? "Dr Sugandha" : null,
      })
      .returning({ id: patientReportsTable.id, status: patientReportsTable.status });
    return { id: row.id, code: reportNumber, status: row.status };
  }

  /**
   * The two-step flow every test needs: receive the paper, then it may go.
   *
   * Received by the receive-only session, not by the clerk who hands it over —
   * because that is the shape the whole project exists for (two named acts, two
   * named people), and because a helper that used one token for both would pass
   * even if the handover grant silently bought the receive endpoint too.
   */
  async function receive(code: string) {
    const res = await request(app)
      .post("/api/report-custody/receive")
      .set("Authorization", `Bearer ${receiveOnly}`)
      .send({ requestId: randomUUID(), items: [{ reportId: await idOfCode(code), scannedCode: code }] });
    expect(res.status, res.text).toBe(200);
    expect(res.body.received, `fixture receive failed for ${code}`).toBe(1);
    return res;
  }

  async function idOfCode(code: string): Promise<number> {
    const [r] = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.reportNumber, code));
    if (!r) throw new Error(`fixture ${code} missing`);
    return r.id;
  }

  const billScan = (token: string, code: string) =>
    request(app).post("/api/report-custody/bill").set("Authorization", `Bearer ${token}`).send({ code });

  const reportScan = (token: string, code: string, billCode: string) =>
    request(app)
      .post("/api/report-custody/handover/scan")
      .set("Authorization", `Bearer ${token}`)
      .send({ code, billCode });

  const handover = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/handover").set("Authorization", `Bearer ${token}`).send(body);

  const handoverRows = (reportId: number) =>
    db
      .select()
      .from(reportCustodyEventsTable)
      .where(
        and(
          eq(reportCustodyEventsTable.reportId, reportId),
          eq(reportCustodyEventsTable.event, "PHYSICALLY_HANDED_OVER"),
        ),
      );

  beforeAll(async () => {
    app = await createTestApp();

    const [test] = await db
      .insert(testsTable)
      .values({
        code: `MR-${marker}`, name: `MRI Brain ${marker}`, category: "MRI",
        duration: "30", price: "4000.00", department: "MRI",
      })
      .returning({ id: testsTable.id });
    testId = test.id;

    // Two books, because bill numbers are unique per book and the ambiguity case
    // only exists if that rule is real.
    const [bookA] = await db.insert(ledgersTable).values({ name: `Book A ${marker}` }).returning({ id: ledgersTable.id });
    const [bookB] = await db.insert(ledgersTable).values({ name: `Book B ${marker}` }).returning({ id: ledgersTable.id });

    patientA = await makePatient("Alpha");
    patientB = await makePatient("Beta");

    paidBill = await makeBill(patientA, "4000.00", "4000.00", await freeBillNumber(), bookA.id);
    dueBill = await makeBill(patientA, "1000.00", "4000.00", await freeBillNumber(), bookA.id);
    ambiguousNumber = await freeBillNumber();
    await makeBill(patientA, "4000.00", "4000.00", ambiguousNumber, bookA.id);
    await makeBill(patientB, "4000.00", "4000.00", ambiguousNumber, bookB.id);

    [receiveOnly, clerk, adminToken] = await Promise.all([
      makeStaff(`Receiver Only ${marker}`, ["/report-delivery:receive"]),
      makeStaff(`Deliverer ${marker}`, ["/report-delivery:handover"]),
      makeStaff(`Admin ${marker}`, [], "admin"),
    ]);
  });

  afterAll(async () => {
    // Every delete is scoped to this run's own identifiers, never to a pattern a
    // real clinic row could also match: `like(billNumber, "202610…")` would have
    // deleted a genuine October bill, and the scratch database is not a reason to
    // write a teardown that is unsafe wherever it runs.
    const reportPrefix = `RPT-20261026-${digits.slice(0, 8)}`;
    await db
      .delete(reportCustodyEventsTable)
      .where(like(reportCustodyEventsTable.reportNumber, `${reportPrefix}%`))
      .catch(() => {});
    await db
      .delete(patientReportsTable)
      .where(like(patientReportsTable.reportNumber, `${reportPrefix}%`))
      .catch(() => {});
    if (createdBillIds.length > 0) {
      await db.delete(billsTable).where(inArray(billsTable.id, createdBillIds)).catch(() => {});
    }
    await db
      .delete(ordersTable)
      .where(like(ordersTable.orderNumber, `O-${marker}%`))
      .catch(() => {});
    await db.delete(ledgersTable).where(like(ledgersTable.name, `%${marker}%`)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(patientsTable).where(like(patientsTable.lastName, `Probe${marker}`)).catch(() => {});
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, "vitest-dlv-%")).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.name, `%${marker}%`)).catch(() => {});
  });

  it("keeps receive and handover as separate grants", async () => {
    // The reason `/report-custody` is not mounted behind
    // requireStaffPermission("/report-delivery"): a module-wide gate would give a
    // receive-only clerk the handover endpoints too.
    for (const path of ["/bill", "/handover/scan", "/handover"]) {
      const res = await request(app)
        .post(`/api/report-custody${path}`)
        .set("Authorization", `Bearer ${receiveOnly}`)
        .send({ code: paidBill.number, billCode: paidBill.number, items: [] });
      expect(res.status, `${path} must refuse a receive-only session`).toBe(403);
    }
    // ...and the other way, because a one-sided check proves nothing about a pair.
    const refused = await request(app)
      .post("/api/report-custody/receive")
      .set("Authorization", `Bearer ${clerk}`)
      .send({ requestId: randomUUID(), items: [{ reportId: 1 }] });
    expect(refused.status, "a handover-only session must not be able to receive").toBe(403);

    const ok = await billScan(clerk, paidBill.number);
    expect(ok.status, ok.text).toBe(200);
    expect((await billScan(adminToken, paidBill.number)).status).toBe(200);
  });

  it("reads the bill and names its patient, without recording anything", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    const res = await billScan(clerk, `http://localhost/api/verify/bill/${paidBill.number}?hash=abc`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.patient.name).toContain("Alpha");
    expect(res.body.bill.settled).toBe(true);
    const candidate = res.body.examinations
      .map((e: { candidate: { reportId: number } }) => e.candidate)
      .find((c: { reportId: number }) => c.reportId === r.id);
    expect(candidate.handoverVerdict).toBe("NOT_AT_COUNTER");
    expect(await handoverRows(r.id)).toHaveLength(0);
  });

  it("refuses to hand over paper the counter never received", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    const res = await handover(clerk, {
      requestId: randomUUID(),
      billCode: paidBill.number,
      recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.handed).toBe(0);
    expect(res.body.results[0].reason).toBe("NOT_AT_COUNTER");
    // The sentence has to tell the clerk what to do next, not just that the answer is no.
    expect(res.body.results[0].message).toMatch(/Receive it first/i);
    expect(await handoverRows(r.id)).toHaveLength(0);
  });

  it("hands over after a receipt, records the category, and leaves status alone", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(r.code);

    const res = await handover(clerk, {
      requestId: randomUUID(),
      billCode: paidBill.number,
      recipientCategory: "FAMILY_MEMBER",
      recipientName: "son",
      items: [{ reportId: r.id, scannedCode: r.code }],
      actorName: "Somebody Else",
    } as Record<string, unknown>);
    expect(res.status, res.text).toBe(200);
    expect(res.body.handed).toBe(1);

    const rows = await handoverRows(r.id);
    expect(rows).toHaveLength(1);
    const event = rows[0]!;
    expect(event.event).toBe("PHYSICALLY_HANDED_OVER");
    expect(event.outcome).toBe("completed");
    expect(event.recipientCategory).toBe("FAMILY_MEMBER");
    expect(event.recipientName).toBe("son");
    expect(event.actorName).toBe(`Deliverer ${marker}`);
    expect(event.batchSeq).toBe(1);
    expect(event.verification).toMatchObject({
      precededByReceipt: true,
      scannedBillNumber: paidBill.number,
      clinicalTextStored: false,
    });
    expect(event.overrideReason).toBeNull();

    const [report] = await db
      .select({
        physicalState: patientReportsTable.physicalState,
        status: patientReportsTable.status,
        deliveredAt: patientReportsTable.deliveredAt,
      })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, r.id));
    expect(report!.physicalState).toBe("HANDED_OVER");
    /**
     * The money-semantics guard, and the most important line in this file.
     * `status` and `deliveredAt` drive the `report_delivered` commission policy and
     * are set today by /print. A physical handover must not write them, because
     * that change belongs in a reviewed, separately-evidenced step — so a handover
     * that succeeded must leave the legacy columns exactly as they were.
     */
    expect(report!.status).toBe("pending_verification");
    expect(report!.deliveredAt).toBeNull();
  });

  it("refuses a label from another patient's stack", async () => {
    const foreign = await makeReport({ patientId: patientB, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(foreign.code);
    // Received, at the counter, signed — and belonging to the other patient.
    const res = await handover(clerk, {
      requestId: randomUUID(),
      billCode: paidBill.number,
      recipientCategory: "PATIENT",
      items: [{ reportId: foreign.id, scannedCode: foreign.code }],
    });
    expect(res.body.results[0].reason).toBe("WRONG_PATIENT");
    // Bill A names patient A; this report's row names patient B.
    expect(res.body.results[0].candidate.patientId).toBe(patientB);
    expect(await handoverRows(foreign.id)).toHaveLength(0);
  });

  it("holds an unpaid bill to its own rule, and records the override when given a reason", async () => {
    const r = await makeReport({ patientId: patientA, billId: dueBill.id, status: "pending_verification", signed: true });
    await receive(r.code);

    const without = await handover(clerk, {
      requestId: randomUUID(),
      billCode: dueBill.number,
      recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(without.body.results[0].reason).toBe("PAYMENT_OUTSTANDING");
    expect(without.body.results[0].message).toMatch(/reason/i);
    expect(await handoverRows(r.id)).toHaveLength(0);

    const withReason = await handover(clerk, {
      requestId: randomUUID(),
      billCode: dueBill.number,
      recipientCategory: "PATIENT",
      paymentOverrideReason: "Dues settled against the corporate account, invoice attached at billing desk",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(withReason.status, withReason.text).toBe(200);
    expect(withReason.body.handed).toBe(1);

    const rows = await handoverRows(r.id);
    expect(rows).toHaveLength(1);
    const event = rows[0]!;
    // The override is a recorded decision, attributed to a person — and an
    // override is NOT a discrepancy, so the discrepancy queue stays meaningful.
    expect(event.outcome).toBe("completed");
    expect(event.overrideReason).toMatch(/corporate account/);
    expect(event.overrideByUserId).toBeGreaterThan(0);
    expect(event.paymentSnapshot).toMatchObject({ status: "measured", balance: "3000.00" });
  });

  it("refuses a second handover of the same report, by the database", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(r.code);
    const first = await handover(clerk, {
      requestId: randomUUID(), billCode: paidBill.number, recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(first.body.handed).toBe(1);

    const second = await handover(clerk, {
      requestId: randomUUID(), billCode: paidBill.number, recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(second.body.handed).toBe(0);
    expect(second.body.results[0].reason).toBe("ALREADY_HANDED_OVER");
    expect(await handoverRows(r.id)).toHaveLength(1);
  });

  it("returns the original event when the same click is sent again", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(r.code);
    const requestId = randomUUID();
    const body = {
      requestId,
      billCode: paidBill.number,
      recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    };
    const first = await handover(clerk, body);
    const second = await handover(clerk, body);
    expect(second.status, second.text).toBe(200);
    expect(second.body.handed).toBe(1);
    expect(second.body.results[0].eventId).toBe(first.body.results[0].eventId);
    expect(await handoverRows(r.id)).toHaveLength(1);
  });

  it("refuses to invent a recipient", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(r.code);
    for (const bad of [undefined, "Brother-in-law", "patient", ""]) {
      const res = await handover(clerk, {
        requestId: randomUUID(), billCode: paidBill.number, recipientCategory: bad,
        items: [{ reportId: r.id, scannedCode: r.code }],
      });
      expect(res.status, `${String(bad)} must not be accepted`).toBe(400);
    }
    expect(await handoverRows(r.id)).toHaveLength(0);
  });

  it("refuses an ambiguous bill number instead of choosing a patient", async () => {
    const res = await billScan(clerk, ambiguousNumber);
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("AMBIGUOUS_BILL");
    expect(JSON.stringify(res.body)).not.toContain("Alpha");
  });

  it("refuses a handover whose bill cannot be read", async () => {
    const missing = await handover(clerk, {
      requestId: randomUUID(), billCode: "", recipientCategory: "PATIENT", items: [{ reportId: 1 }],
    });
    expect(missing.status).toBe(422);
    const noItems = await handover(clerk, { requestId: randomUUID(), billCode: paidBill.number, recipientCategory: "PATIENT", items: [] });
    expect(noItems.status).toBe(400);
  });

  it("scans one report against the established bill and writes nothing", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    const early = await reportScan(clerk, r.code, paidBill.number);
    expect(early.status, early.text).toBe(200);
    expect(early.body.candidate.handoverVerdict).toBe("NOT_AT_COUNTER");
    expect(await handoverRows(r.id)).toHaveLength(0);

    await receive(r.code);
    const later = await reportScan(clerk, r.code, paidBill.number);
    expect(later.body.candidate.handoverVerdict).toBe("DELIVERABLE");
    expect(await handoverRows(r.id), "the second scan is still only a scan").toHaveLength(0);
  });

  it("never lets report content into a handover response or event", async () => {
    const r = await makeReport({ patientId: patientA, billId: paidBill.id, status: "pending_verification", signed: true });
    await receive(r.code);
    const res = await handover(clerk, {
      requestId: randomUUID(), billCode: paidBill.number, recipientCategory: "PATIENT",
      items: [{ reportId: r.id, scannedCode: r.code }],
    });
    expect(JSON.stringify(res.body)).not.toContain(BODY_TEXT);
    expect(JSON.stringify(await handoverRows(r.id))).not.toContain(BODY_TEXT);
    const bill = await billScan(clerk, paidBill.number);
    expect(JSON.stringify(bill.body)).not.toContain(BODY_TEXT);
  });

  it("refuses a batch over the cap without recording any of it", async () => {
    // The cap is the owner's (~180 reports/day, one confirmation covers at most
    // 100), and a browser tab that lost its list must not be able to release a
    // month of paper in one click. Checked before the bill is re-read, because the
    // honest answer to 101 items is "split it", not 101 verdicts.
    const items = Array.from({ length: 101 }, (_, i) => ({ reportId: i + 1, scannedCode: `RPT-20261026-00${i}` }));
    const res = await handover(clerk, {
      requestId: randomUUID(), billCode: paidBill.number, recipientCategory: "PATIENT", items,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100/);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/report-custody/bill").send({ code: paidBill.number });
    expect(res.status).toBe(401);
  });
});
