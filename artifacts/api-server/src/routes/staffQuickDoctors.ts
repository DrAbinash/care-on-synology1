import { Router } from "express";
import { db, staffQuickDoctorsTable, clinicSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import {
  DEFAULT_QUICK_SELECT_IDS,
  isValidQuickSelectIds,
  normalizeQuickSelectIdsJson,
} from "../lib/quickSelectSlots";

// Per-staff Billing Desk / Online Booking Quick Doctor slot layout.
//
// Mounted at /api/my/quick-doctors behind requireStaffAuth ONLY (see
// routes/index.ts) — no module permission is required beyond being a
// logged-in staff member, because this endpoint only ever reads/writes the
// CALLER'S OWN row. `staffId` is always taken from `req.staffSession.subjectId`
// (populated by requireStaffAuth from the verified session token) — the
// request body's staffId, if any, is ignored, so one staff member can never
// read or overwrite another's layout.

const staffQuickDoctorsRouter = Router();

staffQuickDoctorsRouter.get("/", async (req, res) => {
  const staffId = (req as StaffAuthRequest).staffSession!.subjectId;

  const [own] = await db
    .select({ quickDoctorIds: staffQuickDoctorsTable.quickDoctorIds })
    .from(staffQuickDoctorsTable)
    .where(eq(staffQuickDoctorsTable.staffId, staffId))
    .limit(1);

  if (own) {
    res.json({ quickDoctorIds: normalizeQuickSelectIdsJson(own.quickDoctorIds) });
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

  res.json({
    quickDoctorIds: normalizeQuickSelectIdsJson(
      clinic?.quickDoctorIds ?? DEFAULT_QUICK_SELECT_IDS,
    ),
  });
});

staffQuickDoctorsRouter.put("/", async (req, res) => {
  const staffId = (req as StaffAuthRequest).staffSession!.subjectId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const quickDoctorIds = body.quickDoctorIds;

  if (typeof quickDoctorIds !== "string" || !isValidQuickSelectIds(quickDoctorIds)) {
    res.status(400).json({
      error:
        "quickDoctorIds must be a JSON-stringified array of 8 or 12 entries (positive integer doctor id or null)",
    });
    return;
  }

  const normalized = normalizeQuickSelectIdsJson(quickDoctorIds);

  await db
    .insert(staffQuickDoctorsTable)
    .values({ staffId, quickDoctorIds: normalized })
    .onConflictDoUpdate({
      target: staffQuickDoctorsTable.staffId,
      set: { quickDoctorIds: normalized, updatedAt: new Date() },
    });

  res.json({ ok: true, quickDoctorIds: normalized });
});

export default staffQuickDoctorsRouter;
