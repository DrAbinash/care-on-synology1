import { Router } from "express";
import { db, testsTable } from "@workspace/db";
import { orderTestsTable, roomsTable, floorsTable } from "@workspace/db";
import { eq, ilike, and, sql, desc, asc, count } from "drizzle-orm";
import {
  ListTestsQueryParams,
  CreateTestBody,
  GetTestParams,
  UpdateTestParams,
  UpdateTestBody,
  DeleteTestParams,
} from "@workspace/api-zod";

export const testsRouter = Router();

testsRouter.get("/", async (req, res) => {
  const parsed = ListTestsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }
  const { search, category } = parsed.data;
  const sort = (req.query.sort as string) ?? "";

  let conditions: ReturnType<typeof eq>[] = [];
  if (search) {
    conditions.push(
      ilike(testsTable.name, `%${search}%`) as ReturnType<typeof eq>
    );
  }
  if (category) {
    conditions.push(eq(testsTable.category, category));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (sort === "popular") {
    const tests = await db
      .select({
        id: testsTable.id,
        code: testsTable.code,
        name: testsTable.name,
        category: testsTable.category,
        price: testsTable.price,
        duration: testsTable.duration,
        description: testsTable.description,
        isActive: testsTable.isActive,
        createdAt: testsTable.createdAt,
        billCount: sql<number>`count(${orderTestsTable.id})`,
      })
      .from(testsTable)
      .leftJoin(orderTestsTable, eq(orderTestsTable.testId, testsTable.id))
      .where(where)
      .groupBy(testsTable.id)
      .orderBy(desc(sql`count(${orderTestsTable.id})`), asc(testsTable.name));

    return res.json({ tests: tests.map(t => ({ ...t, price: Number(t.price) })), total: tests.length });
  }

  const tests = await db
    .select()
    .from(testsTable)
    .where(where)
    .orderBy(desc(testsTable.createdAt));

  return res.json({ tests: tests.map(t => ({ ...t, price: Number(t.price) })), total: tests.length });
});

// Sourced from req.body separately because the codegen'd CreateTestBody zod
// strips unknown keys. Falls back to safe defaults so old callers keep working.
function extractDeptRoom(body: unknown): {
  department?: string; roomNumber?: string;
  roomId?: number | null; modalityId?: number | null; floorLabel?: string;
  outsourceCost?: string | null;
} {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const out: { department?: string; roomNumber?: string; roomId?: number | null; modalityId?: number | null; floorLabel?: string; outsourceCost?: string | null } = {};
  if (typeof b.department === "string" && b.department.trim()) out.department = b.department.trim();
  if (typeof b.roomNumber === "string") out.roomNumber = b.roomNumber.trim();
  if (b.roomId !== undefined) out.roomId = b.roomId == null ? null : Number(b.roomId) || null;
  if (b.modalityId !== undefined) out.modalityId = b.modalityId == null ? null : Number(b.modalityId) || null;
  if (typeof b.floorLabel === "string") out.floorLabel = b.floorLabel.trim();
  if (b.outsourceCost !== undefined) {
    const oc = b.outsourceCost == null ? null : Number(b.outsourceCost);
    out.outsourceCost = oc != null && Number.isFinite(oc) && oc >= 0 ? String(oc) : null;
  }
  return out;
}

// When a roomId is provided, resolve the room's name and floor name so the
// legacy `roomNumber` text field and new `floorLabel` field stay in sync.
async function resolveRoomFields(roomId: number | null | undefined): Promise<{ roomNumber?: string; floorLabel?: string }> {
  if (!roomId) return {};
  const [row] = await db
    .select({ name: roomsTable.name, floorName: floorsTable.name })
    .from(roomsTable)
    .leftJoin(floorsTable, eq(floorsTable.id, roomsTable.floorId))
    .where(eq(roomsTable.id, roomId));
  if (!row) return {};
  return { roomNumber: row.name, floorLabel: row.floorName ?? "" };
}

/** Walk the error + cause chain and return true if it looks like a PG unique-violation. */
function isUniqueViolation(e: unknown): boolean {
  let node: unknown = e;
  while (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    // Postgres error code 23505 (unique_violation) exposed by pg driver
    if (n["code"] === "23505") return true;
    const msg = typeof n["message"] === "string" ? n["message"] : "";
    if (msg.includes("diagnostic_tests_code_unique") || msg.includes("duplicate key")) return true;
    node = n["cause"];
  }
  return false;
}

testsRouter.post("/", async (req, res) => {
  const parsed = CreateTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const extra = extractDeptRoom(req.body);
  const resolved = await resolveRoomFields(extra.roomId);
  try {
    const [test] = await db.insert(testsTable).values({
      ...parsed.data,
      price: String(parsed.data.price),
      isActive: parsed.data.isActive ?? true,
      testType: parsed.data.testType ?? undefined,
      outsourcedLabId: parsed.data.outsourcedLabId ?? undefined,
      ...(extra.department !== undefined ? { department: extra.department } : {}),
      ...(extra.roomId !== undefined ? { roomId: extra.roomId } : {}),
      ...(extra.modalityId !== undefined ? { modalityId: extra.modalityId } : {}),
      ...(resolved.roomNumber !== undefined ? { roomNumber: resolved.roomNumber } : extra.roomNumber !== undefined ? { roomNumber: extra.roomNumber } : {}),
      ...(resolved.floorLabel !== undefined ? { floorLabel: resolved.floorLabel } : extra.floorLabel !== undefined ? { floorLabel: extra.floorLabel } : {}),
    }).returning();
    res.status(201).json({ ...test, price: Number(test.price) });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: `Test code "${parsed.data.code}" is already in use. Please pick a different code.` });
      return;
    }
    throw e;
  }
});

