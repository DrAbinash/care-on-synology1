import { Router } from "express";
import { db, billsTable, patientsTable, formFRecordsTable, clinicSettingsTable } from "@workspace/db";
import { eq, or, ilike, inArray, isNotNull, desc, and, gte, lt, asc } from "drizzle-orm";
import { ordersTable, orderTestsTable, testsTable, doctorsTable } from "@workspace/db";
import { whatsappConversationsTable, whatsappSettingsTable, usgMeasurementsTable, radiologyStudiesTable, fetalUsgStudiesTable, fetalUsgMeasurementsTable, fetalUsgReportsTable, fetalUsgChecklistsTable } from "@workspace/db/schema";
import { dateToISTString } from "../lib/istDate";
import { type IdCardOcrResult } from "@workspace/integrations-gemini-ai";
import { runIdCardOcrPipeline, SERVER_BLUR_WARNING_THRESHOLD } from "../lib/ocr/idCardPipeline";
import { resolveOcrProvider, maskEndpointUrl, getGeminiOcrApiKey, type OcrUnavailableReason, type OcrProviderChoice } from "../lib/ocr/ocrProviderResolver";
import { requireStaffPermission, requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { sendTextMessageRaw, resolveNumber, normalizePhone } from "./whatsapp";
import { auditFromRequest } from "../lib/audit";
import { ensureSelfReferralPrescriptions } from "../lib/selfReferralPrescriptions";
import { selfReferralPrescriptionsTable } from "@workspace/db/schema";
import {
  parseRegisterQuery,
  istMonthWindowUtc,
  buildRegisterRows,
  registerRowsToCsv,
  isSelfReferralRecord,
  buildOpdRegisterRows,
  SELF_REFERRAL_OPD_DOCTOR,
  SELF_REFERRAL_OPD_SERVICE,
  SELF_REFERRAL_OPD_FEES,
} from "../lib/formFRegister";

const formFRouter = Router();

// ── Duplicate protection cache for latest-scan imports ──
const importedScanCache = new Map<string, number>(); // key -> timestamp

formFRouter.get("/fetch-billing/:search", async (req, res) => {
  try {
    const search = req.params.search.trim();

    let bill: typeof billsTable.$inferSelect | null = null;

    const byBillNumber = await db
      .select()
      .from(billsTable)
      .where(ilike(billsTable.billNumber, `%${search}%`))
      .limit(1);

    if (byBillNumber[0]) {
      bill = byBillNumber[0];
    } else {
      const patientRows = await db
        .select()
        .from(patientsTable)
        .where(
          or(
            ilike(patientsTable.patientId, `%${search}%`),
            ilike(patientsTable.firstName, `%${search}%`),
            ilike(patientsTable.lastName, `%${search}%`),
            ilike(patientsTable.phone, `%${search}%`)
          )
        )
        .limit(1);

      if (patientRows[0]) {
        const billRows = await db
          .select()
          .from(billsTable)
          .where(eq(billsTable.patientId, patientRows[0].id))
          .orderBy(billsTable.createdAt)
          .limit(1);
        if (billRows[0]) bill = billRows[0];
      }
    }

    if (!bill) {
      res.status(404).json({ error: "No billing record found" });
      return;
    }

    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, bill.patientId));

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, bill.orderId));

    let procedurePurpose = "";
    let referredBy = "Self";
    let referredByName = "";

    if (order) {
      const tests = await db
        .select({ test: testsTable })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(eq(orderTestsTable.orderId, order.id));

      procedurePurpose = tests
        .map((t) => t.test?.name)
        .filter(Boolean)
        .join(", ");

      if (order.doctorId) {
        const [doctor] = await db
          .select()
          .from(doctorsTable)
          .where(eq(doctorsTable.id, order.doctorId));
        if (doctor) {
          referredBy = "Doctor";
          referredByName = doctor.name;
        }
      }
    }

    const dob = patient?.dateOfBirth ?? "";
    let age = "";
    if (dob) {
      const birth = new Date(dob);
      const now = new Date();
      age = String(now.getFullYear() - birth.getFullYear());
    }

    // Look up any previously saved Form-F record for this patient to
    // pre-fill address and guardian name if the patient table is empty.
    let fallbackAddress = "";
    let fallbackGuardian = "";
    if (patient) {
      const [latestFormF] = await db
        .select({ address: formFRecordsTable.address, husbandFatherName: formFRecordsTable.husbandFatherName })
        .from(formFRecordsTable)
        .where(eq(formFRecordsTable.patientId, patient.id))
        .orderBy(desc(formFRecordsTable.createdAt))
        .limit(1);
      if (latestFormF) {
        fallbackAddress = latestFormF.address ?? "";
        fallbackGuardian = latestFormF.husbandFatherName ?? "";
      }
    }

    // Fetch active clinic settings
    const [settings] = await db.select().from(clinicSettingsTable).limit(1);

    let lmpWeeks = "";
    let gestationalAgeWeeks = "";
    let gestationalAgeDays = "";
    let ultrasoundResult = "Normal";
    let abnormality = "";
    let fetalUsgStudyId: number | null = null;

    if (settings?.autoPopulateFormFFromObMeasurements && bill) {
      const [study] = await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.billId, bill.id))
        .limit(1);

      if (study) {
        const [fetalStudy] = await db
          .select()
          .from(fetalUsgStudiesTable)
          .where(eq(fetalUsgStudiesTable.studyId, study.id))
          .limit(1);

        if (fetalStudy) {
          fetalUsgStudyId = fetalStudy.id;
          
          if (fetalStudy.gaWeeks !== null && fetalStudy.gaWeeks !== undefined) {
            gestationalAgeWeeks = String(fetalStudy.gaWeeks);
          }
          if (fetalStudy.gaDays !== null && fetalStudy.gaDays !== undefined) {
            gestationalAgeDays = String(fetalStudy.gaDays);
          }
          
          if (fetalStudy.lmp) {
            try {
              const lmpDate = new Date(fetalStudy.lmp);
              if (!isNaN(lmpDate.getTime())) {
                const diffTime = Math.abs(new Date().getTime() - lmpDate.getTime());
                const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
                lmpWeeks = String(diffWeeks);
              }
            } catch (e) {
              // Ignore invalid lmp format
            }
          }

          const [measurements] = await db
            .select()
            .from(fetalUsgMeasurementsTable)
            .where(eq(fetalUsgMeasurementsTable.studyId, fetalStudy.id))
            .limit(1);

          const [report] = await db
            .select()
            .from(fetalUsgReportsTable)
            .where(eq(fetalUsgReportsTable.studyId, fetalStudy.id))
            .limit(1);

          if (report && report.status === "finalized") {
            const hasAbnormal = report.impression?.toLowerCase().includes("abnormal") || 
                                report.findings?.toLowerCase().includes("abnormal") ||
                                report.findings?.toLowerCase().includes("anomaly") ||
                                report.findings?.toLowerCase().includes("malformation");
            if (hasAbnormal) {
              ultrasoundResult = "Abnormal";
              abnormality = report.impression || report.findings || "Congenital anomaly detected";
            }
          }

          if (measurements) {
            const summaryParts: string[] = [];
            if (measurements.crl) summaryParts.push(`CRL: ${measurements.crl}mm`);
            if (measurements.fetalHeartRate) summaryParts.push(`FHR: ${measurements.fetalHeartRate}bpm`);
            if (measurements.placentaLocation) summaryParts.push(`Placenta: ${measurements.placentaLocation}`);
            if (measurements.afi) {
              summaryParts.push(`Liquor: AFI ${measurements.afi}cm (${measurements.afiInterpretation || "Normal"})`);
            } else if (measurements.afiInterpretation) {
              summaryParts.push(`Liquor: ${measurements.afiInterpretation}`);
            }
            if (measurements.presentation) summaryParts.push(`Presentation: ${measurements.presentation}`);
            if (fetalStudy.edd) summaryParts.push(`EDD: ${fetalStudy.edd}`);

            if (summaryParts.length > 0) {
              if (ultrasoundResult === "Normal") {
                ultrasoundResult = `Normal (${summaryParts.join(", ")})`;
              } else {
                ultrasoundResult = `Abnormal: ${abnormality} (${summaryParts.join(", ")})`;
              }
            }
          }
        }
      }
    }

    res.json({
      billNumber: bill.billNumber,
      billDate: bill.createdAt ? dateToISTString(bill.createdAt) : "",
      patientName: patient
        ? `${patient.firstName} ${patient.lastName}`.trim()
        : "",
      age,
      husbandFatherName: fallbackGuardian,
      address: patient?.address ?? fallbackAddress,
      mobile: patient?.phone ?? "",
      referredBy,
      referredByName,
      procedurePurpose: procedurePurpose || "Obstetric ultrasonography",
      ultrasoundResult,
      abnormality,
      lmpWeeks: lmpWeeks || "",
      gestationalAgeWeeks,
      gestationalAgeDays,
      fetalUsgStudyId,
    });
  } catch (err) {
    console.error("[form-f] fetch-billing error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Zod schema for PCPNDT-required fields on Form F save
// Per PCPNDT Act: patient name, age, referring doctor, procedure, and date
// are mandatory for every record. Address and guardian name are required when
// enabled in clinic_settings (formFAddressRequired / formFGuardianRequired).
import { z as _z } from "zod";
const FormFSaveBody = _z.object({
  billId:              _z.number().optional(),
  billNumber:          _z.string().optional(),
  patientId:           _z.number().optional(),
  centreName:          _z.string().min(1, "Centre name is required"),
  registrationNo:      _z.string().min(1, "Registration number is required"),
  patientName:         _z.string().min(2, "Patient name is required"),
  age:                 _z.string().min(1, "Patient age is required"),
  husbandFatherName:   _z.string().optional().default(""),
  address:             _z.string().optional().default(""),
  mobile:              _z.string().optional().default(""),
  referredBy:          _z.string().optional().default("Self"),
  doctorName:          _z.string().min(1, "Doctor name is required"),
  procedure:           _z.string().min(1, "Procedure is required"),
  procedureDate:       _z.string().min(1, "Procedure date is required"),
  lmpWeeks:            _z.string().optional().default(""),
  gestationalAgeWeeks: _z.string().optional().default(""),
  gestationalAgeDays:  _z.string().optional().default(""),
  ultrasoundResult:    _z.string().optional().default(""),
  abnormality:         _z.string().optional().default(""),
  basisDiagnosis:      _z.string().optional().default(""),
  indicationOther:     _z.string().optional().default(""),
  prenatalResult:      _z.string().optional().default(""),
  resultConveyed:      _z.string().optional().default(""),
  mtpAdvised:          _z.string().optional().default(""),
  mtpDate:             _z.string().optional().default(""),
  geneticHistory:      _z.string().optional().default(""),
  childrenDetails:     _z.string().optional().default(""),
  previousChildIssue:  _z.string().optional().default(""),
  invasiveProcedure:   _z.string().optional().default(""),
  complication:        _z.string().optional().default(""),
  labTests:            _z.string().optional().default(""),
  procedurePurpose:    _z.string().optional().default(""),
  consentDate:         _z.string().optional().default(""),
  date:                _z.string().optional().default(""),
  place:               _z.string().optional().default(""),
  idCardFrontUrl:      _z.string().nullable().optional(),
  idCardBackUrl:       _z.string().nullable().optional(),
  idCardImageUrl:      _z.string().nullable().optional(),
  idCardExtractedName:    _z.string().nullable().optional(),
  idCardExtractedAddress: _z.string().nullable().optional(),
  idCardVerified:      _z.boolean().optional().default(false),
  fetalUsgStudyId:     _z.number().nullable().optional(),
});

formFRouter.post("/save", async (req, res) => {
  try {
    const body = req.body ?? {};

    // Server-side PCPNDT validation (Bug #15 — null bypass fix)
    const parsed = FormFSaveBody.safeParse({
      ...body,
      billId:   body.billId   ? Number(body.billId)   : undefined,
      patientId: body.patientId ? Number(body.patientId) : undefined,
      fetalUsgStudyId: body.fetalUsgStudyId ? Number(body.fetalUsgStudyId) : undefined,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Form F validation failed",
        field: firstIssue?.path?.[0] ?? "unknown",
        issues: parsed.error.issues.map((i) => ({ field: i.path[0], message: i.message })),
      });
      return;
    }

    // Check clinic settings for optional required fields
    const [settings] = await db.select({
      addressRequired:  clinicSettingsTable.formFAddressRequired,
      guardianRequired: clinicSettingsTable.formFGuardianRequired,
    }).from(clinicSettingsTable).limit(1);

    if (settings?.addressRequired && !parsed.data.address?.trim()) {
      res.status(400).json({ error: "Patient address is required (PCPNDT compliance)", field: "address" });
      return;
    }
    if (settings?.guardianRequired && !parsed.data.husbandFatherName?.trim()) {
      res.status(400).json({ error: "Husband / Father name is required (PCPNDT compliance)", field: "husbandFatherName" });
      return;
    }

    // Use validated data
    const d = parsed.data;
    let billId = d.billId;
    let patientId = d.patientId;

    if (!billId && d.billNumber) {
      const [bill] = await db
        .select()
        .from(billsTable)
        .where(ilike(billsTable.billNumber, d.billNumber.trim()))
        .limit(1);
      if (bill) {
        billId = bill.id;
        patientId = bill.patientId;
      }
    }

    const record: typeof formFRecordsTable.$inferInsert = {
      billId: billId ?? null,
      patientId: patientId ?? null,
      billNumber: d.billNumber ?? null,
      centreName: d.centreName,
      registrationNo: d.registrationNo,
      patientName: d.patientName,
      age: d.age,
      childrenDetails: d.childrenDetails,
      husbandFatherName: d.husbandFatherName,
      address: d.address,
      mobile: d.mobile,
      referredBy: d.referredBy,
      lmpWeeks: d.lmpWeeks,
      geneticHistory: d.geneticHistory,
      basisDiagnosis: d.basisDiagnosis,
      previousChildIssue: d.previousChildIssue,
      indicationOther: d.indicationOther,
      doctorName: d.doctorName,
      procedure: d.procedure,
      procedurePurpose: d.procedurePurpose,
      invasiveProcedure: d.invasiveProcedure,
      complication: d.complication,
      labTests: d.labTests,
      prenatalResult: d.prenatalResult,
      gestationalAgeWeeks: d.gestationalAgeWeeks,
      gestationalAgeDays: d.gestationalAgeDays,
      ultrasoundResult: d.ultrasoundResult,
      abnormality: d.abnormality,
      procedureDate: d.procedureDate,
      consentDate: d.consentDate,
      resultConveyed: d.resultConveyed,
      mtpAdvised: d.mtpAdvised,
      mtpDate: d.mtpDate,
      date: d.date,
      place: d.place,
      idCardImageUrl: d.idCardFrontUrl ?? d.idCardImageUrl ?? null,
      idCardFrontUrl: d.idCardFrontUrl ?? null,
      idCardBackUrl: d.idCardBackUrl ?? null,
      idCardExtractedName: d.idCardExtractedName ?? null,
      idCardExtractedAddress: d.idCardExtractedAddress ?? null,
      idCardVerified: d.idCardVerified,
      fetalUsgStudyId: d.fetalUsgStudyId ?? null,
    };

    const [saved] = await db.insert(formFRecordsTable).values(record).returning();

    // Auto-prescription hook: a self-referral/walk-in Form F TEST patient
    // (same both-criteria rule as the OPD register) gets the digitally
    // signed obstetrical-checkup advice prescription at save time.
    // Fire-and-forget with its own error log — a prescription problem must
    // never fail the statutory Form F save, and the OPD register re-ensures
    // idempotently as a safety net.
    if (isSelfReferralRecord(saved)) {
      void (async () => {
        const tests = await resolveFormFTestsByBillId(saved.billId != null ? [saved.billId] : []);
        if (hasFormFTestEvidence(saved.billId, tests)) {
          await ensureSelfReferralPrescriptions([saved]);
        }
      })().catch((err) =>
        console.error("[form-f] auto-prescription failed (will retry on register view):", err),
      );
    }

    res.json(saved);
  } catch (err) {
    console.error("[form-f] save error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

formFRouter.get("/pending", async (req, res) => {
  try {
    const dateRange = String(req.query.dateRange ?? "today").trim() as "today" | "yesterday" | "dayBefore" | "7days" | "all";

    const [settings] = await db.select().from(clinicSettingsTable).limit(1);
    const formFTestIds: number[] = JSON.parse(settings?.formFTestIds ?? "[]");

    if (formFTestIds.length === 0) {
      res.json([]);
      return;
    }

    // Compute IST date bounds for the chosen range
    const now = new Date();
    const istToday = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    let startDate: string | null = null;
    let endDate: string | null = null; // exclusive upper bound

    if (dateRange === "today") {
      startDate = istToday + "T00:00:00+05:30";
      endDate = istToday + "T23:59:59.999+05:30";
    } else if (dateRange === "yesterday") {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const ys = y.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      startDate = ys + "T00:00:00+05:30";
      endDate = ys + "T23:59:59.999+05:30";
    } else if (dateRange === "dayBefore") {
      const db = new Date(now); db.setDate(db.getDate() - 2);
      const dbs = db.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      startDate = dbs + "T00:00:00+05:30";
      endDate = dbs + "T23:59:59.999+05:30";
    } else if (dateRange === "7days") {
      const d7 = new Date(now); d7.setDate(d7.getDate() - 6);
      startDate = d7.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30";
      endDate = istToday + "T23:59:59.999+05:30";
    }

    // Build date filter conditions
    const dateFilters = [];
    if (startDate) dateFilters.push(gte(billsTable.createdAt, new Date(startDate)));
    if (endDate) dateFilters.push(lt(billsTable.createdAt, new Date(endDate)));

    // Bills that have at least one Form-F-required test (distinct on bill)
    const billsWithFormFTests = await db
      .selectDistinct({
        billId: billsTable.id,
        billNumber: billsTable.billNumber,
        patientId: billsTable.patientId,
        orderId: billsTable.orderId,
        createdAt: billsTable.createdAt,
      })
      .from(billsTable)
      .innerJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
      .innerJoin(orderTestsTable, eq(orderTestsTable.orderId, ordersTable.id))
      .where(and(inArray(orderTestsTable.testId, formFTestIds), ...dateFilters))
      .orderBy(desc(billsTable.createdAt));

    if (billsWithFormFTests.length === 0) { res.json([]); return; }

    // Bill IDs that already have Form F records
    const savedRecords = await db
      .select({ billId: formFRecordsTable.billId })
      .from(formFRecordsTable)
      .where(isNotNull(formFRecordsTable.billId));
    const savedBillIdSet = new Set(savedRecords.map((r) => r.billId).filter(Boolean));

    const pendingBills = billsWithFormFTests.filter((b) => !savedBillIdSet.has(b.billId));
    if (pendingBills.length === 0) { res.json([]); return; }

    // Patient details
    const patientIds = [...new Set(pendingBills.map((b) => b.patientId).filter(Boolean))] as number[];
    const patients = patientIds.length > 0
      ? await db.select().from(patientsTable).where(inArray(patientsTable.id, patientIds))
      : [];
    const patientMap = new Map(patients.map((p) => [p.id, p]));

    // Referring doctors per order
    const orderIds = [...new Set(pendingBills.map((b) => b.orderId))] as number[];
    const orders = orderIds.length > 0
      ? await db.select().from(ordersTable).where(inArray(ordersTable.id, orderIds))
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    const doctorIdSet = [...new Set(orders.map((o) => o.doctorId).filter(Boolean))] as number[];
    const doctors = doctorIdSet.length > 0
      ? await db.select().from(doctorsTable).where(inArray(doctorsTable.id, doctorIdSet))
      : [];
    const doctorMap = new Map(doctors.map((d) => [d.id, d]));

    // Form-F tests per order
    const allOrderTests = orderIds.length > 0
      ? await db
          .select({ orderId: orderTestsTable.orderId, testId: orderTestsTable.testId, testName: testsTable.name })
          .from(orderTestsTable)
          .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
          .where(inArray(orderTestsTable.orderId, orderIds))
      : [];

    const orderFormFTestsMap = new Map<number, string[]>();
    for (const ot of allOrderTests) {
      if (ot.testId && formFTestIds.includes(ot.testId) && ot.testName) {
        if (!orderFormFTestsMap.has(ot.orderId)) orderFormFTestsMap.set(ot.orderId, []);
        orderFormFTestsMap.get(ot.orderId)!.push(ot.testName);
      }
    }

    const result = pendingBills.map((b) => {
      const patient = patientMap.get(b.patientId!);
      const order = orderMap.get(b.orderId);
      const doctor = order?.doctorId ? doctorMap.get(order.doctorId) : null;
      return {
        billId: b.billId,
        patientId: b.patientId,
        billNumber: b.billNumber,
        billDate: b.createdAt ? dateToISTString(b.createdAt) : "",
        patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : "",
        mobile: patient?.phone ?? "",
        address: patient?.address ?? "",
        age: patient?.dateOfBirth
          ? String(new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear())
          : "",
        referredBy: doctor ? "Doctor" : "Self",
        referredByName: doctor?.name ?? "",
        formFTests: orderFormFTestsMap.get(b.orderId) ?? [],
      };
    });

    res.json(result);
  } catch (err) {
    console.error("[form-f] pending error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

formFRouter.get("/pending-tests", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const [settings] = await db.select().from(clinicSettingsTable).limit(1);
    const formFTestIds: number[] = JSON.parse(settings?.formFTestIds ?? "[]");

    if (formFTestIds.length === 0) {
      res.json([]);
      return;
    }

    const tests = await db
      .select({
        id: testsTable.id,
        name: testsTable.name,
        code: testsTable.code,
        category: testsTable.category,
      })
      .from(testsTable)
      .where(inArray(testsTable.id, formFTestIds))
      .orderBy(testsTable.name);

    const result = q
      ? tests.filter((t) =>
          `${t.name ?? ""} ${t.code ?? ""} ${t.category ?? ""}`.toLowerCase().includes(q.toLowerCase())
        )
      : tests;

    res.json(result);
  } catch (err) {
    console.error("[form-f] pending-tests error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

formFRouter.get("/list", async (req, res) => {
  try {
    const { search, searchBy } = req.query as { search?: string; searchBy?: string };
    const q = search?.trim();

    let rows;
    if (q) {
      const pattern = `%${q}%`;
      const field =
        searchBy === "husbandFatherName" ? formFRecordsTable.husbandFatherName
        : searchBy === "mobile"          ? formFRecordsTable.mobile
        : searchBy === "referredBy"      ? formFRecordsTable.referredBy
        : formFRecordsTable.patientName;

      rows = await db
        .select()
        .from(formFRecordsTable)
        .where(ilike(field, pattern))
        .orderBy(formFRecordsTable.createdAt);
    } else {
      rows = await db
        .select()
        .from(formFRecordsTable)
        .orderBy(formFRecordsTable.createdAt);
    }

    res.json(rows);
  } catch (err) {
    console.error("[form-f] list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Monthly PCPNDT register (Appropriate Authority submission/inspection) ───
//
// Management-authorized (requireAdminRole on top of the /form-f mount gate):
// the register is the statutory month-wise listing of EVERY Form F record —
// incomplete records are included and graded, never silently omitted, using
// the same completeness engine as the finalize gates (lib/pcpndtCompliance).
// Ordering is deterministic (created_at ASC, id ASC) and the serial is the
// record's position in that order within the IST month (the schema captures
// no statutory serial field; see docs/PCPNDT_MONTHLY_REGISTER.md).
//
// NOTE: these routes are registered BEFORE GET /:id — Express matches in
// order, and /:id would otherwise swallow /register.

/** Form-F-designated billed test names per billId for the register's linkage
 *  column. Covers Form-F tests of ANY modality/procedure — the designation is
 *  the admin-configured clinic_settings.formFTestIds list, the SAME
 *  definition the /pending queue uses — while other (non-Form-F) tests on the
 *  bill are deliberately excluded from the statutory register. Four batched
 *  queries total regardless of month size — no N+1. */
async function resolveFormFTestsByBillId(billIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  const uniqueBillIds = [...new Set(billIds)];
  if (uniqueBillIds.length === 0) return map;

  const [settings] = await db.select().from(clinicSettingsTable).limit(1);
  const formFTestIds: number[] = JSON.parse(settings?.formFTestIds ?? "[]");
  if (formFTestIds.length === 0) return map;

  const bills = await db
    .select({ id: billsTable.id, orderId: billsTable.orderId })
    .from(billsTable)
    .where(inArray(billsTable.id, uniqueBillIds));
  const orderIds = [...new Set(bills.map((b) => b.orderId).filter((v): v is number => v != null))];
  if (orderIds.length === 0) return map;

  const orderTests = await db
    .select({ orderId: orderTestsTable.orderId, testId: orderTestsTable.testId, testName: testsTable.name })
    .from(orderTestsTable)
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(inArray(orderTestsTable.orderId, orderIds));
  const testsByOrder = new Map<number, string[]>();
  for (const ot of orderTests) {
    if (!ot.testName || !ot.testId || !formFTestIds.includes(ot.testId)) continue;
    if (!testsByOrder.has(ot.orderId)) testsByOrder.set(ot.orderId, []);
    testsByOrder.get(ot.orderId)!.push(ot.testName);
  }
  for (const b of bills) {
    if (b.orderId != null) map.set(b.id, testsByOrder.get(b.orderId) ?? []);
  }
  return map;
}

// The two statutory registers PARTITION the month's Form F records by
// referral: a record with a named referring doctor belongs in the Rule 9(1)
// register; a self-referral/walk-in record belongs in the Self-Referral OPD
// register instead (where the clinic's own obstetrical checkup is the lawful
// referral). Each register's serials are continuous within itself.
async function fetchMonthFormFRecords(year: number, month: number) {
  const { start, end } = istMonthWindowUtc(year, month);
  return db
    .select()
    .from(formFRecordsTable)
    .where(and(gte(formFRecordsTable.createdAt, start), lt(formFRecordsTable.createdAt, end)))
    .orderBy(asc(formFRecordsTable.createdAt), asc(formFRecordsTable.id));
}

formFRouter.get("/register", requireAdminRole, async (req, res) => {
  try {
    const parsed = parseRegisterQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({ error: `Invalid register query: ${parsed.error}` });
      return;
    }
    const { month, year, page, pageSize } = parsed.value;

    // Doctor-referred records only — self/walk-in entries live in the
    // Self-Referral OPD register (see partition note above). Filtering and
    // pagination happen in-process on the month's rows (statutory monthly
    // volumes) so serials stay continuous within THIS register.
    const doctorReferred = (await fetchMonthFormFRecords(year, month)).filter((r) => !isSelfReferralRecord(r));
    const offset = (page - 1) * pageSize;
    const pageRecords = doctorReferred.slice(offset, offset + pageSize);

    const testsByBillId = await resolveFormFTestsByBillId(pageRecords.map((r) => r.billId).filter((v): v is number => v != null));
    const rows = buildRegisterRows(pageRecords, offset + 1, testsByBillId);
    res.json({
      month,
      year,
      rows,
      incompleteCount: rows.filter((r) => r.completionStatus === "incomplete").length,
      pagination: {
        page,
        pageSize,
        total: doctorReferred.length,
        totalPages: Math.max(1, Math.ceil(doctorReferred.length / pageSize)),
      },
    });
  } catch (err) {
    console.error("[form-f] register error:", err);
    res.status(500).json({ error: "Failed to load Form F register" });
  }
});

formFRouter.get("/register/export", requireAdminRole, async (req, res) => {
  try {
    const parsed = parseRegisterQuery({ ...req.query, page: "1", pageSize: "500" });
    if (!parsed.ok) {
      res.status(400).json({ error: `Invalid register query: ${parsed.error}` });
      return;
    }
    const { month, year } = parsed.value;

    // Full month, no pagination — a statutory export must be complete.
    // Same partition as GET /register: doctor-referred records only.
    const records = (await fetchMonthFormFRecords(year, month)).filter((r) => !isSelfReferralRecord(r));

    const testsByBillId = await resolveFormFTestsByBillId(records.map((r) => r.billId).filter((v): v is number => v != null));
    const rows = buildRegisterRows(records, 1, testsByBillId);
    const csv = registerRowsToCsv(rows);

    // Statutory-data export is always audited (tamper-evident chain).
    const session = (req as StaffAuthRequest).staffSession;
    await auditFromRequest(req, {
      userId: session?.subjectId ?? null,
      userName: session?.subjectName ?? "system",
      role: session?.role ?? "system",
      action: "export",
      module: "reports",
      entityType: "form_f_register",
      entityId: `${year}-${String(month).padStart(2, "0")}`,
      newValue: JSON.stringify({ records: rows.length, incomplete: rows.filter((r) => r.completionStatus === "incomplete").length }),
      reason: "PCPNDT monthly Form F register export",
    });

    const filename = `form-f-register-${year}-${String(month).padStart(2, "0")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("[form-f] register export error:", err);
    res.status(500).json({ error: "Failed to export Form F register" });
  }
});

// ─── Self-referral OPD register (Form 25 replica) ────────────────────────────
// The separate obstetrical-checkup record required before a self-referred
// pregnant woman may be scanned: the month's self-referral/walk-in Form F
// patients only, examined by the clinic's sonologist as a complimentary OPD
// checkup. Same management gate and IST month window as /register; the whole
// month is fetched and filtered in-process (statutory monthly volumes),
// keeping serials continuous among self-referrals.
/** Criterion 2 of the OPD register: the linked bill carries a Form-F-
 *  designated test. No bill linkage, or no designation configured (resolver
 *  returns an empty map ⇒ `get` is undefined), counts as evidenced — the
 *  Form F record itself is the evidence. */
function hasFormFTestEvidence(billId: number | null, testsByBillId: Map<number, string[]>): boolean {
  if (billId == null) return true;
  const designated = testsByBillId.get(billId);
  return designated === undefined || designated.length > 0;
}

formFRouter.get("/register/self-referral-opd", requireAdminRole, async (req, res) => {
  try {
    const parsed = parseRegisterQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({ error: `Invalid register query: ${parsed.error}` });
      return;
    }
    const { month, year, page, pageSize } = parsed.value;

    // BOTH criteria must hold (partition counterpart of /register):
    //  1. the referral is self/walk-in (no named referring doctor), AND
    //  2. the patient is a Form F TEST patient — the linked bill carries a
    //     Form-F-designated test (clinic_settings.formFTestIds). A record
    //     with no bill linkage (e.g. WhatsApp intake) or with no designation
    //     configured counts: the Form F record itself evidences the test.
    const monthRecords = await fetchMonthFormFRecords(year, month);
    const selfCandidates = monthRecords.filter(isSelfReferralRecord);
    const candidateTests = await resolveFormFTestsByBillId(
      selfCandidates.map((r) => r.billId).filter((v): v is number => v != null),
    );
    const selfReferrals = selfCandidates.filter((r) => hasFormFTestEvidence(r.billId, candidateTests));
    // Auto-save the digitally signed advice prescriptions for every
    // qualifying patient of the month (idempotent — signs only missing ones).
    await ensureSelfReferralPrescriptions(selfReferrals);
    const prescriptions = selfReferrals.length
      ? await db
          .select({
            id: selfReferralPrescriptionsTable.id,
            formFRecordId: selfReferralPrescriptionsTable.formFRecordId,
            signedAt: selfReferralPrescriptionsTable.signedAt,
          })
          .from(selfReferralPrescriptionsTable)
          .where(inArray(selfReferralPrescriptionsTable.formFRecordId, selfReferrals.map((r) => r.id)))
      : [];
    const prescriptionByRecord = new Map(prescriptions.map((p) => [p.formFRecordId, p]));

    const offset = (page - 1) * pageSize;
    const rows = buildOpdRegisterRows(selfReferrals.slice(offset, offset + pageSize), offset + 1).map((row) => ({
      ...row,
      prescriptionId: prescriptionByRecord.get(row.recordId)?.id ?? null,
      prescriptionSignedAt: prescriptionByRecord.get(row.recordId)?.signedAt ?? null,
    }));

    res.json({
      month,
      year,
      doctor: SELF_REFERRAL_OPD_DOCTOR,
      natureOfService: SELF_REFERRAL_OPD_SERVICE,
      fees: SELF_REFERRAL_OPD_FEES,
      rows,
      pagination: {
        page,
        pageSize,
        total: selfReferrals.length,
        totalPages: Math.max(1, Math.ceil(selfReferrals.length / pageSize)),
      },
    });
  } catch (err) {
    console.error("[form-f] self-referral OPD register error:", err);
    res.status(500).json({ error: "Failed to load the self-referral OPD register" });
  }
});

// The saved, digitally signed prescription for one self-referral patient —
// used by the OPD register's per-row prescription print. Registered before
// GET /:id (route order matters on this router).
formFRouter.get("/register/self-referral-opd/prescription/:recordId", requireAdminRole, async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    if (!Number.isInteger(recordId) || recordId <= 0) {
      res.status(400).json({ error: "Invalid record id" });
      return;
    }
    const [prescription] = await db
      .select()
      .from(selfReferralPrescriptionsTable)
      .where(eq(selfReferralPrescriptionsTable.formFRecordId, recordId))
      .limit(1);
    if (!prescription) {
      res.status(404).json({ error: "No prescription exists for this record" });
      return;
    }
    res.json({ prescription });
  } catch (err) {
    console.error("[form-f] prescription fetch error:", err);
    res.status(500).json({ error: "Failed to load the prescription" });
  }
});

// ─── Update patient address + guardian via bill number (from billing desk popup)
formFRouter.patch("/update-patient-data", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const body = req.body ?? {};
    const billNumber = String(body.billNumber ?? "").trim();
    const address = String(body.address ?? "").trim();
    const husbandFatherName = String(body.husbandFatherName ?? "").trim();

    if (!billNumber) {
      res.status(400).json({ error: "billNumber is required" });
      return;
    }

    const [bill] = await db
      .select()
      .from(billsTable)
      .where(eq(billsTable.billNumber, billNumber))
      .limit(1);

    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    if (bill.patientId) {
      const updates: Record<string, unknown> = {};
      if (address) updates.address = address;
      if (husbandFatherName) {
        // Also update the first Form-F record for this patient if any
        await db.update(formFRecordsTable)
          .set({ husbandFatherName })
          .where(eq(formFRecordsTable.patientId, bill.patientId));
      }
      if (Object.keys(updates).length > 0) {
        await db.update(patientsTable)
          .set(updates)
          .where(eq(patientsTable.id, bill.patientId));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[form-f] update-patient-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

type OcrLogEntry = {
  stage: string;
  status: "ok" | "warn" | "error" | "info";
  message: string;
  detail?: string;
};

// Human-readable detail for the admin-facing ocrLog (item 11's short
// frontend messages are derived separately, client-side, from ocrOutcome —
// this string is the longer diagnostic version shown in the log/diagnostics
// panel, not the toast).
function describeOcrUnavailable(reason: OcrUnavailableReason, resolution: Awaited<ReturnType<typeof resolveOcrProvider>>): string {
  switch (reason) {
    case "ollama_unreachable":
      return `Ollama is configured (${resolution.ollama.model ?? "no model set"}) but not reachable right now${resolution.ollama.reachabilityError ? `: ${resolution.ollama.reachabilityError}` : ""}, and no Gemini fallback is configured.`;
    case "ollama_model_not_vision_capable":
      return `The configured Ollama model ("${resolution.ollama.model}") does not appear to support image input. Select a vision-capable model (e.g. llava, gemma3, qwen2.5-vl) in AI Provider Settings, and no Gemini fallback is configured.`;
    case "ollama_model_not_configured":
      return "Ollama is enabled but no model is configured in AI Provider Settings, and no Gemini fallback is configured.";
    case "no_provider_configured":
    default:
      return "OCR is not configured: no Ollama endpoint or Gemini API key found in AI Provider Settings. Configure a provider in Settings → AI Reporting, or use manual entry.";
  }
}

// ─── OCR status endpoint (admin diagnostics — see FormF.tsx's diagnostics panel) ──
// Reports which provider ID-card OCR will actually use right now and why,
// without ever returning secrets: the Ollama endpoint is masked, and no API
// key is ever included (only a boolean "configured").
formFRouter.get("/ocr-status", requireStaffPermission("/form-f"), async (_req, res) => {
  try {
    const resolution = await resolveOcrProvider();
    res.json({
      ok: true,
      selectedProvider: resolution.chosen.provider,
      explicitRoute: resolution.explicitRoute,
      ollama: {
        configured: resolution.ollama.configured,
        enabled: resolution.ollama.enabled,
        endpointUrl: maskEndpointUrl(resolution.ollama.endpointUrl),
        model: resolution.ollama.model,
        visionSupport: resolution.ollama.visionClassification,
        reachable: resolution.ollama.reachable,
        reachabilityError: resolution.ollama.reachabilityError,
      },
      gemini: {
        configured: resolution.gemini.configured,
      },
      unavailableReason: resolution.chosen.provider === "none" ? resolution.chosen.reason : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Status check failed";
    res.status(500).json({ ok: false, error: msg });
  }
});

// ─── Upload ID card image + run AI OCR (with detailed error logging) ─────
formFRouter.post("/upload-id", requireStaffPermission("/form-f"), async (req, res) => {
  const ocrLog: OcrLogEntry[] = [];
  try {
    const body = req.body ?? {};
    const formFId = Number(body.formFId ?? 0);
    const imageBase64 = String(body.imageBase64 ?? "").trim();
    const mimeType = String(body.mimeType ?? "image/jpeg").trim();
    const imageUrl = String(body.imageUrl ?? "").trim();
    const useGeminiFallback = Boolean(body.useGeminiFallback);

    if (!imageBase64 && !imageUrl) {
      ocrLog.push({ stage: "validate", status: "error", message: "No image data provided", detail: "Send imageBase64 or imageUrl" });
      res.status(400).json({ ok: false, error: "imageBase64 or imageUrl required", ocrLog });
      return;
    }

    let base64 = imageBase64;
    // If imageUrl is provided instead, download it
    if (!base64 && imageUrl) {
      ocrLog.push({ stage: "download", status: "info", message: "Downloading image from URL...", detail: imageUrl });
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        base64 = buf.toString("base64");
        ocrLog.push({ stage: "download", status: "ok", message: "Image downloaded", detail: `${buf.length} bytes` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Download error";
        ocrLog.push({ stage: "download", status: "error", message: "Download failed", detail: msg });
        req.log?.warn?.({ err: e }, "Failed to download ID card image from URL");
        res.status(502).json({ ok: false, error: "Failed to download image", ocrLog });
        return;
      }
    }

    if (base64) {
      ocrLog.push({ stage: "validate", status: "ok", message: "Image data received", detail: `${base64.length} chars, ${mimeType}` });
    }

    // Chain: Ollama (primary) → client Tesseract → Gemini (only if useGeminiFallback).
    let ocrResult: IdCardOcrResult | null = null;
    let ocrError: string | null = null;
    let ocrOutcome: "success" | OcrUnavailableReason = "no_provider_configured";
    let blurScore: number | null = null;
    let isBlurred = false;
    let usedProviderLabel: "ollama" | "gemini" | "none" = "none";
    ocrLog.push({ stage: "provider", status: "info", message: "Resolving OCR provider...", detail: useGeminiFallback ? "Gemini third-pass requested" : "Ollama-first (Tesseract then Gemini)" });
    const resolution = await resolveOcrProvider();
    let provider: OcrProviderChoice = resolution.chosen;
    if (useGeminiFallback) {
      const geminiKey = await getGeminiOcrApiKey();
      provider = geminiKey
        ? { provider: "gemini", apiKey: geminiKey }
        : { provider: "none", reason: "no_provider_configured" };
    } else if (provider.provider === "gemini") {
      // Auto / first pass never spends a Gemini key — Tesseract is next.
      provider = { provider: "none", reason: "no_provider_configured" };
    }

    if (provider.provider === "none") {
      ocrOutcome = provider.reason;
      ocrError = describeOcrUnavailable(provider.reason, resolution);
      ocrLog.push({ stage: "provider", status: "error", message: "No usable OCR provider for this pass", detail: ocrError });
    } else {
      usedProviderLabel = provider.provider;
      ocrLog.push({
        stage: "provider", status: "ok",
        message: `Using ${provider.provider === "ollama" ? "Ollama" : "Gemini"} for OCR`,
        detail: provider.provider === "ollama" ? `model: ${provider.model}` : undefined,
      });
      try {
        const pipeline = await runIdCardOcrPipeline(base64, mimeType, provider);
        ocrResult = pipeline.ocrResult;
        blurScore = pipeline.blurScore;
        isBlurred = pipeline.isBlurred;
        ocrOutcome = "success";
        if (isBlurred) {
          ocrLog.push({ stage: "preprocess", status: "warn", message: "Image looks blurred", detail: `blurScore=${blurScore.toFixed(1)} (below ${SERVER_BLUR_WARNING_THRESHOLD}) — consider retaking the photo` });
        }
        ocrLog.push({ stage: provider.provider, status: "ok", message: `${provider.provider === "ollama" ? "Ollama" : "Gemini"} OCR completed`, detail: `documentType: ${ocrResult?.documentType}, confidence: ${ocrResult?.confidence}, name: ${ocrResult?.guardianName ? "found" : "empty"}, address: ${ocrResult?.address ? "found" : "empty"}, extras: ${ocrResult?.dob ? "dob " : ""}${ocrResult?.gender ? "gender " : ""}${ocrResult?.idNumber ? "idNumber" : ""}` });
      } catch (e) {
        ocrError = e instanceof Error ? e.message : `${provider.provider} OCR failed`;
        ocrLog.push({ stage: provider.provider, status: "error", message: `${provider.provider === "ollama" ? "Ollama" : "Gemini"} OCR failed`, detail: ocrError });
        ocrOutcome = provider.provider === "ollama" ? "ollama_unreachable" : "no_provider_configured";
      }
    }

    const responsePayload = {
      ok: true,
      ocr: ocrResult ?? null,
      ocrError,
      ocrOutcome,
      ocrLog,
      ocrStage: ocrResult ? `${usedProviderLabel}_success` : `${usedProviderLabel === "none" ? provider.provider : usedProviderLabel}_failed`,
      suggestedAction: ocrResult ? "accept_or_verify" : "manual_entry",
      blurScore,
      isBlurred,
      geminiFallbackAvailable: resolution.gemini.configured,
    };

    // If formFId is valid, update the record with extracted data and image reference
    if (formFId) {
      const [record] = await db.select().from(formFRecordsTable).where(eq(formFRecordsTable.id, formFId)).limit(1);
      if (record) {
        const updateData: Record<string, unknown> = { idCardVerified: false };
        if (imageUrl) updateData.idCardImageUrl = imageUrl;
        if (ocrResult?.guardianName) updateData.idCardExtractedName = ocrResult.guardianName;
        if (ocrResult?.address) updateData.idCardExtractedAddress = ocrResult.address;

        const [updated] = await db.update(formFRecordsTable)
          .set(updateData)
          .where(eq(formFRecordsTable.id, formFId))
          .returning();
        res.json({ ...responsePayload, formF: updated });
        return;
      }
    }

    // No record yet — just return OCR result with detailed log
    res.json(responsePayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    ocrLog.push({ stage: "server", status: "error", message: "Server error", detail: msg });
    console.error("[form-f] upload-id error:", err);
    res.status(500).json({ ok: false, error: "Internal server error", ocrLog, suggestedAction: "check_server_logs" });
  }
});

// ─── Verify / accept AI-extracted ID data ──────────────────────────────────
formFRouter.patch("/verify-id-data/:id", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body ?? {};

    const [record] = await db.select().from(formFRecordsTable).where(eq(formFRecordsTable.id, id)).limit(1);
    if (!record) {
      res.status(404).json({ error: "Form F record not found" });
      return;
    }

    const updates: Record<string, unknown> = { idCardVerified: true };

    // If staff accepts extracted name, copy it into the husbandFatherName field
    if (body.acceptGuardianName === true && record.idCardExtractedName) {
      updates.husbandFatherName = record.idCardExtractedName;
    }
    // If staff accepts extracted address, copy it into the address field
    if (body.acceptAddress === true && record.idCardExtractedAddress) {
      updates.address = record.idCardExtractedAddress;
    }
    // Manual overrides
    if (typeof body.guardianName === "string") updates.husbandFatherName = body.guardianName.trim();
    if (typeof body.address === "string") updates.address = body.address.trim();

    const [updated] = await db.update(formFRecordsTable).set(updates).where(eq(formFRecordsTable.id, id)).returning();
    res.json({ ok: true, formF: updated });
  } catch (err) {
    console.error("[form-f] verify-id-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get single Form F record with all fields (including ID card) ──────────
formFRouter.get("/:id", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [record] = await db.select().from(formFRecordsTable).where(eq(formFRecordsTable.id, id)).limit(1);
    if (!record) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(record);
  } catch (err) {
    console.error("[form-f] get error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Send WhatsApp message to patient requesting ID card upload ────────────
formFRouter.post("/send-whatsapp", requireStaffPermission("/form-f"), async (req, res): Promise<void> => {
  try {
    const body = req.body ?? {};
    const mobile = String(body.mobile ?? "").trim();
    const patientName = String(body.patientName ?? "").trim();

    if (!mobile) {
      res.status(400).json({ error: "Mobile number required" });
      return;
    }

    // Get WhatsApp settings for default country code
    const [s] = await db.select().from(whatsappSettingsTable).limit(1);
    const to = normalizePhone(mobile, s?.defaultCountryCode ?? "91");
    if (!to) {
      res.status(400).json({ error: "Invalid mobile number" });
      return;
    }

    // Try Form F number first, then fall back to any default
    let cfg = await resolveNumber("form_f");
    if (!cfg) cfg = await resolveNumber("general");
    if (!cfg) {
      res.status(400).json({ error: "WhatsApp not configured" });
      return;
    }

    const greeting = patientName ? `Hi ${patientName},` : "Hi,";
    const message = `${greeting} this is Care Diagnostics.

For your PCPNDT Form F record, we need a clear photo of your ID card (Aadhaar / Voter ID / Passport) showing:
- Guardian/Husband/Father's name
- Full address

Please reply to this message with a photo of your ID card. Our system will read it automatically and fill your Form F record.

Thank you!`;

    const result = await sendTextMessageRaw(to, message, cfg);
    if (!result.ok) {
      res.status(500).json({ error: result.error ?? "Send failed" });
      return;
    }

    res.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error("[form-f] send-whatsapp error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────────────
// Deprecated: this endpoint used to fetch(SCAN_BRIDGE_URL) from the SERVER,
// which is architecturally broken — 127.0.0.1 from the API server's own
// process is the API container's loopback, never the reception workstation's
// loopback where the Scanner Bridge actually runs. It could only ever have
// worked if the API server and the bridge happened to run on the same
// machine, which is not this deployment's topology (Synology/Docker server,
// Windows reception workstation). This was the root cause of "Capture ID /
// Direct Scan: fetch failed" and "Import Latest Scan: fetch failed".
//
// The frontend now fetches the bridge directly from the browser (see
// artifacts/diagnostic-erp/src/lib/scanBridgeClient.ts) and posts the raw
// bytes to POST /optimize-scan below for the same dedup + resize step this
// endpoint used to do inline. Kept as a 410 stub (not deleted) for one
// release so any not-yet-updated client gets a clear error instead of a
// silent hang against a route that can never succeed.
// ────────────────────────────────────────────────────────────────────
formFRouter.post("/latest-scan-proxy", requireStaffPermission("/form-f"), async (_req, res) => {
  res.status(410).json({
    ok: false,
    error: "This endpoint has been retired: the API server can never reach a workstation-local scanner bridge over its own loopback address. The ERP frontend now calls the bridge directly from the browser and sends the captured image to POST /api/form-f/optimize-scan instead. Update your client.",
  });
});

// ────────────────────────────────────────────────────────────────────
// Optimize + dedupe an already-captured scan image. The browser fetches the
// image bytes directly from the local Scanner Bridge (127.0.0.1:8766) and
// posts them here — this endpoint never talks to the bridge itself, only to
// bytes it's handed, so it works regardless of where the API server happens
// to be deployed relative to the reception workstation.
// ────────────────────────────────────────────────────────────────────
formFRouter.post("/optimize-scan", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const body = req.body ?? {};
    const imageBase64 = String(body.imageBase64 ?? "");
    const mimeType = String(body.mimeType ?? "image/jpeg");
    const filename = String(body.filename ?? "scan");
    if (!imageBase64) {
      res.status(400).json({ ok: false, error: "imageBase64 is required" });
      return;
    }
    const useSharp = typeof req.app?.get === "function" ? req.app.get("useSharp") !== false : true;

    // Duplicate protection — reject the identical image content within the
    // last 5 minutes (keyed by filename, since no bridge-provided mtime is
    // available for a bytes-in request; a content hash would be stronger but
    // this preserves the existing behavior's intent without adding a new
    // dependency).
    const now = Date.now();
    const cacheKey = `${filename}:${imageBase64.length}`;
    const lastSeen = importedScanCache.get(cacheKey);
    if (lastSeen && now - lastSeen < 5 * 60 * 1000) {
      res.status(409).json({
        ok: false,
        error: "This scan was already imported recently. Wait a few minutes or scan a new document.",
        duplicate: true,
        cacheKey,
      });
      return;
    }
    importedScanCache.set(cacheKey, now);
    // Clean old cache entries (older than 10 min)
    for (const [k, t] of importedScanCache) {
      if (now - t > 10 * 60 * 1000) importedScanCache.delete(k);
    }

    // Image optimization using Sharp if available
    let optimizedBase64 = imageBase64;
    let optimizedMime = mimeType;
    const maxWidth = Number(body.maxWidth ?? 1200);
    const jpegQuality = Number(body.jpegQuality ?? 85);
    if (useSharp && !mimeType.includes("pdf")) {
      try {
        const sharp = await import("sharp");
        const inputBuf = Buffer.from(imageBase64, "base64");
        let pipeline = sharp.default(inputBuf).rotate();
        if (maxWidth > 0) {
          pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
        }
        const outBuf = await pipeline.jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer();
        optimizedBase64 = outBuf.toString("base64");
        optimizedMime = "image/jpeg";
      } catch {
        // Sharp not available or failed — return raw
      }
    }

    res.json({
      ok: true,
      imageBase64: optimizedBase64,
      mimeType: optimizedMime,
      filename,
      cacheKey,
      optimized: optimizedBase64 !== imageBase64,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    req.log?.warn?.({ err }, "optimize-scan error");
    res.status(500).json({ ok: false, error: msg });
  }
});

formFRouter.get("/export-for-portal/:billNumber", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const billNumber = String(req.params.billNumber ?? "").trim();
    if (!billNumber) { res.status(400).json({ error: "billNumber required" }); return; }

    // Find the latest saved Form-F record for this bill
    const [record] = await db
      .select()
      .from(formFRecordsTable)
      .where(ilike(formFRecordsTable.billNumber, `%${billNumber}%`))
      .orderBy(desc(formFRecordsTable.createdAt))
      .limit(1);

    if (!record) {
      res.status(404).json({ error: "No Form F record found for this bill" });
      return;
    }

    let ultrasoundResult = record.ultrasoundResult;

    // Fetch clinic settings to check if biometry export is enabled
    const [settings] = await db.select().from(clinicSettingsTable).limit(1);
    let includeBiometry = false;
    if (settings) {
      try {
        const parsed = JSON.parse(settings.serviceImages ?? "{}");
        includeBiometry = !!parsed.formFIncludeBiometry;
      } catch { /* ignore */ }
    }

    if (includeBiometry && record.patientId) {
      // Find the latest approved obstetric/USG measurement for this patient
      const [usgMeas] = await db
        .select()
        .from(usgMeasurementsTable)
        .where(
          and(
            eq(usgMeasurementsTable.patientId, record.patientId),
            eq(usgMeasurementsTable.status, "approved")
          )
        )
        .orderBy(desc(usgMeasurementsTable.createdAt))
        .limit(1);

      if (usgMeas) {
        const parts = [];
        if (usgMeas.bpd) parts.push(`BPD: ${usgMeas.bpd}`);
        if (usgMeas.fl) parts.push(`FL: ${usgMeas.fl}`);
        if (usgMeas.ac) parts.push(`AC: ${usgMeas.ac}`);
        if (usgMeas.hc) parts.push(`HC: ${usgMeas.hc}`);
        if (usgMeas.crl) parts.push(`CRL: ${usgMeas.crl}`);
        if (parts.length > 0) {
          const biometryStr = ` (${parts.join(", ")})`;
          ultrasoundResult = `${record.ultrasoundResult}${biometryStr}`;
        }
      }
    }

    res.json({
      centreName: record.centreName,
      registrationNo: record.registrationNo,
      patientName: record.patientName,
      age: record.age,
      childrenDetails: record.childrenDetails,
      husbandFatherName: record.husbandFatherName,
      address: record.address,
      mobile: record.mobile,
      referredBy: record.referredBy,
      lmpWeeks: record.lmpWeeks,
      geneticHistory: record.geneticHistory,
      basisDiagnosis: record.basisDiagnosis,
      previousChildIssue: record.previousChildIssue,
      indicationOther: record.indicationOther,
      doctorName: record.doctorName,
      procedure: record.procedure,
      procedurePurpose: record.procedurePurpose,
      invasiveProcedure: record.invasiveProcedure,
      complication: record.complication,
      labTests: record.labTests,
      gestationalAgeWeeks: record.gestationalAgeWeeks,
      gestationalAgeDays: record.gestationalAgeDays,
      ultrasoundResult,
      abnormality: record.abnormality,
      procedureDate: record.procedureDate,
      consentDate: record.consentDate,
      resultConveyed: record.resultConveyed,
      mtpAdvised: record.mtpAdvised,
      mtpDate: record.mtpDate,
      date: record.date,
      place: record.place,
      billNumber: record.billNumber,
    });
  } catch (err) {
    console.error("[form-f] export-for-portal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default formFRouter;
