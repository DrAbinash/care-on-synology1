import { Router, type IRouter } from "express";
import {
  db, samplesTable, sampleTestAssignmentsTable, insertSampleSchema,
  ordersTable, patientsTable, orderTestsTable, testsTable,
  outsourcedLabsTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, inArray, desc, like, type SQL } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

// ─── Constants & helpers ────────────────────────────────────────────────────

// Lifecycle:  collected → received → in_processing → completed → reported
//             rejected (terminal)
//             pending = expected but not yet collected
export const SAMPLE_STATUSES = [
  "pending", "collected", "received", "in_processing", "completed", "reported", "rejected",
] as const;
type SampleStatus = typeof SAMPLE_STATUSES[number];

const SAMPLE_TYPES = [
  "Blood", "Serum", "Plasma", "Whole Blood", "Urine", "Stool", "Sputum",
  "Swab", "Tissue", "CSF", "Pus", "Body Fluid", "Semen", "Other",
];
const CONTAINER_TYPES = [
  "EDTA (Purple)", "SST (Yellow/Gold)", "Plain (Red)", "Sodium Fluoride (Grey)",
  "Citrate (Blue)", "Lithium Heparin (Green)", "Sterile Container", "Urine Cup",
  "Stool Container", "Swab Tube", "Other",
];
const COLLECTION_SITES = ["Center", "Home", "Camp", "External"];

// ─── Reusable validation schemas ────────────────────────────────────────────

const IdParams = z.object({ id: z.coerce.number().int().positive() });

// Strict calendar-aware YYYY-MM-DD validator. Rejects shape mismatches AND
// values that look right but aren't real dates (`2026-13-40`, `2026-02-31`).
const IsoDate = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}, { message: "Invalid date — expected YYYY-MM-DD calendar date" });

const ListQuery = z.object({
  status: z.string().optional(),
  dateFrom: IsoDate.optional(),
  dateTo: IsoDate.optional(),
  search: z.string().optional(),
  outsourcedOnly: z.union([z.literal("true"), z.literal("false")]).optional(),
});

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ("code" in cur && (cur as { code: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|violates unique constraint/i.test(msg);
}

// Barcode generator: SMP-YYMMDD-NNNN  (NNNN resets daily, zero-padded).
// Race-safe via UNIQUE(barcode) + retry-on-collision.
async function nextBarcode(): Promise<string> {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const prefix = `SMP-${yy}${mm}${dd}-`;

  // Find max existing daily counter.
  const rows = await db
    .select({ barcode: samplesTable.barcode })
    .from(samplesTable)
    .where(like(samplesTable.barcode, `${prefix}%`));
  let max = 0;
  for (const r of rows) {
    const m = /-(\d{4,})$/.exec(r.barcode);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// Build response with patient + tests joined in.
async function expandSample(s: typeof samplesTable.$inferSelect) {
  const [patient] = await db
    .select({
      id: patientsTable.id, patientId: patientsTable.patientId,
      firstName: patientsTable.firstName, lastName: patientsTable.lastName,
      phone: patientsTable.phone, gender: patientsTable.gender,
      dateOfBirth: patientsTable.dateOfBirth,
    })
    .from(patientsTable).where(eq(patientsTable.id, s.patientId));

  const [order] = await db
    .select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber })
    .from(ordersTable).where(eq(ordersTable.id, s.orderId));

  const tests = await db
    .select({
      orderTestId: orderTestsTable.id,
      testId: testsTable.id,
      testCode: testsTable.code,
      testName: testsTable.name,
      category: testsTable.category,
      resultStatus: orderTestsTable.resultStatus,
    })
    .from(sampleTestAssignmentsTable)
    .innerJoin(orderTestsTable, eq(orderTestsTable.id, sampleTestAssignmentsTable.orderTestId))
    .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(sampleTestAssignmentsTable.sampleId, s.id));

  return { ...s, patient: patient ?? null, order: order ?? null, tests };
}

// ─── Listing ────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid request", details: q.error.issues }); return; }
  const status = q.data.status ?? null;
  const dateFrom = q.data.dateFrom ?? null;
  const dateTo = q.data.dateTo ?? null;
  const search = (q.data.search ?? "").trim();
  const outsourcedOnly = q.data.outsourcedOnly === "true";

  const conds: SQL[] = [];
  if (status && status !== "all" && (SAMPLE_STATUSES as readonly string[]).includes(status)) {
    conds.push(eq(samplesTable.status, status));
  }
  if (dateFrom) conds.push(gte(samplesTable.collectedAt, new Date(`${dateFrom}T00:00:00`)));
  if (dateTo)   conds.push(lte(samplesTable.collectedAt, new Date(`${dateTo}T23:59:59.999`)));
  if (outsourcedOnly) conds.push(eq(samplesTable.isOutsourced, true));
  if (search) {
    conds.push(like(samplesTable.barcode, `%${search}%`));
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select().from(samplesTable).where(where).orderBy(desc(samplesTable.collectedAt)).limit(500);

  // Status counters across the SAME filters (minus status itself).
  const counterConds = conds.filter((c) => c !== conds.find((x) => x === conds[0] && status));
  const baseFilters: SQL[] = [];
  if (dateFrom) baseFilters.push(gte(samplesTable.collectedAt, new Date(`${dateFrom}T00:00:00`)));
  if (dateTo)   baseFilters.push(lte(samplesTable.collectedAt, new Date(`${dateTo}T23:59:59.999`)));
  if (outsourcedOnly) baseFilters.push(eq(samplesTable.isOutsourced, true));
  const counters: Record<string, number> = {};
  const grouped = await db
    .select({ status: samplesTable.status, count: sql<number>`count(*)::int` })
    .from(samplesTable)
    .where(baseFilters.length ? and(...baseFilters) : undefined)
    .groupBy(samplesTable.status);
  for (const g of grouped) counters[g.status] = g.count;
  for (const s of SAMPLE_STATUSES) if (!(s in counters)) counters[s] = 0;

  const expanded = await Promise.all(rows.map(expandSample));
  void counterConds;
  res.json({ samples: expanded, counters });
});

