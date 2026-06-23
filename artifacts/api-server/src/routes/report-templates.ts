// Report Templates — per-test template library used by Report Generator.
import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { reportTemplatesTable, testsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const reportTemplatesRouter = Router();

// Local validation schemas. Mirrors the safeParse + standardized error
// shape used in patients.ts / appointments.ts. The OpenAPI spec covers
// these endpoints; generated zod schemas can be wired in later.
const IdParams = z.object({ id: z.coerce.number().int().positive() });

const ListQuery = z.object({
  testId: z.coerce.number().int().positive().optional(),
});

const CreateBody = z.object({
  testId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "name is required"),
  content: z.string().trim().min(1, "content is required"),
  format: z.enum(["html", "text"]).optional(),
  isDefault: z.boolean().optional(),
  tags: z.string().nullable().optional(),
  modality: z.string().nullable().optional(),
});

const UpdateBody = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  format: z.enum(["html", "text"]).optional(),
  isDefault: z.boolean().optional(),
  tags: z.string().nullable().optional(),
  modality: z.string().nullable().optional(),
});

// GET /api/report-templates?testId=42  — list templates (optionally filtered)
reportTemplatesRouter.get("/", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const testId = parsed.data.testId ?? null;
  const rows = testId
    ? await db.select().from(reportTemplatesTable).where(eq(reportTemplatesTable.testId, testId)).orderBy(desc(reportTemplatesTable.isDefault), reportTemplatesTable.name)
    : await db.select().from(reportTemplatesTable).orderBy(desc(reportTemplatesTable.isDefault), reportTemplatesTable.name);
  res.json(rows);
});

reportTemplatesRouter.get("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid request", details: p.error.issues });
    return;
  }
  const [row] = await db.select().from(reportTemplatesTable).where(eq(reportTemplatesTable.id, p.data.id));
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

// POST /api/report-templates  — upload a new template tagged to a test
reportTemplatesRouter.post("/", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { testId, isDefault: wantsDefault = false } = parsed.data;
  const name = parsed.data.name.trim();
  const content = parsed.data.content.trim();
  if (!name || !content) {
    res.status(400).json({ error: "testId, name and content are required" });
    return;
  }

  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, testId));
  if (!test) {
    res.status(404).json({ error: "Test not found" });
    return;
  }

  const format = parsed.data.format ?? "text";
  const tags = parsed.data.tags ? parsed.data.tags.trim() || null : null;
  const modality = parsed.data.modality ? parsed.data.modality.trim() || null : null;

  const inserted = await db.transaction(async (tx) => {
    if (wantsDefault) {
      await tx.update(reportTemplatesTable)
        .set({ isDefault: false })
        .where(and(eq(reportTemplatesTable.testId, testId), eq(reportTemplatesTable.isDefault, true)));
    }
    const [row] = await tx.insert(reportTemplatesTable).values({
      testId, name, content, format, isDefault: wantsDefault,
      tags, modality,
    }).returning();
    return row;
  });
  res.status(201).json(inserted);
});

// PATCH /api/report-templates/:id  — rename / set default / replace content
reportTemplatesRouter.patch("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid request", details: p.error.issues });
    return;
  }
  const bodyParsed = UpdateBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const id = p.data.id;
  const [existing] = await db.select().from(reportTemplatesTable).where(eq(reportTemplatesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const body = bodyParsed.data;
  const updates: Partial<typeof reportTemplatesTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.content === "string") updates.content = body.content;
  if (body.format) updates.format = body.format;
  if (body.tags !== undefined) updates.tags = body.tags === null ? null : String(body.tags).trim() || null;
  if (body.modality !== undefined) updates.modality = body.modality === null ? null : String(body.modality).trim() || null;

  const updated = await db.transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.update(reportTemplatesTable)
        .set({ isDefault: false })
        .where(and(eq(reportTemplatesTable.testId, existing.testId), eq(reportTemplatesTable.isDefault, true)));
      updates.isDefault = true;
    } else if (body.isDefault === false) {
      updates.isDefault = false;
    }
    const [row] = await tx.update(reportTemplatesTable).set(updates).where(eq(reportTemplatesTable.id, id)).returning();
    return row;
  });
  res.json(updated);
});

reportTemplatesRouter.delete("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid request", details: p.error.issues });
    return;
  }
  const result = await db.delete(reportTemplatesTable).where(eq(reportTemplatesTable.id, p.data.id)).returning();
  if (result.length === 0) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json({ ok: true });
});

export default reportTemplatesRouter;