testsRouter.get("/:id", async (req, res) => {
  const parsed = GetTestParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, parsed.data.id));
  if (!test) {
    res.status(404).json({ error: "Test not found" });
    return;
  }
  res.json({ ...test, price: Number(test.price) });
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Accepts an array of row objects (parsed client-side from a CSV file).
// Upserts each row by `code`: if a test with the same code exists it's
// updated, otherwise a new one is inserted. Returns per-row counts so the
// UI can show a friendly summary. Validation is intentionally lenient —
// missing optional fields default to existing or sensible values.
testsRouter.post("/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : null;
  if (!rows) {
    res.status(400).json({ error: "Request body must include `rows: []`." });
    return;
  }
  if (rows.length > 5000) {
    res.status(413).json({ error: "Too many rows in one import (max 5000)." });
    return;
  }

  let inserted = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const code = String(r.code ?? "").trim();
    const name = String(r.name ?? "").trim();
    const category = String(r.category ?? "").trim();
    const priceRaw = r.price;
    const duration = String(r.duration ?? "30 min").trim() || "30 min";

    if (!code || !name || !category) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (code, name, or category)." });
      continue;
    }
    const priceNum = Number(priceRaw);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      skipped++;
      errors.push({ row: i + 2, reason: `Invalid price: "${String(priceRaw)}"` });
      continue;
    }

    const department = (typeof r.department === "string" && r.department.trim()) || "Pathology";
    const roomNumber = typeof r.roomNumber === "string" ? r.roomNumber.trim() : "";
    const description = typeof r.description === "string" && r.description.trim() ? r.description.trim() : null;
    const isActive = typeof r.isActive === "string"
      ? !/^(false|0|no|inactive)$/i.test(r.isActive.trim())
      : (r.isActive !== false);

    const values = {
      code, name, category, duration, department, roomNumber, description, isActive,
      price: priceNum.toFixed(2),
    };

    try {
      const [existing] = await db.select({ id: testsTable.id }).from(testsTable).where(eq(testsTable.code, code));
      if (existing) {
        await db.update(testsTable).set(values).where(eq(testsTable.id, existing.id));
        updated++;
      } else {
        await db.insert(testsTable).values(values);
        inserted++;
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: (e as Error).message || "Database error" });
    }
  }

  res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

testsRouter.put("/:id", async (req, res) => {
  const paramsParsed = UpdateTestParams.safeParse({ id: Number(req.params.id) });
  const bodyParsed = UpdateTestBody.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const updateData: Record<string, unknown> = { ...bodyParsed.data };
  if (updateData.price !== undefined) {
    updateData.price = String(updateData.price);
  }
  const extra = extractDeptRoom(req.body);
  if (extra.department !== undefined) updateData.department = extra.department;
  if (extra.roomId !== undefined) updateData.roomId = extra.roomId;
  if (extra.modalityId !== undefined) updateData.modalityId = extra.modalityId;
  if (extra.outsourceCost !== undefined) updateData.outsourceCost = extra.outsourceCost;
  // When roomId changes, sync the denormalized roomNumber + floorLabel fields
  if (extra.roomId !== undefined) {
    const resolved = await resolveRoomFields(extra.roomId);
    if (resolved.roomNumber !== undefined) updateData.roomNumber = resolved.roomNumber;
    if (resolved.floorLabel !== undefined) updateData.floorLabel = resolved.floorLabel;
    // Clear floorLabel when room is unset
    if (!extra.roomId) { updateData.roomNumber = ""; updateData.floorLabel = ""; }
  } else if (extra.roomNumber !== undefined) {
    updateData.roomNumber = extra.roomNumber;
  }
  if (extra.floorLabel !== undefined && extra.roomId === undefined) updateData.floorLabel = extra.floorLabel;
  const [updated] = await db
    .update(testsTable)
    .set(updateData)
    .where(eq(testsTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Test not found" });
    return;
  }
  res.json({ ...updated, price: Number(updated.price) });
});

// ── Delete a test ──────────────────────────────────────────────────────
// Prevents deletion if the test has been used in any order. For trial-phase
// cleanup of orphaned duplicates, set ?force=true to bypass the guard.
testsRouter.delete("/:id", async (req, res) => {
  const parsed = DeleteTestParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const force = req.query.force === "true";

  // Check if test exists
  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, parsed.data.id));
  if (!test) {
    res.status(404).json({ error: "Test not found" });
    return;
  }

  // Check for order references
  const [{ refCount }] = await db
    .select({ refCount: count() })
    .from(orderTestsTable)
    .where(eq(orderTestsTable.testId, parsed.data.id));

  if (refCount > 0 && !force) {
    res.status(409).json({
      error: `Cannot delete: this test has been used in ${refCount} order(s). Set it to Inactive instead, or use force=true to delete anyway.`,
      refCount,
    });
    return;
  }

  await db.delete(testsTable).where(eq(testsTable.id, parsed.data.id));
  res.status(204).send();
});
