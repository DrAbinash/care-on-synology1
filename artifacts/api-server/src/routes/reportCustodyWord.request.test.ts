/**
 * Word-typed reports at the counter — request level.
 *
 * This is the half of the feature the clinic actually runs: most reports here are
 * typed in Microsoft Word, reach CARE as an attachment, and never become a
 * `patient_reports` row. So the two questions this file exists to answer are ones
 * no unit test can answer:
 *
 *   1. Does a bill scan still show the work, when the database holds no report row
 *      for any of it? (Enumerating `patient_reports` by bill answered "nothing",
 *      which at a physical counter reads as "this desk is not for your work".)
 *   2. Does the accounting stay in the ledger, and OUT of the clinical tables?
 *      The owner's ruling is that a Word report is identified by its examination,
 *      so `report_id` is NULL and `order_test_id` carries the paper. Nothing here
 *      may create, touch or depend on a `patient_reports` row.
 *
 * Runs the production router over supertest against PostgreSQL, because the rules
 * that matter are two partial unique indexes — one open counter receipt per
 * examination, one open handover per examination — and no mock enforces a
 * database constraint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable, ledgersTable, orderTestsTable, ordersTable, patientReportsTable, patientsTable,
  portalSessionsTable, reportCustodyEventsTable, scanAuditLogsTable, testsTable, usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { findBillByNumber } from "../lib/billByNumber";

const dbReady = hasDatabaseUrl();
const uid = randomUUID();
const marker = `WRD${uid.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const digits = uid.replace(/\D/g, "");

let seq = 0;

describe.skipIf(!dbReady)("word report custody — request level", () => {
  let app: Express;
  let testA = 0;
  let testB = 0;
  let testC = 0;
  let patientA = 0;
  let patientB = 0;

  let receiver = "";
  let deliverer = "";
  /** Two books, because bill numbers are unique per book and the ambiguity case
   *  only exists if that rule is real. */
  let bookA = 1;
  let bookB = 1;
  /** Every row this run made, so teardown deletes by id and never by a pattern a
   *  genuine clinic row could also match. */
  const createdBillIds: number[] = [];
  const createdOrderIds: number[] = [];
  const createdExamIds: number[] = [];
  const createdPatientIds: number[] = [];
  const createdTestIds: number[] = [];
  const createdReportIds: number[] = [];
  const createdLedgerIds: number[] = [];

  async function makeStaff(name: string, permissions: string[], role = "receptionist"): Promise<string> {
    const token = `vitest-wrd-${randomUUID()}`;
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

  /** Same shape the printed slip carries: a 6-digit book stamp plus a 4-digit
   *  sequence. Anything longer is a phone number and the counter refuses it, which
   *  would make these tests measure the parser instead of the desk. */
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
    createdPatientIds.push(p.id);
    return p.id;
  }

  async function makeTest(name: string) {
    const [t] = await db
      .insert(testsTable)
      .values({
        code: `W-${name}-${marker}`, name: `${name} ${marker}`, category: "MRI",
        duration: "30", price: "4000.00", department: "MRI",
      })
      .returning({ id: testsTable.id });
    createdTestIds.push(t.id);
    return t.id;
  }

  /** A bill and its order, with one billed examination line per test id given.
   *
   * The order is what makes the examinations listable: a Word report has no row of
   * its own, so `order_tests` is the only thing in CARE that says paper exists.
   *
   * EVERY TEST MAKES ITS OWN BILL. Sharing one bill across the file would make the
   * assertions order-dependent, and a counter that has already received two of the
   * three sheets answers differently from a fresh one — which is the behaviour worth
   * testing, not an obstacle to it. */
  async function makeBill(
    patientId: number,
    paid: string,
    total: string,
    testIds: number[],
    opts: { ledgerId?: number; billNumber?: string } = {},
  ): Promise<{ id: number; number: string; orderId: number; examIds: number[] }> {
    seq += 1;
    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `O-${marker}-${seq}`, patientId })
      .returning({ id: ordersTable.id });
    createdOrderIds.push(order.id);
    const billNumber = opts.billNumber ?? (await freeBillNumber());
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
        ...(opts.ledgerId != null ? { ledgerId: opts.ledgerId } : {}),
      })
      .returning({ id: billsTable.id });
    createdBillIds.push(bill.id);
    const examIds: number[] = [];
    for (const t of testIds) {
      const [exam] = await db
        .insert(orderTestsTable)
        .values({ orderId: order.id, testId: t, price: "4000.00" })
        .returning({ id: orderTestsTable.id });
      createdExamIds.push(exam.id);
      examIds.push(exam.id);
    }
    return { id: bill.id, number: billNumber, orderId: order.id, examIds };
  }

  /** Three Word examinations on a settled bill — the ordinary case. */
  const wordBill = (patientId = patientA) => makeBill(patientId, "12000.00", "12000.00", [testA, testB, testC]);
  /** One Word examination on a bill with money still owed. */
  const dueWordBill = (patientId = patientA) => makeBill(patientId, "1000.00", "12000.00", [testA]);

  /** A report row for an examination — only for the tests that prove the row wins. */
  async function makeReportRow(args: {
    orderTestId: number | null; testId: number; billId: number; patientId: number;
  }) {
    seq += 1;
    const reportNumber = `RPT-20261026-${digits.slice(0, 8)}${String(seq).padStart(2, "0")}`;
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber,
        type: "radiology",
        patientId: args.patientId,
        testId: args.testId,
        orderTestId: args.orderTestId,
        billId: args.billId,
        title: `Word probe row ${seq}`,
        status: "pending_verification",
        body: `WORD-BODY-${marker}`,
        signedAt: new Date(),
        signatureId: 1,
        signedByName: "Dr Sugandha",
      })
      .returning({ id: patientReportsTable.id });
    createdReportIds.push(row.id);
    return { id: row.id, code: reportNumber };
  }

  const scan = (token: string, code: string) =>
    request(app).post("/api/report-custody/scan").set("Authorization", `Bearer ${token}`).send({ code });

  const billRead = (token: string, code: string) =>
    request(app).post("/api/report-custody/bill").set("Authorization", `Bearer ${token}`).send({ code });

  const receive = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/receive").set("Authorization", `Bearer ${token}`).send(body);

  const handover = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/report-custody/handover").set("Authorization", `Bearer ${token}`).send(body);

  /** Ledger rows for one examination, newest first. The examination is the identity
   *  here, so this — not `reportId` — is what a dispute is read from. */
  const examRows = (orderTestId: number) =>
    db
      .select()
      .from(reportCustodyEventsTable)
      .where(eq(reportCustodyEventsTable.orderTestId, orderTestId))
      .orderBy(reportCustodyEventsTable.id);

  const rowsFor = async (examIds: number[]) => {
    const rows = await db
      .select({ id: reportCustodyEventsTable.id, exam: reportCustodyEventsTable.orderTestId })
      .from(reportCustodyEventsTable)
      .where(inArray(reportCustodyEventsTable.orderTestId, examIds));
    return rows;
  };

  beforeAll(async () => {
    app = await createTestApp();

    testA = await makeTest("MRI Brain");
    testB = await makeTest("CT Chest");
    testC = await makeTest("Xray LS");

    patientA = await makePatient("Alpha");
    patientB = await makePatient("Beta");

    const [a, b] = await Promise.all([
      db.insert(ledgersTable).values({ name: `Book A ${marker}` }).returning({ id: ledgersTable.id }),
      db.insert(ledgersTable).values({ name: `Book B ${marker}` }).returning({ id: ledgersTable.id }),
    ]);
    bookA = a[0].id;
    bookB = b[0].id;
    createdLedgerIds.push(bookA, bookB);

    [receiver, deliverer] = await Promise.all([
      makeStaff(`Word Receiver ${marker}`, ["/report-delivery:receive"]),
      makeStaff(`Word Deliverer ${marker}`, ["/report-delivery:handover"]),
    ]);
  });

  afterAll(async () => {
    // Every delete is scoped to ids THIS run created. A scratch database is not a
    // reason to write a delete that could match a real clinic row.
    if (createdExamIds.length > 0) {
      await db
        .delete(reportCustodyEventsTable)
        .where(inArray(reportCustodyEventsTable.orderTestId, createdExamIds))
        .catch(() => {});
    }
    await db.delete(scanAuditLogsTable).where(like(scanAuditLogsTable.username, `%${marker}%`)).catch(() => {});
    if (createdReportIds.length > 0) {
      await db.delete(patientReportsTable).where(inArray(patientReportsTable.id, createdReportIds)).catch(() => {});
    }
    if (createdBillIds.length > 0) {
      await db.delete(billsTable).where(inArray(billsTable.id, createdBillIds)).catch(() => {});
    }
    if (createdExamIds.length > 0) {
      await db.delete(orderTestsTable).where(inArray(orderTestsTable.id, createdExamIds)).catch(() => {});
    }
    if (createdOrderIds.length > 0) {
      await db.delete(ordersTable).where(inArray(ordersTable.id, createdOrderIds)).catch(() => {});
    }
    if (createdTestIds.length > 0) {
      await db.delete(testsTable).where(inArray(testsTable.id, createdTestIds)).catch(() => {});
    }
    if (createdPatientIds.length > 0) {
      await db.delete(patientsTable).where(inArray(patientsTable.id, createdPatientIds)).catch(() => {});
    }
    if (createdLedgerIds.length > 0) {
      await db.delete(ledgersTable).where(inArray(ledgersTable.id, createdLedgerIds)).catch(() => {});
    }
    await db.delete(portalSessionsTable).where(like(portalSessionsTable.token, "vitest-wrd-%")).catch(() => {});
    await db.delete(usersTable).where(like(usersTable.email, `%${marker}@vitest.invalid`)).catch(() => {});
  });

  // ─── the bill scan ─────────────────────────────────────────────────────────

  it("lists the examinations a bill bought when CARE holds no report for any of them", async () => {
    const bill = await wordBill();
    const res = await scan(receiver, `http://localhost/api/verify/bill/${bill.number}?hash=abc`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.outcome).toBe("bill");
    // "Display the patient and examinations associated with the bill."
    expect(res.body.patient.name).toContain("Alpha");
    expect(res.body.bill.settled).toBe(true);
    expect(res.body.examinations).toHaveLength(3);
    expect(res.body.examinations.map((e: { testName: string }) => e.testName)).toEqual([
      `MRI Brain ${marker}`,
      `CT Chest ${marker}`,
      `Xray LS ${marker}`,
    ]);
    for (const e of res.body.examinations) {
      expect(e.wordOnly).toBe(true);
      expect(e.candidate.reportId).toBeNull();
      expect(e.candidate.verdict).toBe("WORD_REPORT_NOT_REGISTERED");
    }
    // Three examinations, zero writes: the scan is a question.
    expect(await rowsFor(bill.examIds)).toEqual([]);
  });

  it("says what the clerk has to do about a Word report, in the response the desk reads", async () => {
    const bill = await wordBill();
    const res = await scan(receiver, bill.number);
    expect(res.status, res.text).toBe(200);
    const line = res.body.examinations[0];
    // "No signature recorded" would send the clerk to a doctor who did sign the
    // paper. The sentence has to name the missing step.
    expect(line.candidate.message).toMatch(/typed in Word/);
    expect(line.candidate.message).toMatch(/who signed/);
  });

  it("excludes a cancelled line item, because its paper cannot be arriving", async () => {
    const bill = await wordBill();
    await db
      .update(orderTestsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "patient left" })
      .where(eq(orderTestsTable.id, bill.examIds[1]));
    const res = await scan(receiver, bill.number);
    expect(res.status, res.text).toBe(200);
    expect(res.body.examinations).toHaveLength(2);
    expect(res.body.examinations.map((e: { orderTestId: number }) => e.orderTestId)).not.toContain(bill.examIds[1]);
  });

  it("refuses a bill number two books issued instead of guessing the patient", async () => {
    const shared = await freeBillNumber();
    // Bill numbers are unique per BOOK, so two patients can legitimately hold the
    // same one — and the counter must refuse rather than pick, because choosing is
    // the wrong-patient failure this ledger exists to make visible.
    await makeBill(patientA, "12000.00", "12000.00", [testA], { ledgerId: bookA, billNumber: shared });
    await makeBill(patientB, "12000.00", "12000.00", [testA], { ledgerId: bookB, billNumber: shared });
    const res = await scan(receiver, shared);
    expect(res.status, res.text).toBe(422);
    expect(res.body.reason).toBe("AMBIGUOUS_BILL");
    expect(res.body.message).toMatch(/more than one book/);
  });

  // ─── receiving Word paper ──────────────────────────────────────────────────

  it("refuses a Word report nobody has named a signer for, and writes nothing", async () => {
    const bill = await wordBill();
    const res = await receive(receiver, {
      requestId: randomUUID(),
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.received).toBe(0);
    expect(res.body.results[0].reason).toBe("WORD_REPORT_NOT_REGISTERED");
    expect(await examRows(bill.examIds[0])).toHaveLength(0);
  });

  it("records the paper against the examination, with the clerk's named signature", async () => {
    const bill = await wordBill();
    const res = await receive(receiver, {
      requestId: randomUUID(),
      // A body that tries to name a different clerk must not be believed: the
      // session is the actor, always.
      actorName: "Somebody Else",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Sugandha Agarwal" }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.received, res.text).toBe(1);

    const rows = await examRows(bill.examIds[0]);
    expect(rows).toHaveLength(1);
    const event = rows[0];
    expect(event.event).toBe("RECEIVED_AT_DELIVERY_COUNTER");
    expect(event.outcome).toBe("completed");
    // The owner's ruling: the examination is the identity, and there is no row.
    expect(event.reportId).toBeNull();
    expect(event.reportNumber).toBeNull();
    expect(event.orderTestId).toBe(bill.examIds[0]);
    expect(event.billId).toBe(bill.id);
    expect(event.patientId).toBe(patientA);
    expect(event.scannedCode).toBe(bill.number);
    expect(event.actorName).toBe(`Word Receiver ${marker}`);
    expect(event.verification).toMatchObject({
      rule: "paper_signature_acknowledged",
      paperSignedByName: "Dr Sugandha Agarwal",
      clinicalTextStored: false,
    });
  });

  it("creates no report row and leaves the clinical tables alone", async () => {
    const bill = await wordBill();
    const res = await receive(receiver, {
      requestId: randomUUID(),
      items: bill.examIds.map((orderTestId) => ({
        orderTestId,
        scannedCode: bill.number,
        paperSignedByName: "Dr Sugandha",
      })),
    });
    expect(res.body.received, res.text).toBe(3);

    const rows = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(inArray(patientReportsTable.orderTestId, bill.examIds));
    // Registering a Word report at the counter must not invent a CARE report — the
    // document stays outside CARE, exactly as the owner required.
    expect(rows).toHaveLength(0);
    expect(await rowsFor(bill.examIds)).toHaveLength(3);
  });

  it("receipts two examinations of a three-examination bill and leaves the third", async () => {
    const bill = await wordBill();
    const res = await receive(receiver, {
      requestId: randomUUID(),
      items: [
        { orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Sugandha" },
        { orderTestId: bill.examIds[2], scannedCode: bill.number, paperSignedByName: "Dr Mehta" },
      ],
    });
    expect(res.body.received, res.text).toBe(2);
    expect(await examRows(bill.examIds[0])).toHaveLength(1);
    expect(await examRows(bill.examIds[1])).toHaveLength(0);
    expect(await examRows(bill.examIds[2])).toHaveLength(1);

    // And the desk now shows the difference: two arrived, one still missing.
    const again = await scan(receiver, bill.number);
    const byId = new Map(
      again.body.examinations.map(
        (e: { orderTestId: number; physicalState: string | null }) => [e.orderTestId, e.physicalState],
      ),
    );
    expect(byId.get(bill.examIds[0])).toBe("AT_COUNTER");
    expect(byId.get(bill.examIds[1])).toBeNull();
    expect(byId.get(bill.examIds[2])).toBe("AT_COUNTER");
  });

  it("will not let a second clerk open a second receipt for the same Word paper", async () => {
    const bill = await wordBill();
    const first = await receive(receiver, {
      requestId: randomUUID(),
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Sugandha" }],
    });
    expect(first.body.received, first.text).toBe(1);

    const secondClerk = await makeStaff(`Second Receiver ${marker}`, ["/report-delivery:receive"]);
    const again = await receive(secondClerk, {
      requestId: randomUUID(),
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Someone Else" }],
    });
    expect(again.status, again.text).toBe(200);
    expect(again.body.received).toBe(0);
    expect(again.body.results[0].reason).toBe("ALREADY_AT_COUNTER");
    // One open receipt, in the database's own words — `rce_open_receipt_exam_uq`.
    const rows = await examRows(bill.examIds[0]);
    expect(rows.filter((r) => r.event === "RECEIVED_AT_DELIVERY_COUNTER")).toHaveLength(1);
    // The first clerk's account of who signed stays the record.
    expect(rows[0].verification).toMatchObject({ paperSignedByName: "Dr Sugandha" });
  });

  it("returns the same event when a Word receipt is confirmed twice", async () => {
    const bill = await wordBill();
    const requestId = randomUUID();
    const items = [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Dr Sugandha" }];
    const first = await receive(receiver, { requestId, items });
    const retry = await receive(receiver, { requestId, items });
    expect(first.body.received).toBe(1);
    expect(retry.body.received, "a resending browser is the same act").toBe(1);
    expect(retry.body.results[0].eventId).toBe(first.body.results[0].eventId);
    expect(await examRows(bill.examIds[0])).toHaveLength(1);
  });

  it("refuses an item that names neither a report nor an examination", async () => {
    const res = await receive(receiver, { requestId: randomUUID(), items: [{ scannedCode: "12345" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportId or an orderTestId/);
  });

  // ─── handing Word paper over ───────────────────────────────────────────────

  /** The two-step flow, as the desk runs it: the receiver registers the paper, a
   *  different person hands it over. */
  async function receiveWord(bill: { number: string }, examIds: number[]) {
    const res = await receive(receiver, {
      requestId: randomUUID(),
      items: examIds.map((orderTestId) => ({
        orderTestId,
        scannedCode: bill.number,
        paperSignedByName: "Dr Sugandha",
      })),
    });
    expect(res.body.received, res.text).toBe(examIds.length);
  }

  it("lists a received Word examination as ready, on the same bill scan", async () => {
    const bill = await wordBill();
    await receiveWord(bill, [bill.examIds[0]]);
    const res = await billRead(deliverer, bill.number);
    expect(res.status, res.text).toBe(200);
    const row = res.body.examinations.find((e: { orderTestId: number }) => e.orderTestId === bill.examIds[0]);
    expect(row.wordOnly).toBe(true);
    expect(row.candidate.reportId).toBeNull();
    expect(row.candidate.handoverVerdict).toBe("DELIVERABLE");
    expect(await rowsFor(bill.examIds)).toHaveLength(1);
  });

  it("refuses to hand over Word paper the counter never received", async () => {
    const bill = await wordBill();
    const res = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.handed).toBe(0);
    expect(res.body.results[0].reason).toBe("NOT_SIGNED");
    // Not "it is unsigned" — that would send the clerk to a doctor who signed it.
    expect(res.body.results[0].message).toMatch(/not been received at the counter/);
    expect(await examRows(bill.examIds[0])).toHaveLength(0);
  });

  it("hands Word paper over in one event, and refuses to do it twice", async () => {
    const bill = await wordBill();
    await receiveWord(bill, [bill.examIds[0]]);

    const res = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "FAMILY_MEMBER",
      recipientName: "son",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.handed, res.text).toBe(1);

    const rows = await examRows(bill.examIds[0]);
    expect(rows).toHaveLength(2);
    const given = rows.find((r) => r.event === "PHYSICALLY_HANDED_OVER")!;
    expect(given.reportId).toBeNull();
    expect(given.recipientCategory).toBe("FAMILY_MEMBER");
    expect(given.verification).toMatchObject({
      rule: "paper_signature_acknowledged_at_receipt",
      paperSignedByName: "Dr Sugandha",
      precededByReceipt: true,
      clinicalTextStored: false,
    });

    const twice = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(twice.body.handed).toBe(0);
    expect(twice.body.results[0].reason).toBe("ALREADY_HANDED_OVER");
    const after = await examRows(bill.examIds[0]);
    expect(after.filter((r) => r.event === "PHYSICALLY_HANDED_OVER")).toHaveLength(1);

    // The desk now reads the paper as gone, from the ledger alone.
    const again = await scan(receiver, bill.number);
    const row = again.body.examinations.find((e: { orderTestId: number }) => e.orderTestId === bill.examIds[0]);
    expect(row.physicalState).toBe("HANDED_OVER");
  });

  it("holds an outstanding bill over a Word report exactly as it does a Composer one", async () => {
    const bill = await dueWordBill();
    await receiveWord(bill, [bill.examIds[0]]);

    const refused = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(refused.body.results[0].reason).toBe("PAYMENT_OUTSTANDING");
    expect(await examRows(bill.examIds[0])).toHaveLength(1);

    const given = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      paymentOverrideReason: "promised at the window",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(given.body.handed, given.text).toBe(1);
    const rows = await examRows(bill.examIds[0]);
    const event = rows.find((r) => r.event === "PHYSICALLY_HANDED_OVER")!;
    expect(event.overrideReason).toBe("promised at the window");
    expect(event.paymentSnapshot).toMatchObject({ status: "measured", billNumber: bill.number });
  });

  it("refuses an examination another patient's bill bought", async () => {
    const mine = await wordBill(patientA);
    const theirs = await wordBill(patientB);
    await receiveWord(theirs, [theirs.examIds[0]]);

    const res = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: mine.number,
      recipientCategory: "PATIENT",
      // Hand-written: a tick list cannot offer another patient's line, so this is
      // the forged-request case, and it must be a refusal rather than a filing.
      items: [{ orderTestId: theirs.examIds[0], scannedCode: mine.number }],
    });
    expect(res.body.handed).toBe(0);
    expect(res.body.results[0].reason).toBe("NOT_ON_THIS_BILL");
    expect(await examRows(theirs.examIds[0])).toHaveLength(1);
    expect(await examRows(mine.examIds[0])).toHaveLength(0);
  });

  it("lists a row the bill carries with no order-test link as the row it is", async () => {
    // The shape a lot of real paper has: the report knows its BILL and its TEST and
    // nothing else, while the bill's order does hold a line for that test. Resolving
    // it from the row is what stops the desk telling the clerk that a report CARE
    // holds is an unregistered Word paper that somebody has to re-attest.
    const bill = await makeBill(patientA, "4000.00", "4000.00", [testA]);
    const report = await makeReportRow({
      orderTestId: null,
      testId: testA,
      billId: bill.id,
      patientId: patientA,
    });

    const res = await scan(receiver, bill.number);
    expect(res.status, res.text).toBe(200);
    expect(res.body.examinations).toHaveLength(1);
    const exam = res.body.examinations[0];
    expect(exam.wordOnly, "a report row must never be offered as a Word paper").toBe(false);
    expect(exam.candidate.reportId).toBe(report.id);
    expect(exam.candidate.reportNumber).toBe(report.code);
    expect(exam.candidate.verdict).toBe("RECEIVED");
  });

  it("uses the report row as the identity when the examination has one", async () => {
    const bill = await wordBill();
    const report = await makeReportRow({
      orderTestId: bill.examIds[0],
      testId: testA,
      billId: bill.id,
      patientId: patientA,
    });

    // Listed from the row, not as a Word paper: every check PR-3/PR-4 already makes
    // still applies to a report CARE produced, even when the scan found it through
    // its examination.
    const scan_ = await scan(receiver, bill.number);
    const row = scan_.body.examinations.find((e: { orderTestId: number }) => e.orderTestId === bill.examIds[0]);
    expect(row.wordOnly).toBe(false);
    expect(row.candidate.reportId).toBe(report.id);

    const res = await receive(receiver, {
      requestId: randomUUID(),
      // Named by examination, with a signer the clerk typed. The row's own signature
      // is the authority, so the request must not be able to restate it.
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number, paperSignedByName: "Not The Signer" }],
    });
    expect(res.body.received, res.text).toBe(1);

    const rows = await examRows(bill.examIds[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reportId, "the row is the identity whenever a row exists").toBe(report.id);
    expect(rows[0].reportNumber).toBe(report.code);
    // And the typed name is DISCARDED, not filed: for a report CARE wrote, the
    // signature on the row is the evidence. A second, clerk-authored signature on the
    // same event would be two answers to "who signed this", and the ledger would not
    // say which one a dispute should read.
    expect(rows[0].verification).toMatchObject({
      rule: "signed_or_countersigned",
      paperSignedByName: null,
      acknowledgedByName: null,
    });

    // Handing the same paper over BY EXAMINATION must still file it under its ROW.
    // The receipt proves the rule for one direction; a handover that quietly took
    // the examination path instead would leave one sheet with two identities in the
    // ledger, which is the drift the whole delegation exists to close.
    const given = await handover(deliverer, {
      requestId: randomUUID(),
      billCode: bill.number,
      recipientCategory: "PATIENT",
      items: [{ orderTestId: bill.examIds[0], scannedCode: bill.number }],
    });
    expect(given.body.handed, given.text).toBe(1);
    const handed = (await examRows(bill.examIds[0]))
      .find((r) => r.event === "PHYSICALLY_HANDED_OVER")!;
    expect(handed.reportId, "a row-backed paper is handed over under the row").toBe(report.id);
    expect(handed.reportNumber).toBe(report.code);
    expect(handed.verification).toMatchObject({ rule: "signed_or_countersigned" });
  });

  it("lists one report row once, even when two lines bought the same test", async () => {
    // A repeat study is two `order_tests` rows for one test id, and CARE holds one
    // report row for the pair (written by bill and test, with no order_test_id).
    // Claiming that row under both lines would show the clerk one sheet of paper
    // twice — and one confirmation would then record the same arrival two times.
    seq += 1;
    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `O-TWICE-${marker}-${seq}`, patientId: patientA })
      .returning({ id: ordersTable.id });
    createdOrderIds.push(order.id);
    const billNumber = await freeBillNumber();
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber,
        orderId: order.id,
        patientId: patientA,
        subtotal: "8000.00",
        totalAmount: "8000.00",
        paidAmount: "8000.00",
        balanceAmount: "0.00",
        status: "paid",
      })
      .returning({ id: billsTable.id });
    createdBillIds.push(bill.id);
    const twoLines: number[] = [];
    for (const _ of [0, 1]) {
      const [exam] = await db
        .insert(orderTestsTable)
        .values({ orderId: order.id, testId: testA, price: "4000.00" })
        .returning({ id: orderTestsTable.id });
      createdExamIds.push(exam.id);
      twoLines.push(exam.id);
    }
    const report = await makeReportRow({
      orderTestId: twoLines[0],
      testId: testA,
      billId: bill.id,
      patientId: patientA,
    });

    const res = await scan(receiver, billNumber);
    expect(res.status, res.text).toBe(200);
    const keys = res.body.examinations.map((e: { candidate: { rowKey: string } }) => e.candidate.rowKey);
    expect(new Set(keys).size, `one row must not appear twice: ${JSON.stringify(keys)}`).toBe(keys.length);
    expect(keys.filter((k: string) => k === `report:${report.id}`)).toHaveLength(1);
  });

  it("keeps report content out of a Word custody response and ledger", async () => {
    const bill = await wordBill();
    const report = await makeReportRow({
      orderTestId: bill.examIds[0],
      testId: testA,
      billId: bill.id,
      patientId: patientA,
    });
    void report;
    const s = await scan(receiver, bill.number);
    expect(JSON.stringify(s.body)).not.toContain(`WORD-BODY-${marker}`);
    const b = await billRead(deliverer, bill.number);
    expect(JSON.stringify(b.body)).not.toContain(`WORD-BODY-${marker}`);
    const res = await receive(receiver, {
      requestId: randomUUID(),
      items: bill.examIds.slice(1).map((orderTestId) => ({
        orderTestId,
        scannedCode: bill.number,
        paperSignedByName: "Dr Sugandha",
      })),
    });
    expect(res.body.received, res.text).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain(`WORD-BODY-${marker}`);
    const rows = await rowsFor(bill.examIds);
    expect(JSON.stringify(rows)).not.toContain(`WORD-BODY-${marker}`);
  });
});
