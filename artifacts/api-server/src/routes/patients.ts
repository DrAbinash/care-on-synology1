import { Router } from "express";
import { db, patientsTable } from "@workspace/db";
import { eq, ilike, or, sql, desc, and, gt, inArray } from "drizzle-orm";
import {
  ListPatientsQueryParams,
  CreatePatientBody,
  UpdatePatientParams,
  UpdatePatientBody,
  GetPatientParams,
  GetPatientHistoryParams,
} from "@workspace/api-zod";
import { requireStaffSubPermission } from "../middleware/requireStaffAuth";
import { isClinicPatientPhoneRequired, phoneLooksPresent } from "../lib/patientPhoneRequired";
import { nextPatientId } from "../lib/documentNumberCounters";

export const patientsRouter = Router();

type PatientRow = typeof patientsTable.$inferSelect;

export function sanitizePatient(p: PatientRow) {
  const { portalPinHash, ...safe } = p;
  return { ...safe, hasPortalAccess: portalPinHash !== null };
}

/** Allocate next UHID via SEQUENCE nextval (no session advisory lock). */
async function generatePatientId(): Promise<string> {
  return nextPatientId(db);
}

/** Same UHID allocator + patients insert as POST /api/patients (no parallel emergency patient table). */
export async function createCanonicalPatient(values: {
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  ageValue?: number | null;
  ageUnit?: string | null;
  address?: string | null;
}): Promise<PatientRow> {
  const patientId = await generatePatientId();
  const [patient] = await db
    .insert(patientsTable)
    .values({
      patientId,
      firstName: values.firstName.trim() || "Unknown",
      lastName: values.lastName.trim() || "-",
      phone: values.phone.trim() || "0000000000",
      dateOfBirth: values.dateOfBirth,
      gender: values.gender,
      ageValue: values.ageValue ?? null,
      ageUnit: values.ageUnit ?? null,
      address: values.address ?? null,
    })
    .returning();
  return patient;
}

patientsRouter.get("/", async (req, res) => {
  const parsed = ListPatientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  const { search, page = 1, limit = 20 } = parsed.data;
  const offset = (page - 1) * limit;

  let query = db.select().from(patientsTable);
  if (search) {
    query = query.where(
      or(
        ilike(patientsTable.firstName, `%${search}%`),
        ilike(patientsTable.lastName, `%${search}%`),
        ilike(patientsTable.phone, `%${search}%`),
        ilike(patientsTable.patientId, `%${search}%`)
      )
    ) as typeof query;
  }

  const [patients, countResult] = await Promise.all([
    query.orderBy(desc(patientsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(patientsTable),
  ]);

  res.json({
    patients: patients.map(sanitizePatient),
    total: Number(countResult[0]?.count ?? 0),
    page,
    limit,
  });
});

// Photo data URL size cap — same ~1.5 MB practical limit we apply to the
// clinic logo. The data URL is base64-encoded so the actual binary is ~75% of
// the string length.
const PHOTO_MAX_BYTES = 2_000_000;

function extractPhotoDataUrl(body: unknown): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: true, value: undefined };
  const raw = (body as Record<string, unknown>).photoDataUrl;
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "photoDataUrl must be a string, null, or omitted" };
  if (!raw.startsWith("data:image/")) return { ok: false, error: "photoDataUrl must be an image data URL" };
  if (raw.length > PHOTO_MAX_BYTES) return { ok: false, error: "Patient photo too large (max ~1.5 MB)" };
  return { ok: true, value: raw };
}

