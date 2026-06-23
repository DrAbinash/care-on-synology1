import { Router } from "express";
import { db } from "@workspace/db";
import { departmentsTable, testsTable, staffTable, machinesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  CreateDepartmentBody,
  UpdateDepartmentParams,
  UpdateDepartmentBody,
  DeleteDepartmentParams,
} from "@workspace/api-zod";

export const departmentsRouter = Router();

departmentsRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
  // Count usage in tests, staff, machines
  const [testCounts, staffCounts, machineCounts] = await Promise.all([
    db.select({ name: testsTable.department, c: sql<number>`count(*)::int` }).from(testsTable).groupBy(testsTable.department),
    db.select({ name: staffTable.department, c: sql<number>`count(*)::int` }).from(staffTable).groupBy(staffTable.department),
    db.select({ name: machinesTable.department, c: sql<number>`count(*)::int` }).from(machinesTable).groupBy(machinesTable.department),
  ]);
  const tCount = new Map(testCounts.map(r => [r.name, r.c]));
  const sCount = new Map(staffCounts.map(r => [r.name, r.c]));
  const mCount = new Map(machineCounts.map(r => [r.name, r.c]));
  res.json(rows.map(r => ({ ...r, testCount: tCount.get(r.name) || 0, staffCount: sCount.get(r.name) || 0, machineCount: mCount.get(r.name) || 0 })));
});

departmentsRouter.post("/", async (req, res) => {
  const bodyParsed = CreateDepartmentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const body = bodyParsed.data;
  const name = body.name.trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const [row] = await db.insert(departmentsTable).values({
      name,
      code: typeof body.code === "string" ? body.code.trim() || null : null,
      description: body.description ?? null,
      headOfDepartment: body.headOfDepartment ?? null,
      contactPhone: body.contactPhone ?? null,
      contactEmail: body.contactEmail ?? null,
      isActive: body.isActive !== false,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A department with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

departmentsRouter.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateDepartmentParams.safeParse(req.params);
  const bodyParsed = UpdateDepartmentBody.safeParse(req.body);
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
  const id = paramsParsed.data.id;
  const body = bodyParsed.data;
  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const k of ["name", "code", "description", "headOfDepartment", "contactPhone", "contactEmail"] as const) {
    if (body[k] !== undefined) {
      const v = body[k];
      updates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }
  if (body.isActive !== undefined) updates.isActive = !!body.isActive;

  try {
    const [row] = await db.update(departmentsTable).set(updates).where(eq(departmentsTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A department with that name already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

departmentsRouter.delete("/:id", async (req, res) => {
  const paramsParsed = DeleteDepartmentParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const id = paramsParsed.data.id;
  const [existing] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Department not found" });
    return;
  }
  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  res.json({ success: true });
});
