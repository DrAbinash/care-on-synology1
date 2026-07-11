import { Router } from "express";
import { db, staffQuickDoctorsTable, clinicSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

// Per-staff Billing Desk Quick Doctor slot layout.
//
// Mounted at /api/my/quick-doctors behind requireStaffAuth ONLY (see
// routes/index.ts) — no module permission is required beyond being a
// logged-in staff member, because this endpoint only ever reads/writes the
// CALLER'S OWN row. `staffId` is always taken from `req.staffSession.subjectId`
// (populated by requireStaffAuth from the verified session token) — the
// request body's staffId, if any, is ignored, so one staff member can never
// read or overwrite another's layout.

const DEFAULT_QUICK_DOCTOR_IDS = "[null,null,null,null,null,null,null,null]";
const MAX_PAYLOAD_LENGTH = 260;

function isValidQuickDoctorIds(value: string): boolean {
  if (value.length > MAX_PAYLOAD_LENGTH) return false;
  try {
    const parsed = JSON.parse(value);
    return (
      Array.isArray(parsed) &&
      parsed.length === 8 &&
      parsed.every((v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0))
    );
  } catch {
    return false;
  }
}

const staffQuickDoctorsRouter = Router();

staffQuickDoctorsRouter.get("/", async (req, res) => {
  const staffId = (req as StaffAuthRequest).staffSession!.subjectId;

  const [own] = await db
    .select({ quickDoctorIds: staffQuickDoctorsTable.quickDoctorIds })
    .from(staffQuickDoctorsTable)
    .where(eq(staffQuickDoctorsTable.staffId, staffId))
    .limit(1);

  if (own) {
    res.json({ quickDoctorIds: own.quickDoctorIds });
    return;
  }

  // No personal layout saved yet — bootstrap from the legacy clinic-wide
  // default (set before this per-staff table existed) so an existing
  // configured list is not silently lost on first load. This is read-only:
  // it does not create a personal row, so the shared default keeps showing
  // for every staff member until each saves their own layout.
  const [clinic] = await db
    .select({ quickDoctorIds: clinicSettingsTable.quickDoctorIds })
    .from(clinicSettingsTable)
    .limit(1);

  res.json({ quickDoctorIds: clinic?.quickDoctorIds ?? DEFAULT_QUICK_DOCTOR_IDS });
});

staffQuickDoctorsRouter.put("/", async (req, res) => {
  const staffId = (req as StaffAuthRequest).staffSession!.subjectId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const quickDoctorIds = body.quickDoctorIds;

  if (typeof quickDoctorIds !== "string" || !isValidQuickDoctorIds(quickDoctorIds)) {
    res.status(400).json({ error: "quickDoctorIds must be a JSON-stringified array of exactly 8 entries (positive integer doctor id or null)" });
    return;
  }

  await db
    .insert(staffQuickDoctorsTable)
    .values({ staffId, quickDoctorIds })
    .onConflictDoUpdate({
      target: staffQuickDoctorsTable.staffId,
      set: { quickDoctorIds, updatedAt: new Date() },
    });

  res.json({ ok: true, quickDoctorIds });
});

export default staffQuickDoctorsRouter;
