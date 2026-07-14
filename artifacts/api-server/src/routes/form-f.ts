import { Router } from "express";
import { db, billsTable, patientsTable, formFRecordsTable, clinicSettingsTable } from "@workspace/db";
import { eq, or, ilike, inArray, isNotNull, desc, and, gte, lt } from "drizzle-orm";
import { ordersTable, orderTestsTable, testsTable, doctorsTable } from "@workspace/db";
import { whatsappConversationsTable, whatsappSettingsTable, usgMeasurementsTable, radiologyStudiesTable, fetalUsgStudiesTable, fetalUsgMeasurementsTable, fetalUsgReportsTable, fetalUsgChecklistsTable } from "@workspace/db/schema";
import { dateToISTString } from "../lib/istDate";
import { geminiOcrIdCard, type IdCardOcrResult } from "@workspace/integrations-gemini-ai";
import { getProviderApiKey } from "@workspace/ai-providers";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { sendTextMessageRaw, resolveNumber, normalizePhone } from "./whatsapp";

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

// ─── OCR status endpoint (diagnostics) ───────────────────────────────────
formFRouter.get("/ocr-status", async (_req, res) => {
  const logs: OcrLogEntry[] = [];
  try {
    logs.push({ stage: "config", status: "info", message: "Checking Gemini integration...", detail: `baseUrl: ${process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ? "set" : "missing"}, apiKey: ${process.env.AI_INTEGRATIONS_GEMINI_API_KEY ? "set" : "missing"}` });
    const configured = !!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (configured) {
      logs.push({ stage: "config", status: "ok", message: "Gemini API credentials configured" });
    } else {
      logs.push({ stage: "config", status: "error", message: "Gemini API credentials missing", detail: "Set AI_INTEGRATIONS_GEMINI_BASE_URL and AI_INTEGRATIONS_GEMINI_API_KEY environment variables" });
    }
    res.json({ ok: true, geminiConfigured: configured, logs });
  } catch (err) {
    logs.push({ stage: "status", status: "error", message: "Status check failed", detail: String(err) });
    res.status(500).json({ ok: false, geminiConfigured: false, logs });
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

    // Run Gemini OCR. Resolve the API key from the DB-backed AI Provider
    // Settings first (the primary configuration path — see AI Reporting
    // Settings in the ERP) and only fall back to the raw
    // AI_INTEGRATIONS_GEMINI_API_KEY env var when no key is configured there.
    // Without this, an admin who configures a key in Settings would still see
    // OCR silently fail if the env var was never also set — this was root
    // cause of "Upload ID succeeds but OCR is unavailable" reports.
    let ocrResult: IdCardOcrResult | null = null;
    let ocrError: string | null = null;
    ocrLog.push({ stage: "gemini", status: "info", message: "Starting Gemini OCR...", detail: "Calling geminiOcrIdCard()" });
    const dbApiKey = await getProviderApiKey("gemini").catch(() => null);
    if (!dbApiKey && !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      ocrError = "OCR is not configured: no Gemini API key found in AI Provider Settings or AI_INTEGRATIONS_GEMINI_API_KEY. Configure a key in Settings → AI Reporting, or use manual entry.";
      ocrLog.push({ stage: "gemini", status: "error", message: "No Gemini API key configured", detail: ocrError });
    } else {
      try {
        ocrResult = await geminiOcrIdCard(base64, mimeType, dbApiKey ? { apiKey: dbApiKey } : {});
        ocrLog.push({ stage: "gemini", status: "ok", message: "Gemini OCR completed", detail: `documentType: ${ocrResult.documentType}, confidence: ${ocrResult.confidence}, guardianName: ${ocrResult.guardianName ? "found" : "empty"}, address: ${ocrResult.address ? "found" : "empty"}, extras: ${ocrResult.fullName ? "name" : ""}${ocrResult.dob ? " dob" : ""}${ocrResult.gender ? " gender" : ""}` });
      } catch (e) {
        ocrError = e instanceof Error ? e.message : "Gemini OCR failed";
        ocrLog.push({ stage: "gemini", status: "error", message: "Gemini OCR failed", detail: ocrError });
        // Still return a structured response so the frontend can use Tesseract fallback
      }
    }

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
        res.json({
          ok: true,
          formF: updated,
          ocr: ocrResult ?? null,
          ocrError,
          ocrLog,
          ocrStage: ocrResult ? "gemini_success" : "gemini_failed",
          suggestedAction: ocrResult ? "accept_or_verify" : "try_tesseract_fallback",
        });
        return;
      }
    }

    // No record yet — just return OCR result with detailed log
    res.json({
      ok: true,
      ocr: ocrResult ?? null,
      ocrError,
      ocrLog,
      ocrStage: ocrResult ? "gemini_success" : "gemini_failed",
      suggestedAction: ocrResult ? "accept_or_verify" : "try_tesseract_fallback",
    });
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
