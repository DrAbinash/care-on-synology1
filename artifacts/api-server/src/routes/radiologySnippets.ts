import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  radiologySnippetsTable,
} from "@workspace/db/schema";
import { eq, and, or, ilike, desc, asc, sql } from "drizzle-orm";
import { requireStaffAuth } from "../middleware/requireStaffAuth";
import { z } from "zod";

export const radiologySnippetsRouter: IRouter = Router();

// ─── Zod schemas ───────────────────────────────────────────────────────────────

const snippetTypeEnum = z.enum(["quick_add", "smart_format", "favorite", "macro", "normal_template"]);

const snippetCreateSchema = z.object({
  type: snippetTypeEnum,
  label: z.string().min(1).max(200),
  shortcut: z.string().max(50).nullable().optional(),
  modality: z.string().max(50).nullable().optional(),
  bodyPart: z.string().max(100).nullable().optional(),
  testKeywords: z.string().max(500).nullable().optional(),
  titleText: z.string().max(1000).nullable().optional(),
  techniqueText: z.string().max(2000).nullable().optional(),
  findingsText: z.string().max(8000).nullable().optional(),
  impressionText: z.string().max(2000).nullable().optional(),
  adviceText: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  isGlobal: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
});

const snippetUpdateSchema = snippetCreateSchema.partial().omit({ type: true });

// ─── Middleware ────────────────────────────────────────────────────────────────

radiologySnippetsRouter.use(requireStaffAuth);

// ─── GET /api/radiology/snippets ─────────────────────────────────────────────

radiologySnippetsRouter.get("/", async (req, res) => {
  const { modality, bodyPart, type, search, global, active } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conds = [] as ReturnType<typeof eq | typeof ilike | typeof and>[];

  if (type) {
    conds.push(eq(radiologySnippetsTable.type, type));
  }
  if (modality) {
    conds.push(
      or(
        eq(radiologySnippetsTable.modality, modality),
        eq(radiologySnippetsTable.modality, "ALL"),
        ilike(radiologySnippetsTable.modality, `%${modality}%`),
      )!
    );
  }
  if (bodyPart) {
    conds.push(
      or(
        eq(radiologySnippetsTable.bodyPart, bodyPart),
        eq(radiologySnippetsTable.bodyPart, "ALL"),
        ilike(radiologySnippetsTable.bodyPart, `%${bodyPart}%`),
      )!
    );
  }
  if (active === "true" || active === "1") {
    conds.push(eq(radiologySnippetsTable.isActive, true));
  }
  if (global === "true" || global === "1") {
    conds.push(eq(radiologySnippetsTable.isGlobal, true));
  }
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    conds.push(
      or(
        ilike(radiologySnippetsTable.label, like),
        ilike(radiologySnippetsTable.findingsText, like),
        ilike(radiologySnippetsTable.impressionText, like),
        ilike(radiologySnippetsTable.shortcut, like),
        ilike(radiologySnippetsTable.testKeywords, like),
      )!
    );
  }

  // Personal + global snippets only
  const user = (req as any).staffUser;
  const userEmail = user?.email ?? user?.username ?? "";
  if (!userEmail) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  conds.push(
    or(
      eq(radiologySnippetsTable.isGlobal, true),
      eq(radiologySnippetsTable.createdByName, userEmail),
    )!
  );

  let q = db.select().from(radiologySnippetsTable).$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));
  q = q.orderBy(asc(radiologySnippetsTable.sortOrder), desc(radiologySnippetsTable.createdAt));

  const items = await q.limit(limit).offset(offset);
  const [{ total = 0 }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(radiologySnippetsTable)
    .where(conds.length > 0 ? and(...conds) : undefined);

  res.json({ items, total, limit, offset });
});

// ─── GET /api/radiology/snippets/:id ───────────────────────────────────────────

radiologySnippetsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(radiologySnippetsTable).where(eq(radiologySnippetsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Snippet not found" });
    return;
  }
  res.json(row);
});

// ─── POST /api/radiology/snippets ──────────────────────────────────────────────

radiologySnippetsRouter.post("/", async (req, res) => {
  const parsed = snippetCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const user = (req as any).staffUser;
  const userEmail = user?.email ?? user?.username ?? "";

  const [row] = await db.insert(radiologySnippetsTable).values({
    ...parsed.data,
    createdByName: userEmail,
  }).returning();

  res.status(201).json(row);
});

// ─── PUT /api/radiology/snippets/:id ─────────────────────────────────────────

radiologySnippetsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = snippetUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const user = (req as any).staffUser;
  const userEmail = user?.email ?? user?.username ?? "";

  // Only allow update if global or owned by user
  const [existing] = await db.select().from(radiologySnippetsTable).where(eq(radiologySnippetsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Snippet not found" });
    return;
  }

  const canEdit = existing.isGlobal || existing.createdByName === userEmail;
  if (!canEdit) {
    res.status(403).json({ error: "Not authorized to edit this snippet" });
    return;
  }

  const [row] = await db
    .update(radiologySnippetsTable)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(radiologySnippetsTable.id, id))
    .returning();

  res.json(row);
});

// ─── DELETE /api/radiology/snippets/:id ──────────────────────────────────────

radiologySnippetsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const user = (req as any).staffUser;
  const userEmail = user?.email ?? user?.username ?? "";

  const [existing] = await db.select().from(radiologySnippetsTable).where(eq(radiologySnippetsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Snippet not found" });
    return;
  }

  const canDelete = existing.isGlobal || existing.createdByName === userEmail;
  if (!canDelete) {
    res.status(403).json({ error: "Not authorized to delete this snippet" });
    return;
  }

  // Soft delete: deactivate
  await db
    .update(radiologySnippetsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(radiologySnippetsTable.id, id));

  res.json({ ok: true, id });
});

// ─── GET /api/radiology/snippets/seed/status ─────────────────────────────────

radiologySnippetsRouter.get("/seed/status", async (_req, res) => {
  const [{ count = 0 }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(radiologySnippetsTable)
    .where(eq(radiologySnippetsTable.isGlobal, true));
  res.json({ seeded: count > 0, count });
});