router.get("/scan/:barcode", async (req, res) => {
  const barcode = req.params.barcode.trim();
  if (!barcode) { res.status(400).json({ error: "Barcode is required" }); return; }

  const [row] = await db.select().from(samplesTable).where(eq(samplesTable.barcode, barcode));
  if (!row) { res.status(404).json({ error: "Sample not found" }); return; }

  res.json(await expandSample(row));
});

router.get("/options", (_req, res) => {
  res.json({
    sampleTypes: SAMPLE_TYPES,
    containerTypes: CONTAINER_TYPES,
    collectionSites: COLLECTION_SITES,
    statuses: SAMPLE_STATUSES,
  });
});

router.get("/:id", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const [row] = await db.select().from(samplesTable).where(eq(samplesTable.id, p.data.id));
  if (!row) { res.status(404).json({ error: "Sample not found" }); return; }
  res.json(await expandSample(row));
});

// ─── Create (collection entry) ──────────────────────────────────────────────

const createBody = insertSampleSchema.extend({
  orderId: z.number().int().positive(),
  patientId: z.number().int().positive(),
  sampleType: z.string().refine((v) => SAMPLE_TYPES.includes(v), { message: "Invalid sampleType" }),
  containerType: z.string().refine((v) => CONTAINER_TYPES.includes(v), { message: "Invalid containerType" }),
  collectionSite: z.string().refine((v) => COLLECTION_SITES.includes(v), { message: "Invalid collectionSite" }),
  status: z.enum(["pending", "collected"]).default("collected"),
  orderTestIds: z.array(z.number().int().positive()).default([]),
  collectedByName: z.string().default(""),
  volume: z.string().default(""),
  notes: z.string().default(""),
}).strip();

