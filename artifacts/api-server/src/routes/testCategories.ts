import { Router } from "express";
import { db, testCategoriesTable, testsTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";

const router = Router();

const DEFAULT_CATEGORIES = [
  "Hematology",
  "Biochemistry",
  "Serology",
  "Pathology",
  "Radiology",
  "Cardiology",
  "Endocrinology",
  "Microbiology",
  "Immunology",
  "Other",
];

async function ensureSeeded() {
  const rows = await db.select().from(testCategoriesTable).limit(1);
  if (rows.length === 0) {
    await db
      .insert(testCategoriesTable)
      .values(DEFAULT_CATEGORIES.map((name) => ({ name, isActive: true })))
      .onConflictDoNothing();
  }
}

router.get("/", async (_req, res) => {
  await ensureSeeded();
  const rows = await db
    .select({
      id: testCategoriesTable.id,
      name: testCategoriesTable.name,
      isActive: testCategoriesTable.isActive,
      createdAt: testCategoriesTable.createdAt,
      testCount: sql<number>`count(${testsTable.id})::int`,
    })
    .from(testCategoriesTable)
    .leftJoin(testsTable, eq(testsTable.category, testCategoriesTable.name))
    .groupBy(testCategoriesTable.id)
    .orderBy(asc(testCategoriesTable.name));
  res.json(rows);
});

router.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const [row] = await db
      .insert(testCategoriesTable)
      .values({ name, isActive: true })
      .returning();
    res.json(row);
  } catch {
    res.status(409).json({ error: "Category already exists" });
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const update: { name?: string; isActive?: boolean } = {};
  if (typeof req.body?.name === "string") {
    const trimmed = req.body.name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    update.name = trimmed;
  }
  if (typeof req.body?.isActive === "boolean") update.isActive = req.body.isActive;

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "no fields to update" });
    return;
  }

  // If renaming, cascade the change to any tests already using the old name
  // so the existing test rows keep matching the renamed category.
  let oldName: string | undefined;
  if (update.name) {
    const [existing] = await db
      .select({ name: testCategoriesTable.name })
      .from(testCategoriesTable)
      .where(eq(testCategoriesTable.id, id));
    oldName = existing?.name;
  }

  try {
    const [row] = await db
      .update(testCategoriesTable)
      .set(update)
      .where(eq(testCategoriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    if (update.name && oldName && oldName !== update.name) {
      await db
        .update(testsTable)
        .set({ category: update.name })
        .where(eq(testsTable.category, oldName));
    }
    res.json(row);
  } catch {
    res.status(409).json({ error: "Another category already has that name" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [existing] = await db
    .select({ name: testCategoriesTable.name })
    .from(testCategoriesTable)
    .where(eq(testCategoriesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  // Refuse to delete a category that is still in use — protects the
  // tests table from orphaned category strings.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(testsTable)
    .where(eq(testsTable.category, existing.name));
  if (count > 0) {
    res.status(409).json({
      error: `Cannot delete: ${count} test${count === 1 ? "" : "s"} still use this category. Reassign them first or mark the category inactive instead.`,
    });
    return;
  }
  await db.delete(testCategoriesTable).where(eq(testCategoriesTable.id, id));
  res.json({ ok: true });
});

export default router;
