import { Router } from "express";
import { db, reprintReasonsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";

const REPRINT_REASONS_CACHE_KEY = "reprint-reasons:list:v1";

const router = Router();

const DEFAULT_REASONS = [
  "Patient lost original copy",
  "Illegible / faded print",
  "Insurance claim requires duplicate",
  "Patient requested extra copy",
  "Correction after original print",
  "Employer / bank submission",
];

router.get("/", async (_req, res) => {
  // Same read pattern as discount-reasons — the Bill Detail re-print
  // dialog needs this list every time the dialog opens, so cache it.
  const cached = getCached<unknown[]>(REPRINT_REASONS_CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  let rows = await db.select().from(reprintReasonsTable).orderBy(asc(reprintReasonsTable.id));
  if (rows.length === 0) {
    await db.insert(reprintReasonsTable).values(
      DEFAULT_REASONS.map((label) => ({ label, isActive: true }))
    ).onConflictDoNothing();
    rows = await db.select().from(reprintReasonsTable).orderBy(asc(reprintReasonsTable.id));
  }
  setCached(REPRINT_REASONS_CACHE_KEY, rows, TTL.SHORT);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const label = String(req.body?.label ?? "").trim();
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  try {
    const [row] = await db.insert(reprintReasonsTable).values({ label, isActive: true }).returning();
    invalidateCached(REPRINT_REASONS_CACHE_KEY);
    res.json(row);
  } catch {
    res.status(409).json({ error: "Reason already exists" });
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const update: Record<string, unknown> = {};
  if (typeof req.body?.label === "string") update.label = req.body.label.trim();
  if (typeof req.body?.isActive === "boolean") update.isActive = req.body.isActive;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "no fields to update" });
    return;
  }
  const [row] = await db.update(reprintReasonsTable).set(update).where(eq(reprintReasonsTable.id, id)).returning();
  invalidateCached(REPRINT_REASONS_CACHE_KEY);
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(reprintReasonsTable).where(eq(reprintReasonsTable.id, id));
  invalidateCached(REPRINT_REASONS_CACHE_KEY);
  res.json({ ok: true });
});

export default router;