router.post("/", async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { orderTestIds, ...sample } = parsed.data;

  // Verify order exists & belongs to patient.
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, sample.orderId));
  if (!order) { res.status(400).json({ error: "Order not found" }); return; }
  if (order.patientId !== sample.patientId) {
    res.status(400).json({ error: "patientId does not match the order" });
    return;
  }

  // Verify orderTestIds belong to this order.
  if (orderTestIds.length > 0) {
    const valid = await db
      .select({ id: orderTestsTable.id })
      .from(orderTestsTable)
      .where(and(eq(orderTestsTable.orderId, sample.orderId), inArray(orderTestsTable.id, orderTestIds)));
    if (valid.length !== orderTestIds.length) {
      res.status(400).json({ error: "One or more orderTestIds do not belong to this order" });
      return;
    }
  }

  // Insert sample with retry-on-barcode-collision.
  let created: typeof samplesTable.$inferSelect | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const barcode = await nextBarcode();
    try {
      [created] = await db.insert(samplesTable).values({ ...sample, barcode }).returning();
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  if (!created) { res.status(500).json({ error: "Failed to allocate barcode" }); return; }

  // Insert test assignments.
  if (orderTestIds.length > 0) {
    await db.insert(sampleTestAssignmentsTable)
      .values(orderTestIds.map((otId) => ({ sampleId: created.id, orderTestId: otId })));
  }

  // Stamp the order as "collected" if it was still pending.
  if (order.status === "pending") {
    await db.update(ordersTable).set({ status: "collected", collectedAt: new Date() }).where(eq(ordersTable.id, order.id));
  }

  res.status(201).json(await expandSample(created));
});

// ─── Status transitions ─────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  pending:        ["collected", "rejected"],
  collected:      ["received", "rejected"],
  received:       ["in_processing", "rejected"],
  in_processing:  ["completed", "rejected"],
  completed:      ["reported", "rejected"],
  reported:       [],
  rejected:       [],
};

router.post("/:id/status", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const body = z.object({
    status: z.enum(SAMPLE_STATUSES),
    rejectionReason: z.string().optional(),
    actorName: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.issues }); return; }

  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }

  const current = sample.status as SampleStatus;
  const next = body.data.status;
  if (current === next) { res.status(400).json({ error: `Sample is already ${current}` }); return; }
  const allowed = VALID_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    res.status(400).json({
      error: `Cannot move sample from "${current}" to "${next}". Allowed transitions: ${allowed.join(", ") || "(none — terminal state)"}`,
    });
    return;
  }
  if (next === "rejected" && !body.data.rejectionReason?.trim()) {
    res.status(400).json({ error: "rejectionReason is required when rejecting a sample" });
    return;
  }

  const updates: Partial<typeof samplesTable.$inferInsert> = { status: next };
  const now = new Date();
  if (next === "received") updates.receivedAt = now;
  if (next === "in_processing") updates.processingStartedAt = now;
  if (next === "completed") updates.completedAt = now;
  if (next === "reported") updates.reportedAt = now;
  if (next === "rejected") {
    updates.rejectedAt = now;
    updates.rejectionReason = body.data.rejectionReason?.trim() ?? null;
  }

  const [updated] = await db.update(samplesTable).set(updates).where(eq(samplesTable.id, id)).returning();
  res.json(await expandSample(updated));
});

// ─── Outsourced handling ────────────────────────────────────────────────────

const outsourceBody = z.object({
  outsourceLab: z.string().min(1, "Lab name is required"),
  outsourceExpectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  outsourceTrackingId: z.string().optional(),
  outsourceCostOverride: z.number().min(0).optional(),
});

