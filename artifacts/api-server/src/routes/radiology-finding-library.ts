/**
 * radiology-finding-library.ts — editable findings catalogue behind the Report
 * Builder. Staff can add missed / new / new-style abnormal findings and modify
 * or (soft-)delete existing ones, organised by modality + organ (section).
 *
 * Seeded once from the mined house catalogue (the static asset the browser
 * ships), then fully DB-backed. Mounted at /api/radiology/finding-library with
 * requireStaffAuth + requireStaffPermission("/radiology"); write/seed operations
 * additionally require an admin role.
 *
 * GET  /            list active findings (?modality= &section=)
 * GET  /meta        { seeded, count, starterCount }
 * POST /            add a finding
 * PATCH /:id        edit a finding
 * DELETE /:id       soft-delete (?hard=1 admin hard-delete)
 * POST /seed        bulk-load starter findings (admin, once)
 */
import { Router, type Response } from "express";
import { db, radiologyFindingLibraryTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

export const radiologyFindingLibraryRouter = Router();

const MODALITIES = new Set(["CT", "USG", "MRI", "XRAY", "DOPPLER"]);

interface FindingDTO {
  id: string;
  text: string;
  modality: string;
  region: string | null;
  section: string;
  abnormal: boolean;
  impression: boolean;
  frequency: number;
  source: string;
  keywords: string[];
}
function toDTO(row: typeof radiologyFindingLibraryTable.$inferSelect): FindingDTO {
  return {
    id: `db${row.id}`,
    text: row.findingText,
    modality: row.modality,
    region: row.region,
    section: row.section,
    abnormal: row.isAbnormal,
    impression: row.isImpression,
    frequency: row.frequency,
    source: row.source,
    keywords: [],
  };
}
const isAdmin = (req: StaffAuthRequest): boolean => !!req.staffSession && FULL_ACCESS_ROLES.has(req.staffSession.role);
const parseId = (raw: unknown): number | null => {
  const s = Array.isArray(raw) ? "" : String(raw ?? "").replace(/^db/, "");
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
};
function cleanStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// ── list ──────────────────────────────────────────────────────────────────────
radiologyFindingLibraryRouter.get("/", async (req: StaffAuthRequest, res: Response) => {
  const modality = typeof req.query.modality === "string" ? req.query.modality : undefined;
  const section = typeof req.query.section === "string" ? req.query.section : undefined;
  const conds = [eq(radiologyFindingLibraryTable.isActive, true)];
  if (modality) conds.push(eq(radiologyFindingLibraryTable.modality, modality));
  if (section) conds.push(eq(radiologyFindingLibraryTable.section, section));
  const rows = await db.select().from(radiologyFindingLibraryTable).where(and(...conds));
  res.json({ findings: rows.map(toDTO) });
});

// ── meta (is the library seeded?) ──────────────────────────────────────────────
radiologyFindingLibraryRouter.get("/meta", async (_req: StaffAuthRequest, res: Response) => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radiologyFindingLibraryTable)
    .where(eq(radiologyFindingLibraryTable.isActive, true));
  const [{ count: starterCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radiologyFindingLibraryTable)
    .where(eq(radiologyFindingLibraryTable.source, "starter"));
  res.json({ seeded: count > 0, count, starterCount });
});

// ── add ───────────────────────────────────────────────────────────────────────
radiologyFindingLibraryRouter.post("/", async (req: StaffAuthRequest, res: Response) => {
  const b = req.body ?? {};
  const modality = cleanStr(b.modality, 20).toUpperCase();
  const section = cleanStr(b.section, 60);
  const text = cleanStr(b.text ?? b.findingText, 600);
  if (!MODALITIES.has(modality)) { res.status(400).json({ error: "Valid modality is required (CT/USG/MRI/XRAY)." }); return; }
  if (!section) { res.status(400).json({ error: "Organ/section is required." }); return; }
  if (text.length < 3) { res.status(400).json({ error: "Finding text is required." }); return; }
  const [row] = await db.insert(radiologyFindingLibraryTable).values({
    modality, section, findingText: text,
    region: cleanStr(b.region, 40) || null,
    isAbnormal: b.abnormal !== false,
    isImpression: b.impression === true,
    source: "custom",
    createdBy: req.staffSession?.subjectName ?? null,
    updatedBy: req.staffSession?.subjectName ?? null,
  }).returning();
  res.status(201).json({ finding: toDTO(row) });
});