patientsRouter.post("/", requireStaffSubPermission("/patients", "create"), async (req, res) => {
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const photo = extractPhotoDataUrl(req.body);
  if (!photo.ok) {
    res.status(400).json({ error: photo.error });
    return;
  }

  // Guard against duplicate patients: same phone + name within last 5 minutes.
  // Staff often double-click "Register & Select", retry a slow request, or
  // walk away and come back without searching for the patient they just made.
  const phone = parsed.data.phone?.trim();
  const firstName = parsed.data.firstName?.trim();
  const lastName = parsed.data.lastName?.trim();

  // Require at least one name field to be filled
  if (!firstName && !lastName) {
    res.status(400).json({ error: "At least a first name or last name is required." });
    return;
  }

  // Settings → Clinic Info → Patient Phone Requirement (Bill Desk / Patients / Quick Register).
  // Kiosk & online booking enforce phone on their own paths and ignore this flag.
  if ((await isClinicPatientPhoneRequired()) && !phoneLooksPresent(phone)) {
    res.status(400).json({
      error: "Patient phone number is required. Turn off Patient Phone Requirement in Settings → Clinic Info to allow registration without a phone.",
    });
    return;
  }

  // Duplicate guard: only check when phone + both name parts are present
  if (phone && firstName && lastName) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    const [dup] = await db
      .select({ id: patientsTable.id, patientId: patientsTable.patientId })
      .from(patientsTable)
      .where(
        and(
          eq(patientsTable.phone, phone),
          ilike(patientsTable.firstName, firstName),
          ilike(patientsTable.lastName, lastName),
          gt(patientsTable.createdAt, fiveMinutesAgo),
        ),
      )
      .limit(1);
    if (dup) {
      res.status(409).json({
        error: `A patient with the same name and phone was just created (${dup.patientId}). Please search for the existing patient instead of creating a duplicate.`,
        existingPatientId: dup.patientId,
      });
      return;
    }
  }

  const patientId = await generatePatientId();
  const insertValues: Record<string, unknown> = { ...parsed.data, patientId };
  if (photo.value !== undefined) insertValues.photoDataUrl = photo.value;
  const [patient] = await db
    .insert(patientsTable)
    .values(insertValues as typeof patientsTable.$inferInsert)
    .returning();
  res.status(201).json(sanitizePatient(patient));
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Upsert by patientId when present (the human-readable "P-00123" key the
// system itself emits), otherwise fall back to phone + firstName + lastName
// to detect repeats across imports. Photo and portal PIN are intentionally
// NOT importable — they are sensitive and have separate UI flows.
patientsRouter.post("/import", requireStaffSubPermission("/patients", "create"), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : null;
  if (!rows) {
    res.status(400).json({ error: "Request body must include `rows: []`." });
    return;
  }
  if (rows.length > 5000) {
    res.status(413).json({ error: "Too many rows in one import (max 5000)." });
    return;
  }

  let inserted = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const firstName = String(r.firstName ?? "").trim();
    const lastName = String(r.lastName ?? "").trim();
    const phone = String(r.phone ?? "").trim();
    const dateOfBirth = String(r.dateOfBirth ?? "").trim();
    const gender = String(r.gender ?? "").trim().toLowerCase();
    const patientIdInput = typeof r.patientId === "string" ? r.patientId.trim() : "";

    if (!firstName || !lastName || !phone || !dateOfBirth || !gender) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (firstName, lastName, phone, dateOfBirth, gender)." });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      skipped++;
      errors.push({ row: i + 2, reason: `Invalid dateOfBirth "${dateOfBirth}" — use YYYY-MM-DD.` });
      continue;
    }
    if (!["male", "female"].includes(gender)) {
      skipped++;
      errors.push({ row: i + 2, reason: `Invalid gender "${gender}" — use male/female.` });
      continue;
    }

    const values = {
      firstName, lastName, phone, dateOfBirth, gender,
      email: typeof r.email === "string" && r.email.trim() ? r.email.trim() : null,
      address: typeof r.address === "string" && r.address.trim() ? r.address.trim() : null,
      bloodGroup: typeof r.bloodGroup === "string" && r.bloodGroup.trim() ? r.bloodGroup.trim() : null,
    };

    try {
      let existingId: number | undefined;
      if (patientIdInput) {
        const [hit] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.patientId, patientIdInput));
        existingId = hit?.id;
      }
      if (!existingId) {
        const [hit] = await db.select({ id: patientsTable.id }).from(patientsTable).where(
          sql`${patientsTable.phone} = ${phone} AND lower(${patientsTable.firstName}) = lower(${firstName}) AND lower(${patientsTable.lastName}) = lower(${lastName})`
        );
        existingId = hit?.id;
      }

      if (existingId) {
        await db.update(patientsTable).set(values).where(eq(patientsTable.id, existingId));
        updated++;
      } else {
        const newPatientId = patientIdInput || await generatePatientId();
        await db.insert(patientsTable).values({ ...values, patientId: newPatientId });
        inserted++;
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: (e as Error).message || "Database error" });
    }
  }

  res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

