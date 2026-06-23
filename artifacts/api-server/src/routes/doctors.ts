import { Router } from "express";
import { db, doctorsTable, ordersTable, billsTable, appointmentsTable, doctorPayoutsTable, commissionRulesTable } from "@workspace/db";
import { ilike, or, desc, eq, and, sql, count } from "drizzle-orm";
import {
  ListDoctorsQueryParams,
  CreateDoctorBody,
  UpdateDoctorParams,
  UpdateDoctorBody,
  DeleteDoctorParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

export const doctorsRouter = Router();

doctorsRouter.get("/", async (req, res) => {
  const parsed = ListDoctorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { search } = parsed.data;

  let query = db
    .select({
      id: doctorsTable.id,
      name: doctorsTable.name,
      specialization: doctorsTable.specialization,
      phone: doctorsTable.phone,
      email: doctorsTable.email,
      hospitalAffiliation: doctorsTable.hospitalAffiliation,
      address: doctorsTable.address,
      area: doctorsTable.area,
      registrationNumber: doctorsTable.registrationNumber,
      defaultCommissionType: doctorsTable.defaultCommissionType,
      defaultCommission: doctorsTable.defaultCommission,
      ledgerId: doctorsTable.ledgerId,
      createdAt: doctorsTable.createdAt,
      billCount: sql<number>`COALESCE(count(${billsTable.id}), 0)::int`,
    })
    .from(doctorsTable)
    .leftJoin(ordersTable, eq(ordersTable.doctorId, doctorsTable.id))
    .leftJoin(billsTable, eq(billsTable.orderId, ordersTable.id));

  if (search) {
    query = query.where(
      or(
        ilike(doctorsTable.name, `%${search}%`),
        ilike(doctorsTable.specialization, `%${search}%`),
        ilike(doctorsTable.hospitalAffiliation, `%${search}%`),
        ilike(doctorsTable.address, `%${search}%`),
        ilike(doctorsTable.area, `%${search}%`)
      )
    ) as typeof query;
  }

  const doctors = await query
    .groupBy(doctorsTable.id)
    .orderBy(desc(sql`COALESCE(count(${billsTable.id}), 0)`), desc(doctorsTable.createdAt));

  res.json({ doctors, total: doctors.length });
});

doctorsRouter.post("/", async (req, res) => {
  const parsed = CreateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const ledgerId = req.body?.ledgerId !== undefined && req.body.ledgerId !== null
    ? Number(req.body.ledgerId)
    : null;
  const [doctor] = await db.insert(doctorsTable).values({ ...parsed.data, ledgerId }).returning();
  res.status(201).json(doctor);
});

doctorsRouter.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateDoctorParams.safeParse(req.params);
  const bodyParsed = UpdateDoctorBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const body = bodyParsed.data;

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.specialization !== undefined) updates.specialization = body.specialization;
  if (body.phone !== undefined) updates.phone = body.phone || null;
  if (body.email !== undefined) updates.email = body.email || null;
  if (body.hospitalAffiliation !== undefined) updates.hospitalAffiliation = body.hospitalAffiliation || null;
  if (body.address !== undefined) updates.address = body.address || null;
  if (body.area !== undefined) updates.area = body.area || null;
  // Module B: registrationNumber persists from the Doctors form so PCPNDT Form F can auto-fill it.
  if (body.registrationNumber !== undefined) updates.registrationNumber = body.registrationNumber || null;
  if (body.defaultCommission !== undefined) updates.defaultCommission = String(body.defaultCommission);
  if (body.defaultCommissionType !== undefined) updates.defaultCommissionType = body.defaultCommissionType;
  if (body.ledgerId !== undefined) updates.ledgerId = body.ledgerId === null ? null : Number(body.ledgerId);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [doctor] = await db.update(doctorsTable).set(updates).where(eq(doctorsTable.id, id)).returning();
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }
  res.json(doctor);
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Accepts an array of row objects (parsed client-side). Upserts on
// `registrationNumber` when present (the most reliable unique key —
// medical council numbers are globally unique), otherwise on
// `name + phone`. Returns per-row counts plus the first 50 row-level
// errors for the UI to surface.
doctorsRouter.post("/import", async (req, res) => {
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
    const name = String(r.name ?? "").trim();
    const specialization = String(r.specialization ?? "").trim();

    if (!name || !specialization) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (name or specialization)." });
      continue;
    }

    const phone = typeof r.phone === "string" && r.phone.trim() ? r.phone.trim() : null;
    const email = typeof r.email === "string" && r.email.trim() ? r.email.trim() : null;
    const hospitalAffiliation = typeof r.hospitalAffiliation === "string" && r.hospitalAffiliation.trim()
      ? r.hospitalAffiliation.trim() : null;
    const address = typeof r.address === "string" && r.address.trim() ? r.address.trim() : null;
    const area = typeof r.area === "string" && r.area.trim() ? r.area.trim() : null;
    const registrationNumber = typeof r.registrationNumber === "string" && r.registrationNumber.trim()
      ? r.registrationNumber.trim() : null;

    const values = { name, specialization, phone, email, hospitalAffiliation, address, area, registrationNumber };

    try {
      // Match priority: registrationNumber > name+phone > name only.
      let existingId: number | undefined;
      if (registrationNumber) {
        const [hit] = await db.select({ id: doctorsTable.id })
          .from(doctorsTable)
          .where(eq(doctorsTable.registrationNumber, registrationNumber));
        existingId = hit?.id;
      }
      if (!existingId && phone) {
        const [hit] = await db.select({ id: doctorsTable.id })
          .from(doctorsTable)
          .where(and(eq(doctorsTable.name, name), eq(doctorsTable.phone, phone)));
        existingId = hit?.id;
      }
      if (!existingId) {
        const [hit] = await db.select({ id: doctorsTable.id })
          .from(doctorsTable)
          .where(eq(doctorsTable.name, name));
        existingId = hit?.id;
      }

      if (existingId) {
        await db.update(doctorsTable).set(values).where(eq(doctorsTable.id, existingId));
        updated++;
      } else {
        await db.insert(doctorsTable).values(values);
        inserted++;
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: (e as Error).message || "Database error" });
    }
  }

  res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

doctorsRouter.delete("/:id", async (req, res) => {
  const paramsParsed = DeleteDoctorParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const id = paramsParsed.data.id;

  // Check for linked orders that would block deletion
  const [linkedOrders] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(eq(ordersTable.doctorId, id));

  if (linkedOrders && linkedOrders.count > 0) {
    res.status(409).json({
      error: "Doctor has linked orders",
      details: `This doctor is referenced by ${linkedOrders.count} order(s). Remove or reassign those orders first, or use the merge feature instead.`,
    });
    return;
  }

  try {
    // Unlink appointments (set doctorId to null)
    await db.update(appointmentsTable).set({ doctorId: null }).where(eq(appointmentsTable.doctorId, id));

    // Delete commission rules
    await db.delete(commissionRulesTable).where(eq(commissionRulesTable.doctorId, id));

    // Delete doctor payouts
    await db.delete(doctorPayoutsTable).where(eq(doctorPayoutsTable.doctorId, id));

    // Delete the doctor
    await db.delete(doctorsTable).where(eq(doctorsTable.id, id));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err, doctorId: id }, "Failed to delete doctor");
    res.status(500).json({ error: "Delete failed", details: (err as Error).message });
  }
});