// ── edit ──────────────────────────────────────────────────────────────────────
radiologyFindingLibraryRouter.patch("/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Bad id." }); return; }
  const b = req.body ?? {};
  const updates: Partial<typeof radiologyFindingLibraryTable.$inferInsert> = {
    updatedBy: req.staffSession?.subjectName ?? null,
    updatedAt: new Date(),
  };
  if (b.text !== undefined || b.findingText !== undefined) {
    const t = cleanStr(b.text ?? b.findingText, 600);
    if (t.length < 3) { res.status(400).json({ error: "Finding text is required." }); return; }
    updates.findingText = t;
  }
  if (b.section !== undefined) {
    const s = cleanStr(b.section, 60);
    if (!s) { res.status(400).json({ error: "Organ/section is required." }); return; }
    updates.section = s;
  }
  if (b.modality !== undefined) {
    const m = cleanStr(b.modality, 20).toUpperCase();
    if (!MODALITIES.has(m)) { res.status(400).json({ error: "Bad modality." }); return; }
    updates.modality = m;
  }
  if (b.region !== undefined) updates.region = cleanStr(b.region, 40) || null;
  if (b.abnormal !== undefined) updates.isAbnormal = b.abnormal === true;
  if (b.impression !== undefined) updates.isImpression = b.impression === true;

  const [row] = await db.update(radiologyFindingLibraryTable).set(updates)
    .where(eq(radiologyFindingLibraryTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  res.json({ finding: toDTO(row) });
});

// ── delete (soft by default) ───────────────────────────────────────────────────
radiologyFindingLibraryRouter.delete("/:id", async (req: StaffAuthRequest, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Bad id." }); return; }
  if (req.query.hard === "1") {
    if (!isAdmin(req)) { res.status(403).json({ error: "Admin required for hard delete." }); return; }
    await db.delete(radiologyFindingLibraryTable).where(eq(radiologyFindingLibraryTable.id, id));
    res.json({ deleted: true, hard: true });
    return;
  }
  const [row] = await db.update(radiologyFindingLibraryTable)
    .set({ isActive: false, updatedBy: req.staffSession?.subjectName ?? null, updatedAt: new Date() })
    .where(eq(radiologyFindingLibraryTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found." }); return; }
  res.json({ deleted: true });
});

// ── seed starter findings (admin, once) ─────────────────────────────────────────
radiologyFindingLibraryRouter.post("/seed", async (req: StaffAuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Only admin can seed the library." }); return; }
  const [{ count: existing }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(radiologyFindingLibraryTable)
    .where(eq(radiologyFindingLibraryTable.source, "starter"));
  if (existing > 0) { res.json({ inserted: 0, alreadySeeded: true, existing }); return; }

  const raw: Record<string, unknown>[] | null = Array.isArray(req.body?.findings) ? req.body.findings : null;
  if (!raw) { res.status(400).json({ error: "`findings` array required." }); return; }

  const rows = raw
    .map((f) => {
      const modality = cleanStr(f.modality, 20).toUpperCase();
      const section = cleanStr(f.section, 60);
      const text = cleanStr(f.text ?? f.findingText, 600);
      if (!MODALITIES.has(modality) || !section || text.length < 3) return null;
      return {
        modality, section, findingText: text,
        region: cleanStr(f.region, 40) || null,
        isAbnormal: f.abnormal !== false,
        isImpression: f.impression === true,
        frequency: typeof f.frequency === "number" ? Math.max(0, Math.min(1_000_000, Math.trunc(f.frequency))) : 0,
        source: "starter",
        createdBy: "system",
        updatedBy: "system",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await db.insert(radiologyFindingLibraryTable).values(batch);
    inserted += batch.length;
  }
  res.json({ inserted, total: raw.length });
});