patientsRouter.get("/:id", async (req, res) => {
  const parsed = GetPatientParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, parsed.data.id));
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json(sanitizePatient(patient));
});

patientsRouter.put("/:id", requireStaffSubPermission("/patients", "edit"), async (req, res) => {
  const paramsParsed = UpdatePatientParams.safeParse({ id: Number(req.params.id) });
  // Use a partial schema so PATCH-style updates (e.g., setting only the
  // photoDataUrl from the patient detail page) are accepted without requiring
  // the full patient body. Drizzle .set() only writes the provided fields.
  const bodyParsed = UpdatePatientBody.partial().safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const photo = extractPhotoDataUrl(req.body);
  if (!photo.ok) {
    res.status(400).json({ error: photo.error });
    return;
  }
  const updateValues: Record<string, unknown> = { ...bodyParsed.data };
  if (photo.value !== undefined) updateValues.photoDataUrl = photo.value;
  if (Object.keys(updateValues).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  // Clearing / omitting a usable phone is blocked when the clinic requires it.
  if (
    Object.prototype.hasOwnProperty.call(updateValues, "phone")
    && (await isClinicPatientPhoneRequired())
    && !phoneLooksPresent(updateValues.phone as string | null | undefined)
  ) {
    res.status(400).json({
      error: "Patient phone number is required. Turn off Patient Phone Requirement in Settings → Clinic Info to clear it.",
    });
    return;
  }
  const [updated] = await db
    .update(patientsTable)
    .set(updateValues)
    .where(eq(patientsTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json(sanitizePatient(updated));
});

patientsRouter.get("/:id/history", async (req, res) => {
  const parsed = GetPatientHistoryParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { ordersTable, orderTestsTable, testsTable, doctorsTable } = await import("@workspace/db");

  const orders = await db.select().from(ordersTable).where(eq(ordersTable.patientId, parsed.data.id)).orderBy(desc(ordersTable.createdAt));

  // Fetch this patient once (already known from the route param — no need to
  // re-query it per order) and batch-fetch order-tests + doctors in two
  // queries total instead of 2 queries PER ORDER (was a classic N+1: a
  // patient with 40 orders triggered ~120 sequential DB round-trips here).
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, parsed.data.id));
  const sanitizedPatient = patient ? sanitizePatient(patient) : null;

  const orderIds = orders.map((o) => o.id);
  const doctorIds = [...new Set(orders.map((o) => o.doctorId).filter((id): id is number => id != null))];

  const allOrderTests = orderIds.length
    ? await db
        .select({ orderTest: orderTestsTable, test: testsTable })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(inArray(orderTestsTable.orderId, orderIds))
    : [];
  const testsByOrderId = new Map<number, typeof allOrderTests>();
  for (const row of allOrderTests) {
    const list = testsByOrderId.get(row.orderTest.orderId) ?? [];
    list.push(row);
    testsByOrderId.set(row.orderTest.orderId, list);
  }

  const doctors = doctorIds.length
    ? await db.select().from(doctorsTable).where(inArray(doctorsTable.id, doctorIds))
    : [];
  const doctorsById = new Map(doctors.map((d) => [d.id, d]));

  const ordersWithTests = orders.map((order) => {
    const orderTests = testsByOrderId.get(order.id) ?? [];
    const doctor = order.doctorId ? (doctorsById.get(order.doctorId) ?? null) : null;

    return {
      ...order,
      totalAmount: Number(order.totalAmount),
      patient: sanitizedPatient,
      doctor,
      tests: orderTests.map((ot) => ({
        ...ot.orderTest,
        price: Number(ot.orderTest.price),
        test: ot.test
          ? {
              ...ot.test,
              price: Number(ot.test.price),
            }
          : null,
      })),
    };
  });

  res.json({ orders: ordersWithTests, total: ordersWithTests.length, page: 1, limit: 100 });
});
