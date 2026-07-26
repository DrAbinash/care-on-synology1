import { Router } from "express";
import { db } from "@workspace/db";
import {
  appointmentsTable,
  appointmentCounterTable,
  patientsTable,
  doctorsTable,
} from "@workspace/db/schema";
import { eq, desc, and, inArray, ne } from "drizzle-orm";
import {
  CreateAppointmentBody,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
} from "@workspace/api-zod";

const router = Router();

// Statuses that actively hold a doctor's slot — a cancelled/completed/
// no-show appointment no longer occupies it, so a new booking landing on the
// same doctor+date+timeSlot is not a real conflict.
const SLOT_HOLDING_STATUSES = ["scheduled", "confirmed"];

/** Finds another appointment (excluding excludeId) that already holds this
 *  exact doctor+date+timeSlot. Returns null when the slot is free — there
 *  was previously no check at all here, so any number of appointments could
 *  be booked onto the same doctor at the same time. */
async function findSlotConflict(
  doctorId: number,
  appointmentDate: string,
  timeSlot: string,
  excludeId?: number,
) {
  const [conflict] = await db
    .select({ id: appointmentsTable.id, appointmentId: appointmentsTable.appointmentId })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        eq(appointmentsTable.appointmentDate, appointmentDate),
        eq(appointmentsTable.timeSlot, timeSlot),
        inArray(appointmentsTable.status, SLOT_HOLDING_STATUSES),
        excludeId !== undefined ? ne(appointmentsTable.id, excludeId) : undefined,
      )
    )
    .limit(1);
  return conflict ?? null;
}

async function generateAppointmentId(): Promise<string> {
  const [counter] = await db.select().from(appointmentCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(appointmentCounterTable).set({ counter: seq }).where(eq(appointmentCounterTable.id, counter.id));
  } else {
    await db.insert(appointmentCounterTable).values({ counter: 1 });
  }
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `APT-${yymm}-${String(seq).padStart(4, "0")}`;
}

// List appointments with filters
router.get("/", async (req, res) => {
  const { date, status, patientId, doctorId } = req.query as Record<string, string>;

  // Safety default: if the caller passes NO filter at all (no date, no
  // patient, no doctor), this previously loaded every appointment ever
  // created with two joins, every time. The normal ERP UI always sends a
  // date, so this only guards against a future caller (or a stray request)
  // omitting all filters. Explicit ?all=true bypasses the default for the
  // rare legitimate "all appointments" report use case, still capped at 500.
  const noFilterGiven = !date && !status && !patientId && !doctorId;
  const wantsAll = req.query.all === "true";
  const effectiveDate = noFilterGiven && !wantsAll ? todayIST() : date;
  const rowLimit = wantsAll ? 500 : 200;

  const rows = await db
    .select({
      appointment: appointmentsTable,
      patient: {
        id: patientsTable.id,
        patientId: patientsTable.patientId,
        firstName: patientsTable.firstName,
        lastName: patientsTable.lastName,
        phone: patientsTable.phone,
      },
      doctor: {
        id: doctorsTable.id,
        name: doctorsTable.name,
      },
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(doctorsTable, eq(appointmentsTable.doctorId, doctorsTable.id))
    .where(
      and(
        effectiveDate ? eq(appointmentsTable.appointmentDate, effectiveDate) : undefined,
        status ? eq(appointmentsTable.status, status) : undefined,
        patientId ? eq(appointmentsTable.patientId, Number(patientId)) : undefined,
        doctorId ? eq(appointmentsTable.doctorId, Number(doctorId)) : undefined,
      )
    )
    .orderBy(desc(appointmentsTable.createdAt))
    .limit(rowLimit);

  return res.json(
    rows.map((r) => ({
      ...r.appointment,
      patient: r.patient,
      doctor: r.doctor,
    }))
  );
});

import { todayIST } from "../lib/istDate";

// Stats for today
router.get("/stats", async (req, res) => {
  const today = todayIST();
  const rows = await db
    .select()
    .from(appointmentsTable)
    .where(eq(appointmentsTable.appointmentDate, today));

  const total = rows.length;
  const scheduled = rows.filter((r) => r.status === "scheduled").length;
  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const noShow = rows.filter((r) => r.status === "no-show").length;

  return res.json({ total, scheduled, confirmed, completed, cancelled, noShow });
});

// Get single appointment
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db
    .select({
      appointment: appointmentsTable,
      patient: {
        id: patientsTable.id,
        patientId: patientsTable.patientId,
        firstName: patientsTable.firstName,
        lastName: patientsTable.lastName,
        phone: patientsTable.phone,
      },
      doctor: {
        id: doctorsTable.id,
        name: doctorsTable.name,
      },
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(doctorsTable, eq(appointmentsTable.doctorId, doctorsTable.id))
    .where(eq(appointmentsTable.id, id));

  if (!row) return res.status(404).json({ error: "Appointment not found" });
  return res.json({ ...row.appointment, patient: row.patient, doctor: row.doctor });
});

// Create appointment
router.post("/", async (req, res) => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
  }
  const { patientId, doctorId, packageId, appointmentDate, timeSlot, status, type, notes } = parsed.data;

  if (doctorId && SLOT_HOLDING_STATUSES.includes(status || "scheduled")) {
    const conflict = await findSlotConflict(doctorId, appointmentDate, timeSlot);
    if (conflict) {
      return res.status(409).json({
        error: `This doctor already has an appointment (${conflict.appointmentId}) in that time slot`,
        conflictingAppointmentId: conflict.appointmentId,
      });
    }
  }

  const aptId = await generateAppointmentId();

  // Resolve ledger from doctor → patient → default
  let ledgerId = 1;
  if (doctorId) {
    const [d] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
    if (d?.ledgerId) ledgerId = d.ledgerId;
  }
  if (ledgerId === 1) {
    const [p] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
    if (p?.ledgerId) ledgerId = p.ledgerId;
  }

  const [apt] = await db
    .insert(appointmentsTable)
    .values({
      appointmentId: aptId,
      patientId,
      doctorId: doctorId ?? null,
      packageId: packageId ?? null,
      appointmentDate,
      timeSlot,
      status: status || "scheduled",
      type: type || "walk-in",
      notes: notes ?? null,
      ledgerId,
    })
    .returning();

  return res.status(201).json(apt);
});

