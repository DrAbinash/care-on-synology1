import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

// Schema for a single DICOM Q/R preset — mirrors the DicomPreset type in the frontend.
const dicomPresetFiltersSchema = z.object({
  dateFrom:         z.string(),
  dateTo:           z.string(),
  modalities:       z.array(z.string()),
  patientName:      z.string(),
  accessionNumber:  z.string(),
  referringDoctor:  z.string(),
  studyDescription: z.string(),
  aeTitle:          z.string(),
});

const dicomPresetSchema = z.object({
  id:        z.string(),
  name:      z.string().min(1).max(200),
  filters:   dicomPresetFiltersSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

// Tombstone: marks a preset as deleted so cross-device sync can propagate deletes.
const dicomTombstoneSchema = z.object({
  id:        z.string(),
  deleted:   z.literal(true),
  updatedAt: z.string(),
});

const dicomEntrySchema = z.union([dicomPresetSchema, dicomTombstoneSchema]);

const dicomPresetsPayloadSchema = z.array(dicomEntrySchema).max(200);

// Self-service: any authenticated staff member can persist their own sidebar
// theme preference without needing the /settings permission.
// Mounted BEFORE the /settings-gated usersRouter so this endpoint is reachable
// by all roles. Only the authenticated user may update their own record.
router.patch("/:id/sidebar-theme", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!req.staffSession || req.staffSession.subjectId !== id) {
    res.status(403).json({ error: "You can only update your own preferences" });
    return;
  }
  const value = typeof req.body.sidebarTheme === "string" ? req.body.sidebarTheme : null;
  await db.update(usersTable).set({ sidebarTheme: value }).where(eq(usersTable.id, id));
  res.json({ ok: true });
  return;
});

router.patch("/:id/pacs-network-profile", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!req.staffSession || req.staffSession.subjectId !== id) {
    res.status(403).json({ error: "You can only update your own preferences" });
    return;
  }
  const value = typeof req.body.pacsNetworkProfile === "string" ? req.body.pacsNetworkProfile : null;
  await db.update(usersTable).set({ pacsNetworkProfile: value }).where(eq(usersTable.id, id));
  res.json({ ok: true });
  return;
});

// Self-service DICOM Q/R preset sync — any authenticated staff can GET/PUT
// their own presets. No /settings permission required so radiologists on any
// role can access this from the PACS module.
// The stored list can contain both active preset entries and tombstones (deleted
// markers). Clients use the tombstones for per-entry last-write-wins merging so
// deletes propagate correctly across devices.
router.get("/me/dicom-presets", async (req: StaffAuthRequest, res) => {
  const id = req.staffSession?.subjectId;
  if (!id) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [row] = await db
    .select({ dicomPresets: usersTable.dicomPresets })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const presets = Array.isArray(row.dicomPresets) ? row.dicomPresets : [];
  res.json({ presets });
  return;
});

router.put("/me/dicom-presets", async (req: StaffAuthRequest, res) => {
  const id = req.staffSession?.subjectId;
  if (!id) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const parsed = dicomPresetsPayloadSchema.safeParse((req.body as { presets?: unknown })?.presets);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid presets payload", details: parsed.error.issues });
    return;
  }
  // Normalize: ensure every active preset has an updatedAt timestamp so the
  // server always stores comparable values for future conflict resolution.
  const now = new Date().toISOString();
  const entries = parsed.data.map((entry) => {
    if ("deleted" in entry) return entry;
    return { ...entry, updatedAt: entry.updatedAt ?? entry.createdAt ?? now };
  });
  await db
    .update(usersTable)
    .set({ dicomPresets: entries })
    .where(eq(usersTable.id, id));
  res.json({ ok: true, count: entries.length });
  return;
});

export default router;