router.post("/:id/outsource", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const body = outsourceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.issues }); return; }

  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }
  if (sample.status === "rejected" || sample.status === "reported") {
    res.status(400).json({ error: `Cannot outsource a ${sample.status} sample` });
    return;
  }

  // Compute cost: look up tests in this sample, resolve lab rates, sum costs.
  const tests = await db
    .select({
      orderTestId: orderTestsTable.id,
      testId: testsTable.id,
      outsourceCost: testsTable.outsourceCost,
      outsourcedLabId: testsTable.outsourcedLabId,
      patientPrice: orderTestsTable.price,
    })
    .from(sampleTestAssignmentsTable)
    .innerJoin(orderTestsTable, eq(orderTestsTable.id, sampleTestAssignmentsTable.orderTestId))
    .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(sampleTestAssignmentsTable.sampleId, id));

  // Build a map of lab rates.
  const labIds = [...new Set(tests.map((t) => t.outsourcedLabId).filter((id): id is number => id != null))];
  const labs = labIds.length > 0
    ? await db.select().from(outsourcedLabsTable).where(inArray(outsourcedLabsTable.id, labIds))
    : [];
  const labMap = new Map(labs.map((l) => [l.id, l]));

  let totalCost = 0;
  let totalPatientBill = 0;
  for (const t of tests) {
    const pPrice = Number(t.patientPrice ?? 0);
    totalPatientBill += pPrice;
    // If test has explicit outsourceCost, use it.
    if (t.outsourceCost != null) {
      totalCost += Number(t.outsourceCost);
      continue;
    }
    // Otherwise fall back to lab default rate.
    if (t.outsourcedLabId) {
      const lab = labMap.get(t.outsourcedLabId);
      if (lab) {
        if (lab.costType === "fixed_per_test") {
          totalCost += Number(lab.costFixed ?? 0);
        } else {
          // percent_of_patient_bill (default)
          totalCost += pPrice * (Number(lab.costPercent ?? 50) / 100);
        }
      }
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;

  // Staff may override the computed cost.
  const effectiveCost = body.data.outsourceCostOverride != null && Number.isFinite(body.data.outsourceCostOverride)
    ? body.data.outsourceCostOverride
    : totalCost;
  const margin = Math.round((totalPatientBill - effectiveCost) * 100) / 100;

  const [updated] = await db.update(samplesTable).set({
    isOutsourced: true,
    outsourceLab: body.data.outsourceLab.trim(),
    outsourceExpectedAt: body.data.outsourceExpectedAt || null,
    outsourceTrackingId: body.data.outsourceTrackingId?.trim() || null,
    outsourceSentAt: new Date(),
    outsourceCostAmount: String(totalCost),
    outsourceCostOverride: (body.data.outsourceCostOverride != null && Number.isFinite(body.data.outsourceCostOverride)) ? String(effectiveCost) : null,
    outsourcePatientBill: String(totalPatientBill),
    outsourceMargin: String(margin),
  }).where(eq(samplesTable.id, id)).returning();
  res.json(await expandSample(updated));
});

router.post("/:id/outsource/receive", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }
  if (!sample.isOutsourced) { res.status(400).json({ error: "Sample is not marked as outsourced" }); return; }

  const [updated] = await db.update(samplesTable)
    .set({ outsourceReceivedAt: new Date() })
    .where(eq(samplesTable.id, id)).returning();
  res.json(await expandSample(updated));
});

router.delete("/:id/outsource", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }

  const [updated] = await db.update(samplesTable).set({
    isOutsourced: false,
    outsourceLab: null,
    outsourceExpectedAt: null,
    outsourceTrackingId: null,
    outsourceSentAt: null,
    outsourceReceivedAt: null,
    outsourceCostAmount: null,
    outsourceCostOverride: null,
    outsourcePatientBill: null,
    outsourceMargin: null,
  }).where(eq(samplesTable.id, id)).returning();
  res.json(await expandSample(updated));
});

// ─── Notes / metadata edit ──────────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const body = z.object({
    notes: z.string().optional(),
    volume: z.string().optional(),
    sampleType: z.string().refine((v) => SAMPLE_TYPES.includes(v)).optional(),
    containerType: z.string().refine((v) => CONTAINER_TYPES.includes(v)).optional(),
    collectionSite: z.string().refine((v) => COLLECTION_SITES.includes(v)).optional(),
    collectedByName: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.issues }); return; }

  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }

  const [updated] = await db.update(samplesTable).set(body.data).where(eq(samplesTable.id, id)).returning();
  res.json(await expandSample(updated));
});

// ─── Delete ─────────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const id = p.data.id;
  const [sample] = await db.select().from(samplesTable).where(eq(samplesTable.id, id));
  if (!sample) { res.status(404).json({ error: "Sample not found" }); return; }
  // ON DELETE CASCADE on sample_test_assignments removes the junction rows.
  await db.delete(samplesTable).where(eq(samplesTable.id, id));
  res.status(204).send();
});

export default router;