// Update appointment status / fields
router.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateAppointmentParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const bodyParsed = UpdateAppointmentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: "Invalid body", details: bodyParsed.error.issues });
  }
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bodyParsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  // Only re-check the slot when doctorId/appointmentDate/timeSlot/status is
  // actually part of this update — a change to e.g. `notes` alone can't
  // create a double-booking.
  if ("doctorId" in updates || "appointmentDate" in updates || "timeSlot" in updates || "status" in updates) {
    const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, paramsParsed.data.id));
    if (!existing) return res.status(404).json({ error: "Appointment not found" });

    const effectiveDoctorId = "doctorId" in updates ? (updates.doctorId as number | null) : existing.doctorId;
    const effectiveDate = "appointmentDate" in updates ? (updates.appointmentDate as string) : existing.appointmentDate;
    const effectiveSlot = "timeSlot" in updates ? (updates.timeSlot as string) : existing.timeSlot;
    const effectiveStatus = "status" in updates ? (updates.status as string) : existing.status;

    if (effectiveDoctorId && SLOT_HOLDING_STATUSES.includes(effectiveStatus)) {
      const conflict = await findSlotConflict(effectiveDoctorId, effectiveDate, effectiveSlot, paramsParsed.data.id);
      if (conflict) {
        return res.status(409).json({
          error: `This doctor already has an appointment (${conflict.appointmentId}) in that time slot`,
          conflictingAppointmentId: conflict.appointmentId,
        });
      }
    }
  }

  const [apt] = await db
    .update(appointmentsTable)
    .set(updates)
    .where(eq(appointmentsTable.id, paramsParsed.data.id))
    .returning();
  if (!apt) return res.status(404).json({ error: "Appointment not found" });
  return res.json(apt);
});

// Delete appointment
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [apt] = await db
    .delete(appointmentsTable)
    .where(eq(appointmentsTable.id, id))
    .returning();
  if (!apt) return res.status(404).json({ error: "Appointment not found" });
  return res.json({ success: true });
});

export { router as appointmentsRouter };
