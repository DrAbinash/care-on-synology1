import { Router } from "express";
import { db } from "@workspace/db";
import { floorsTable, roomsTable, modalitiesTable, testsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// ── Floors ────────────────────────────────────────────────────────────────────
export const floorsRouter = Router();

floorsRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(floorsTable).orderBy(floorsTable.sortOrder, floorsTable.name);
  const roomCounts = await db
    .select({ floorId: roomsTable.floorId, c: sql<number>`count(*)::int` })
    .from(roomsTable)
    .groupBy(roomsTable.floorId);
  const rc = new Map(roomCounts.map(r => [r.floorId, r.c]));
  res.json(rows.map(r => ({ ...r, roomCount: rc.get(r.id) ?? 0 })));
});

floorsRouter.post("/", async (req, res) => {
  const { name, code = "", description, sortOrder = 0 } = req.body as {
    name?: string; code?: string; description?: string; sortOrder?: number;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [row] = await db.insert(floorsTable).values({
      name: name.trim(), code: (code ?? "").trim(), description: description ?? null, sortOrder: Number(sortOrder) || 0,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A floor with that name already exists" : m });
  }
});

floorsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, code, description, isActive, sortOrder } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof code === "string") updates.code = code.trim();
  if (description !== undefined) updates.description = typeof description === "string" ? description.trim() || null : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder) || 0;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    const [row] = await db.update(floorsTable).set(updates).where(eq(floorsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Floor not found" }); return; }
    res.json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A floor with that name already exists" : m });
  }
});

floorsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(floorsTable).where(eq(floorsTable.id, id));
  res.json({ success: true });
});

// ── Rooms ─────────────────────────────────────────────────────────────────────
export const roomsRouter = Router();

roomsRouter.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: roomsTable.id,
      name: roomsTable.name,
      code: roomsTable.code,
      floorId: roomsTable.floorId,
      floorName: floorsTable.name,
      description: roomsTable.description,
      isActive: roomsTable.isActive,
      sortOrder: roomsTable.sortOrder,
      createdAt: roomsTable.createdAt,
    })
    .from(roomsTable)
    .leftJoin(floorsTable, eq(floorsTable.id, roomsTable.floorId))
    .orderBy(roomsTable.sortOrder, roomsTable.name);

  const testCounts = await db
    .select({ roomId: testsTable.roomId, c: sql<number>`count(*)::int` })
    .from(testsTable)
    .where(sql`${testsTable.roomId} IS NOT NULL`)
    .groupBy(testsTable.roomId);
  const tc = new Map(testCounts.map(r => [r.roomId, r.c]));
  res.json(rows.map(r => ({ ...r, testCount: tc.get(r.id) ?? 0 })));
});

roomsRouter.post("/", async (req, res) => {
  const { name, code = "", floorId, description, sortOrder = 0 } = req.body as {
    name?: string; code?: string; floorId?: number | null; description?: string; sortOrder?: number;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [row] = await db.insert(roomsTable).values({
      name: name.trim(), code: (code ?? "").trim(),
      floorId: floorId ? Number(floorId) : null,
      description: description ?? null, sortOrder: Number(sortOrder) || 0,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A room with that name already exists" : m });
  }
});

roomsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, code, floorId, description, isActive, sortOrder } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof code === "string") updates.code = code.trim();
  if (floorId !== undefined) updates.floorId = floorId ? Number(floorId) : null;
  if (description !== undefined) updates.description = typeof description === "string" ? description.trim() || null : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder) || 0;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    const [row] = await db.update(roomsTable).set(updates).where(eq(roomsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Room not found" }); return; }
    res.json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A room with that name already exists" : m });
  }
});

roomsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(roomsTable).where(eq(roomsTable.id, id));
  res.json({ success: true });
});

// ── Modalities ────────────────────────────────────────────────────────────────
export const modalitiesRouter = Router();

modalitiesRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(modalitiesTable).orderBy(modalitiesTable.sortOrder, modalitiesTable.name);
  const testCounts = await db
    .select({ modalityId: testsTable.modalityId, c: sql<number>`count(*)::int` })
    .from(testsTable)
    .where(sql`${testsTable.modalityId} IS NOT NULL`)
    .groupBy(testsTable.modalityId);
  const tc = new Map(testCounts.map(r => [r.modalityId, r.c]));
  res.json(rows.map(r => ({ ...r, testCount: tc.get(r.id) ?? 0 })));
});

modalitiesRouter.post("/", async (req, res) => {
  const { name, code = "", description, sortOrder = 0 } = req.body as {
    name?: string; code?: string; description?: string; sortOrder?: number;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const [row] = await db.insert(modalitiesTable).values({
      name: name.trim(), code: (code ?? "").trim(), description: description ?? null, sortOrder: Number(sortOrder) || 0,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A modality with that name already exists" : m });
  }
});

modalitiesRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, code, description, isActive, sortOrder } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof code === "string") updates.code = code.trim();
  if (description !== undefined) updates.description = typeof description === "string" ? description.trim() || null : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (sortOrder !== undefined) updates.sortOrder = Number(sortOrder) || 0;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    const [row] = await db.update(modalitiesTable).set(updates).where(eq(modalitiesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Modality not found" }); return; }
    res.json(row);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Failed";
    res.status(m.includes("unique") || m.includes("duplicate") ? 409 : 500).json({ error: m.includes("unique") || m.includes("duplicate") ? "A modality with that name already exists" : m });
  }
});

modalitiesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(modalitiesTable).where(eq(modalitiesTable.id, id));
  res.json({ success: true });
});
