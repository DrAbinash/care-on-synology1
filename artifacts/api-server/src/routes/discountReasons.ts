import { Router } from "express";
import { db, discountReasonsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { getCached, setCached, invalidateCached, TTL } from "../lib/ttlCache";

const DISCOUNT_REASONS_CACHE_KEY = "discount-reasons:list:v1";

const router = Router();

const DEFAULT_REASONS = [
  "Senior Citizen",
  "Staff/Employee",
  "Doctor Referral",
  "Camp/Event",
  "Insurance/Corporate",
  "Goodwill",
  "Repeat Customer",
  "Promotional Offer",
];

router.get("/", async (_req, res) => {
  // Discount reasons are picked from a dropdown on nearly every bill with a
  // discount — cache the list for 5 min, invalidated on any edit below.
  const cached = getCached<unknown[]>(DISCOUNT_REASONS_CACHE_KEY);
  if (cached) {
    res.json(cached);
    return;
  }
  let rows = await db.select().from(discountReasonsTable).orderBy(asc(discountReasonsTable.id));
  if (rows.length === 0) {
    await db.insert(discountReasonsTable).values(
      DEFAULT_REASONS.map((label) => ({ label, isActive: true }))
    ).onConflictDoNothing();
    rows = await db.select().from(discountReasonsTable).orderBy(asc(discountReasonsTable.id));
  }
  setCached(DISCOUNT_REASONS_CACHE_KEY, rows, TTL.SHORT);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const label = String(req.body?.label ?? "").trim();
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  try {
    const [row] = await db.insert(discountReasonsTable).values({ label, isActive: true }).returning();
    invalidateCached(DISCOUNT_REASONS_CACHE_KEY);
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
  const [row] = await db.update(discountReasonsTable).set(update).where(eq(discountReasonsTable.id, id)).returning();
  invalidateCached(DISCOUNT_REASONS_CACHE_KEY);
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(discountReasonsTable).where(eq(discountReasonsTable.id, id));
  invalidateCached(DISCOUNT_REASONS_CACHE_KEY);
  res.json({ ok: true });
});

export default router;
