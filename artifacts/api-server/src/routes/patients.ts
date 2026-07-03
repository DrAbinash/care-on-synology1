import { Router } from "express";
import { db, patientsTable, patientCounterTable } from "@workspace/db";
import { eq, ilike, or, sql, desc, and, gt } from "drizzle-orm";
import {
  ListPatientsQueryParams,
  CreatePatientBody,
  UpdatePatientParams,
  UpdatePatientBody,
  GetPatientParams,
  GetPatientHistoryParams,
} from "@workspace/api-zod";
import { requireStaffSubPermission } from "../middleware/requireStaffAuth";

export const patientsRouter = Router();

type PatientRow = typeof patientsTable.$inferSelect;

export function sanitizePatient(p: PatientRow) {
  const { portalPinHash, ...safe } = p;
  return { ...safe, hasPortalAccess: portalPinHash !== null };
}

async function generatePatientId(): Promise<string> {
  // Derive next ID from the maximum numeric suffix in patient_id.
  // max(patient_id) is WRONG because string comparison is lexicographic:
  // 'P-00009' > 'P-00010' in Postgres, so the max string is not the latest number.
  //
  // Concurrency fix (Bug #3): We use pg_advisory_xact_lock(hash) to serialise
  // concurrent calls. Without this, two simultaneous registrations can both
  // read the same MAX and generate the same patient_id, causing a UNIQUE
  // constraint violation and a 500 at the front desk.
  //
  // pg_advisory_xact_lock is a transaction-scoped advisory lock. It is
  // released automatically when the enclosing transaction commits or rolls
  // back. We wrap the full read+compute inside a transaction so the lock
  // spans both the SELECT and the INSERT that follows (which happens outside
  // this function, so the caller must be inside the same transaction — or we
  // use a session-level lock here that we release after the insert).
  //
  // Using a session-level lock (pg_advisory_lock / pg_advisory_unlock) so
  // it works even though the INSERT happens after this function returns.
  const LOCK_ID = 0x50617469656e74; // ASCII "Patient" → stable integer key

  await db.execute(sql`SELECT pg_advisory_lock(${LOCK_ID})`);

  try {
    const rows = await db
      .select({ patientId: patientsTable.patientId })
      .from(patientsTable)
      .where(sql`${patientsTable.patientId} LIKE 'P-%'`);

    let max = 0;
    for (const row of rows) {
      const id = row.patientId;
      if (!id || !id.startsWith("P-")) continue;
      const num = parseInt(id.slice(2).replace(/\D/g, ""), 10);
      if (!isNaN(num) && num > max) max = num;
    }

    return `P-${String(max + 1).padStart(5, "0")}`;
  } catch (err) {
    // Always release even on error — caller will also need to release
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_ID})`).catch(() => {});
    throw err;
  }
  // Lock is released by releasePatientIdLock() after the INSERT succeeds
}

// The lock from generatePatientId() must be released after the INSERT commits.
const PATIENT_ID_LOCK = 0x50617469656e74;
async function releasePatientIdLock(): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(${PATIENT_ID_LOCK})`).catch(() => {});
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
  let patient;
  try {
    [patient] = await db
      .insert(patientsTable)
      .values(insertValues as typeof patientsTable.$inferInsert)
      .returning();
  } finally {
    // Release the advisory lock regardless of INSERT success/failure
    await releasePatientIdLock();
  }
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
    if (!["male", "female", "other"].includes(gender)) {
      skipped++;
      errors.push({ row: i + 2, reason: `Invalid gender "${gender}" — use male/female/other.` });
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

  const ordersWithTests = await Promise.all(
    orders.map(async (order) => {
      const orderTests = await db
        .select({ orderTest: orderTestsTable, test: testsTable })
        .from(orderTestsTable)
        .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
        .where(eq(orderTestsTable.orderId, order.id));

      let doctor = null;
      if (order.doctorId) {
        const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, order.doctorId));
        doctor = d ?? null;
      }

      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, order.patientId));

      return {
        ...order,
        totalAmount: Number(order.totalAmount),
        patient: patient ? sanitizePatient(patient) : null,
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
    })
  );

  res.json({ orders: ordersWithTests, total: ordersWithTests.length, page: 1, limit: 100 });
});
