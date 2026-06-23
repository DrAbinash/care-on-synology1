import { Router } from "express";
import { db } from "@workspace/db";
import { branchesTable } from "@workspace/db/schema";
import { eq, ne } from "drizzle-orm";
import {
  GetBranchParams,
  CreateBranchBody,
  UpdateBranchParams,
  UpdateBranchBody,
  DeleteBranchParams,
} from "@workspace/api-zod";

export const branchesRouter = Router();

branchesRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(branchesTable).orderBy(branchesTable.name);
  res.json(rows);
});

branchesRouter.get("/:id", async (req, res) => {
  const paramsParsed = GetBranchParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const [row] = await db.select().from(branchesTable).where(eq(branchesTable.id, paramsParsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  res.json(row);
});

branchesRouter.post("/", async (req, res) => {
  const bodyParsed = CreateBranchBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid request", details: bodyParsed.error.issues });
    return;
  }
  const body = bodyParsed.data;
  const code = body.code.trim();
  const name = body.name.trim();
  if (!code || !name) {
    res.status(400).json({ error: "code and name are required" });
    return;
  }

  const wantsMain = body.isMain === true;

  try {
    const row = await db.transaction(async (tx) => {
      if (wantsMain) {
        await tx.update(branchesTable).set({ isMain: false }).where(eq(branchesTable.isMain, true));
      }
      const [inserted] = await tx.insert(branchesTable).values({
        code,
        name,
        address: body.address || null,
        city: body.city || null,
        state: body.state || null,
        pincode: body.pincode || null,
        phone: body.phone || null,
        email: body.email || null,
        gstin: body.gstin || null,
        manager: body.manager || null,
        isMain: wantsMain,
        isActive: body.isActive !== false,
        notes: body.notes || null,
      }).returning();
      return inserted;
    });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    if (msg.includes("branches_one_main_uq")) {
      res.status(409).json({ error: "Another branch is already marked as main" });
      return;
    }
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A branch with that code already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

branchesRouter.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateBranchParams.safeParse(req.params);
  const bodyParsed = UpdateBranchBody.safeParse(req.body);
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
  const [existing] = await db.select().from(branchesTable).where(eq(branchesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const k of ["code", "name", "address", "city", "state", "pincode", "phone", "email", "gstin", "manager", "notes"] as const) {
    if (body[k] !== undefined) {
      const v = body[k];
      updates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }
  if (body.isActive !== undefined) updates.isActive = !!body.isActive;
  const wantsMainChange = body.isMain !== undefined;
  const wantsMain = wantsMainChange ? !!body.isMain : existing.isMain;
  if (wantsMainChange) updates.isMain = wantsMain;

  try {
    const row = await db.transaction(async (tx) => {
      // If we're setting this branch as main, atomically unset every other main branch first.
      if (wantsMainChange && wantsMain) {
        await tx.update(branchesTable).set({ isMain: false }).where(ne(branchesTable.id, id));
      }
      const [updated] = await tx.update(branchesTable).set(updates).where(eq(branchesTable.id, id)).returning();
      return updated;
    });
    res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    if (msg.includes("branches_one_main_uq")) {
      res.status(409).json({ error: "Another branch is already marked as main" });
      return;
    }
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A branch with that code already exists" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

branchesRouter.delete("/:id", async (req, res) => {
  const paramsParsed = DeleteBranchParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid request", details: paramsParsed.error.issues });
    return;
  }
  const id = paramsParsed.data.id;
  const [existing] = await db.select().from(branchesTable).where(eq(branchesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  await db.delete(branchesTable).where(eq(branchesTable.id, id));
  res.json({ success: true });
});
