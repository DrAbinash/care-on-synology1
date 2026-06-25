/**
 * Barcode Resolver
 *
 * GET /api/resolve-barcode/:code
 *   Looks up a scanned barcode across samples, orders, bills, and reports.
 *   Returns the matching entity + patient + order context so the frontend
 *   can route to ReportGenerator, ScanStation, or ReportDelivery.
 *
 * GET /api/resolve-barcode/patient/:patientId/reports
 *   Lists all ready (verified/completed/reported) patient reports for delivery.
 *
 * POST /api/resolve-barcode/reports/:id/deliver
 *   Marks a report as delivered (records delivery timestamp).
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  samplesTable, ordersTable, orderTestsTable, testsTable,
  patientsTable, doctorsTable, billsTable, patientReportsTable,
  reportDeliveryLogsTable, radiologyStudiesTable, radiologyWorklistTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";

const router: IRouter = Router();
router.use(requireStaffAuth);

// ─── GET /api/resolve-barcode/:code ─────────────────────────────────────────
router.get("/:code", async (req, res) => {
  const code = (req.params.code ?? "").trim();
  if (!code) { res.status(400).json({ error: "Code is required" }); return; }

  // 1. Try sample barcode exact match (most common for scan station).
  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.barcode, code));
  if (sample) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, sample.patientId));
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, sample.orderId));
    let doctor = null;
    if (order?.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
      doctor = d ?? null;
    }
    return res.json({
      type: "sample",
      code: sample.barcode,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: order ? { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(order.createdAt) } : null,
      sample: { id: sample.id, barcode: sample.barcode, status: sample.status, sampleType: sample.sampleType },
    });
  }

  // 2. Try order number.
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.orderNumber, code));
  if (order) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, order.patientId));
    let doctor = null;
    if (order.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
      doctor = d ?? null;
    }
    const ots = await db.select({ ot: orderTestsTable, test: testsTable }).from(orderTestsTable).leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id)).where(eq(orderTestsTable.orderId, order.id));
    return res.json({
      type: "order",
      code: order.orderNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(order.createdAt) },
      tests: ots.map((r) => ({ id: r.test?.id ?? r.ot.id, name: r.test?.name ?? "Unknown", code: r.test?.code ?? "", price: Number(r.test?.price ?? r.ot.price), orderTestId: r.ot.id })),
    });
  }

  // 3. Try bill number (numeric format or legacy BILL- prefix, or exact match).
  const billMatch = /^\d{10,}$/.test(code) ? code : null;
  const [bill] = billMatch
    ? await db.select().from(billsTable).where(eq(billsTable.billNumber, billMatch))
    : await db.select().from(billsTable).where(eq(billsTable.billNumber, code));
  if (bill) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, bill.patientId));
    let doctor = null;
    const [billOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, bill.orderId));
    if (billOrder?.doctorId) {
      const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, billOrder.doctorId));
      doctor = d ?? null;
    }
    return res.json({
      type: "bill",
      code: bill.billNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: billOrder ? { id: billOrder.id, orderNumber: billOrder.orderNumber, patientId: billOrder.patientId, doctorId: billOrder.doctorId, doctor: doctor ? { name: doctor.name, specialization: doctor.specialization } : null, createdAt: String(billOrder.createdAt) } : null,
      tests: [],
    });
  }

  // 4. Try report number.
  const [report] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.reportNumber, code));
  if (report) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, report.patientId));
    const [test] = await db.select().from(testsTable).where(eq(testsTable.id, report.testId));
    return res.json({
      type: "report",
      code: report.reportNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      report: { id: report.id, reportNumber: report.reportNumber, title: report.title, status: report.status, deliveredAt: report.deliveredAt ? String(report.deliveredAt) : null, type: report.type },
    });
  }

  // 4b. Try report by ID if code is numeric.
  if (/^\d+$/.test(code)) {
    const [reportById] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, Number(code)));
    if (reportById) {
      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, reportById.patientId));
      return res.json({
        type: "report",
        code: reportById.reportNumber,
        patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: patient.ageUnit, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
        report: { id: reportById.id, reportNumber: reportById.reportNumber, title: reportById.title, status: reportById.status, deliveredAt: reportById.deliveredAt ? String(reportById.deliveredAt) : null, type: reportById.type },
      });
    }
  }

  // 5. Try patient ID (internal patientId string like P-2025-0001).
  const [patientByCode] = await db.select().from(patientsTable).where(eq(patientsTable.patientId, code));
  if (patientByCode) {
    return res.json({
      type: "order",
      code: patientByCode.patientId,
      patient: { id: patientByCode.id, firstName: patientByCode.firstName, lastName: patientByCode.lastName, patientId: patientByCode.patientId, gender: patientByCode.gender, dateOfBirth: String(patientByCode.dateOfBirth), ageValue: patientByCode.ageValue, ageUnit: patientByCode.ageUnit, phone: patientByCode.phone ?? "", bloodGroup: patientByCode.bloodGroup ?? null },
      order: null,
      tests: [],
    });
  }

  // 6. Try patient phone / mobile number.
  const [patientByPhone] = await db.select().from(patientsTable).where(eq(patientsTable.phone, code));
  if (patientByPhone) {
    return res.json({
      type: "patient",
      code: patientByPhone.patientId,
      patient: { id: patientByPhone.id, firstName: patientByPhone.firstName, lastName: patientByPhone.lastName, patientId: patientByPhone.patientId, gender: patientByPhone.gender, dateOfBirth: String(patientByPhone.dateOfBirth), ageValue: patientByPhone.ageValue, ageUnit: patientByPhone.ageUnit, phone: patientByPhone.phone ?? "", bloodGroup: patientByPhone.bloodGroup ?? null },
      order: null,
      tests: [],
    });
  }

  // 7. Try accession number (radiology studies).
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.accessionNumber, code));
  if (study) {
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, study.patientId));
    const [order] = study.orderId
      ? await db.select().from(ordersTable).where(eq(ordersTable.id, study.orderId))
      : [null];
    return res.json({
      type: "order",
      code: study.accessionNumber,
      patient: patient ? { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, patientId: patient.patientId, gender: patient.gender, dateOfBirth: String(patient.dateOfBirth), ageValue: patient.ageValue, ageUnit: study.patientId ? patient.ageUnit : null, phone: patient.phone ?? "", bloodGroup: patient.bloodGroup ?? null } : null,
      order: order ? { id: order.id, orderNumber: order.orderNumber, patientId: order.patientId, doctorId: order.doctorId, doctor: null, createdAt: String(order.createdAt) } : null,
    });
  }

  return res.status(404).json({ error: "No matching sample, order, bill, report, patient, phone, or accession number found" });
});

// ─── GET /api/resolve-barcode/patient/:patientId/reports ────────────────────
router.get("/patient/:patientId/reports", async (req, res) => {
  const patientId = Number(req.params.patientId);
  if (!Number.isFinite(patientId)) { res.status(400).json({ error: "Invalid patientId" }); return; }

  const rows = await db
    .select({
      r: patientReportsTable,
      testName: testsTable.name,
      testCode: testsTable.code,
    })
    .from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.patientId, patientId))
    .orderBy(desc(patientReportsTable.createdAt));

  const reports = rows.map((row) => ({
    id: row.r.id,
    reportNumber: row.r.reportNumber,
    type: row.r.type,
    testId: row.r.testId,
    orderTestId: row.r.orderTestId,
    orderId: row.r.orderId,
    title: row.r.title,
    status: row.r.status,
    deliveredAt: row.r.deliveredAt ? String(row.r.deliveredAt) : null,
    body: row.r.body,
    impression: row.r.impression,
    signedByName: row.r.signedByName,
    verifiedByName: row.r.verifiedByName,
    createdAt: String(row.r.createdAt),
    testName: row.testName,
    testCode: row.testCode,
    isDelivered: !!row.r.deliveredAt,
    deliveredBy: row.r.deliveredBy,
  }));

  res.json({ patientId, reports });
});

// ─── POST /api/resolve-barcode/reports/:id/deliver ──────────────────────────
router.post("/reports/:id/deliver", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [report] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  // Verify match status for delivery
  if (report.type === "radiology" || report.studyId) {
    const rStudyId = report.studyId;
    if (rStudyId) {
      const [worklistRow] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.studyId, rStudyId))
        .limit(1);

      if (!worklistRow) {
        res.status(400).json({
          error: "mismatch_protection_triggered",
          message: "No DICOM study is linked to this billing order. Please link a study in Match Center first."
        });
        return;
      }

      if (worklistRow.matchScore !== "GREEN" && worklistRow.matchDecision !== "APPROVED") {
        const reason = worklistRow.matchScore === "YELLOW" ? "needs review" : "mismatch / possible wrong study";
        res.status(400).json({
          error: "mismatch_protection_triggered",
          message: `Report delivery is blocked. Match score is ${worklistRow.matchScore} (${reason}). Authorized manual approval/override is required in Match Center.`
        });
        return;
      }
    } else {
      res.status(400).json({
        error: "mismatch_protection_triggered",
        message: "No study linked to this report. Please link a study in Match Center first."
      });
      return;
    }
  }

  const staffName = (req as any).staffSession?.subjectName ?? "Staff";
  const now = new Date();

  const [updated] = await db
    .update(patientReportsTable)
    .set({ status: "delivered", deliveredAt: now, deliveredBy: staffName })
    .where(eq(patientReportsTable.id, id))
    .returning();

  // Audit log entry
  await db.insert(reportDeliveryLogsTable).values({
    reportId: id,
    patientId: report.patientId,
    deliveryMode: "HANDED",
    status: "sent",
    sentBy: staffName,
    sentAt: now,
  });

  res.json({ ...updated, isDelivered: true });
});

export default router;
