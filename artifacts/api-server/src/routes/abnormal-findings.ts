// Abnormal Findings library — pre-canned descriptions that the Report
// Generator auto-suggests (typed) or matches against speech-to-text input.
import { Router } from "express";
import { db } from "@workspace/db";
import { abnormalFindingsTable } from "@workspace/db/schema";
import { eq, and, or, ilike, sql, desc } from "drizzle-orm";
import {
  ListAbnormalFindingsQueryParams,
  GetAbnormalFindingParams,
  CreateAbnormalFindingBody,
  UpdateAbnormalFindingParams,
  UpdateAbnormalFindingBody,
  DeleteAbnormalFindingParams,
  IncrementAbnormalFindingUseParams,
} from "@workspace/api-zod";

export const abnormalFindingsRouter = Router();

// GET /api/abnormal-findings?testId=&modality=&q=&limit=
abnormalFindingsRouter.get("/", async (req, res) => {
  const queryParsed = ListAbnormalFindingsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Invalid request", details: queryParsed.error.issues });
    return;
  }
  const { testId, modality, q: rawQ, limit: rawLimit } = queryParsed.data;
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const limit = Math.min(rawLimit ?? 100, 500);

  const conds = [eq(abnormalFindingsTable.isActive, true)];
  if (testId != null) conds.push(or(eq(abnormalFindingsTable.testId, testId), sql`${abnormalFindingsTable.testId} IS NULL`)!);
  if (modality) conds.push(eq(abnormalFindingsTable.modality, modality));
  if (q) {
    conds.push(or(
      ilike(abnormalFindingsTable.keyword, `%${q}%`),
      ilike(abnormalFindingsTable.aliases, `%${q}%`),
      ilike(abnormalFindingsTable.category, `%${q}%`),
    )!);
  }

  const rows = await db.select().from(abnormalFindingsTable)
    .where(and(...conds))
    .orderBy(desc(abnormalFindingsTable.usageCount), abnormalFindingsTable.keyword)
    .limit(limit);
  res.json(rows);
});

abnormalFindingsRouter.get("/:id", async (req, res) => {
  const paramsParsed = GetAbnormalFindingParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const [row] = await db.select().from(abnormalFindingsTable).where(eq(abnormalFindingsTable.id, paramsParsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

abnormalFindingsRouter.post("/", async (req, res) => {
  const bodyParsed = CreateAbnormalFindingBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const body = bodyParsed.data;
  const [row] = await db.insert(abnormalFindingsTable).values({
    testId: body.testId ?? null,
    modality: body.modality ?? null,
    category: body.category ?? null,
    keyword: body.keyword.trim(),
    aliases: body.aliases ?? null,
    description: body.description,
    severity: body.severity || "moderate",
    isActive: body.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

abnormalFindingsRouter.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateAbnormalFindingParams.safeParse(req.params);
  const bodyParsed = UpdateAbnormalFindingBody.safeParse(req.body);
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
  const body = bodyParsed.data;
  const updates: Partial<typeof abnormalFindingsTable.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["testId", "modality", "category", "keyword", "aliases", "description", "severity", "isActive"] as const) {
    if (body[k] !== undefined) (updates as Record<string, unknown>)[k] = body[k];
  }
  const [row] = await db.update(abnormalFindingsTable).set(updates).where(eq(abnormalFindingsTable.id, paramsParsed.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

abnormalFindingsRouter.delete("/:id", async (req, res) => {
  const paramsParsed = DeleteAbnormalFindingParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const r = await db.delete(abnormalFindingsTable).where(eq(abnormalFindingsTable.id, paramsParsed.data.id)).returning();
  if (r.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ success: true });
});

// POST /api/abnormal-findings/:id/use — increments usage counter (for ranking)
abnormalFindingsRouter.post("/:id/use", async (req, res) => {
  const paramsParsed = IncrementAbnormalFindingUseParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const [row] = await db.update(abnormalFindingsTable)
    .set({ usageCount: sql`${abnormalFindingsTable.usageCount} + 1` })
    .where(eq(abnormalFindingsTable.id, paramsParsed.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

export default abnormalFindingsRouter;
