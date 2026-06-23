import { Router } from "express";
import { db, billsTable, patientsTable, formFRecordsTable, clinicSettingsTable } from "@workspace/db";
import { eq, or, ilike, inArray, isNotNull, desc, and, gte, lt } from "drizzle-orm";
import { ordersTable, orderTestsTable, testsTable, doctorsTable } from "@workspace/db";
import { whatsappConversationsTable, whatsappSettingsTable } from "@workspace/db/schema";
import { dateToISTString } from "../lib/istDate";
import { geminiOcrIdCard, type IdCardOcrResult } from "@workspace/integrations-gemini-ai";
import { requireStaffPermission } from "../middleware/requireStaffAuth";
import { sendTextMessageRaw, resolveNumber, normalizePhone } from "./whatsapp";

const formFRouter = Router();

// ── Duplicate protection cache for latest-scan imports ──
const importedScanCache = new Map<string, number>(); // key -> timestamp
const SCAN_BRIDGE_URL = "http://127.0.0.1:8766";

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
      ultrasoundResult: "Normal",
    });
  } catch (err) {
    console.error("[form-f] fetch-billing error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

formFRouter.post("/save", async (req, res) => {
  try {
    const body = req.body ?? {};

    let billId: number | undefined;
    let patientId: number | undefined;

    if (body.billNumber) {
      const [bill] = await db
        .select()
        .from(billsTable)
        .where(ilike(billsTable.billNumber, body.billNumber))
        .limit(1);
      if (bill) {
        billId = bill.id;
        patientId = bill.patientId;
      }
    }

    const record: typeof formFRecordsTable.$inferInsert = {
      billId: billId ?? null,
      patientId: patientId ?? null,
      billNumber: body.billNumber ?? null,
      centreName: body.centreName ?? "",
      registrationNo: body.registrationNo ?? "",
      patientName: body.patientName ?? "",
      age: body.age ?? "",
      childrenDetails: body.childrenDetails ?? "",
      husbandFatherName: body.husbandFatherName ?? "",
      address: body.address ?? "",
      mobile: body.mobile ?? "",
      referredBy: body.referredBy ?? "Self",
      lmpWeeks: body.lmpWeeks ?? "",
      geneticHistory: body.geneticHistory ?? "",
      basisDiagnosis: body.basisDiagnosis ?? "",
      previousChildIssue: body.previousChildIssue ?? "",
      indicationOther: body.indicationOther ?? "",
      doctorName: body.doctorName ?? "",
      procedure: body.procedure ?? "",
      procedurePurpose: body.procedurePurpose ?? "",
      invasiveProcedure: body.invasiveProcedure ?? "",
      complication: body.complication ?? "",
      labTests: body.labTests ?? "",
      prenatalResult: body.prenatalResult ?? "",
      gestationalAgeWeeks: body.gestationalAgeWeeks ?? "",
      gestationalAgeDays: body.gestationalAgeDays ?? "",
      ultrasoundResult: body.ultrasoundResult ?? "",
      abnormality: body.abnormality ?? "",
      procedureDate: body.procedureDate ?? "",
      consentDate: body.consentDate ?? "",
      resultConveyed: body.resultConveyed ?? "",
      mtpAdvised: body.mtpAdvised ?? "",
      mtpDate: body.mtpDate ?? "",
      date: body.date ?? "",
      place: body.place ?? "",
      idCardImageUrl: body.idCardFrontUrl ?? body.idCardImageUrl ?? null,
      idCardFrontUrl: body.idCardFrontUrl ?? null,
      idCardBackUrl: body.idCardBackUrl ?? null,
      idCardExtractedName: body.idCardExtractedName ?? null,
      idCardExtractedAddress: body.idCardExtractedAddress ?? null,
      idCardVerified: body.idCardVerified ?? false,
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

    // Run Gemini OCR
    let ocrResult: IdCardOcrResult | null = null;
    ocrLog.push({ stage: "gemini", status: "info", message: "Starting Gemini OCR...", detail: "Calling geminiOcrIdCard()" });
    try {
      ocrResult = await geminiOcrIdCard(base64, mimeType);
      ocrLog.push({ stage: "gemini", status: "ok", message: "Gemini OCR completed", detail: `documentType: ${ocrResult.documentType}, confidence: ${ocrResult.confidence}, guardianName: ${ocrResult.guardianName ? "found" : "empty"}, address: ${ocrResult.address ? "found" : "empty"}, extras: ${ocrResult.fullName ? "name" : ""}${ocrResult.dob ? " dob" : ""}${ocrResult.gender ? " gender" : ""}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gemini OCR failed";
      ocrLog.push({ stage: "gemini", status: "error", message: "Gemini OCR failed", detail: msg });
      // Still return a structured response so the frontend can use Tesseract fallback
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
// Export Form F data for PCPNDT portal bookmarklet (staff-authenticated)
// Returns all fields needed to pre-fill the government portal form.
// ────────────────────────────────────────────────────────────────────
formFRouter.post("/latest-scan-proxy", requireStaffPermission("/form-f"), async (req, res) => {
  try {
    const body = req.body ?? {};
    const bridgeUrl = String(body.bridgeUrl ?? SCAN_BRIDGE_URL).trim();
    const mode = String(body.mode ?? "watch").trim(); // "watch" or "direct"
    const useSharp = typeof req.app?.get === "function" ? req.app.get("useSharp") !== false : true;

    // 1) Fetch from bridge (either /latest-scan or /scan)
    const endpoint = mode === "direct" ? "scan" : "latest-scan";
    const r = await fetch(`${bridgeUrl}/${endpoint}`, { method: "POST", mode: "cors" });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok || !j.ok) {
      res.status(r.status === 404 ? 404 : 502).json({
        ok: false,
        error: String(j.error || "Bridge failed"),
        code: j.code ? String(j.code) : null,
        fallback: j.fallback ? String(j.fallback) : null,
      });
      return;
    }

    const imageBase64 = String(j.imageBase64 ?? "");
    const mimeType = String(j.mimeType ?? "image/jpeg");
    const filename = String(j.filename ?? "scan");
    const mtimeMs = Number(j.mtimeMs ?? 0);
    const cacheKey = `${filename}:${mtimeMs}`;

    // 2) Duplicate protection — reject same file/mtime within last 5 minutes
    const now = Date.now();
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

    // 3) Image optimization using Sharp if available
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
    req.log?.warn?.({ err }, "latest-scan-proxy error");
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
      ultrasoundResult: record.ultrasoundResult,
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
