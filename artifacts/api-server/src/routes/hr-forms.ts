import { Router } from "express";
import { db } from "@workspace/db";
import {
  staffTable,
  hrRejoiningFormsTable,
  hrRejoiningFormCounterTable,
} from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

const router = Router();

async function generateFormNumber(): Promise<string> {
  const [counter] = await db
    .insert(hrRejoiningFormCounterTable)
    .values({ id: 1, counter: 1 })
    .onConflictDoUpdate({
      target: hrRejoiningFormCounterTable.id,
      set: { counter: sql`${hrRejoiningFormCounterTable.counter} + 1` },
    })
    .returning();
  const yyyy = new Date().getFullYear();
  return `HR-${yyyy}-${String(counter.counter).padStart(4, "0")}`;
}

function toFormJson<T extends Record<string, unknown>>(row: T): T {
  return { ...row, fixedSalary: Number((row as { fixedSalary?: unknown }).fixedSalary ?? 0) } as T;
}

const ALLOWED_FIELDS = [
  "photoDataUrl", "photoStorageKey", "employeeName", "fatherSpouseName", "dateOfBirth", "gender",
  "bloodGroup", "qualification", "aadhaarNumber", "panNumber", "address",
  "mobile", "alternateMobile", "email", "designation", "department",
  "joiningDate", "rejoiningDate",
  "familyDetails",
  "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone",
  "bankAccountHolder", "bankName", "bankAccountNumber", "bankIfsc", "bankBranch",
  "salaryStructure",
  "incentiveAcknowledged", "deductionAcknowledged",
  "shiftType", "reportingTime", "dutyHours",
  "confidentialityAcknowledged",
  "noticePeriodDays", "noticePolicyAcknowledged",
  "documentChecklist",
  "employeeDeclarationDate", "employeeSignatureDataUrl",
  "remarks",
] as const;

function pickFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) if (k in body) out[k] = body[k];
  if ("salaryStructure" in body) {
    const s = body.salaryStructure as { fixed?: number } | null | undefined;
    out.fixedSalary = String(Number(s?.fixed ?? 0));
  }
  return out;
}

// ── List all HR forms (with optional staffId filter) ─────────────────────────
router.get("/", async (req, res) => {
  const staffIdQ = req.query.staffId ? Number(req.query.staffId) : undefined;
  const status = (req.query.status as string | undefined) ?? undefined;
  const baseRows = staffIdQ
    ? await db
        .select()
        .from(hrRejoiningFormsTable)
        .where(eq(hrRejoiningFormsTable.staffId, staffIdQ))
        .orderBy(desc(hrRejoiningFormsTable.createdAt))
    : await db.select().from(hrRejoiningFormsTable).orderBy(desc(hrRejoiningFormsTable.createdAt));

  const rows = status ? baseRows.filter((r) => r.managementStatus === status) : baseRows;
  return res.json(rows.map((r) => toFormJson(r as Record<string, unknown>)));
});

// Staff-scoped list — used from the Staff detail dialog to show all HR forms
// for a single employee. Mounted at /api/staff/:staffId/hr-forms (see index.ts).
export const staffScopedHrFormsHandler = async (req: import("express").Request, res: import("express").Response) => {
  const staffId = Number(req.params.staffId);
  if (!staffId) return res.status(400).json({ error: "staffId required" });
  const rows = await db
    .select()
    .from(hrRejoiningFormsTable)
    .where(eq(hrRejoiningFormsTable.staffId, staffId))
    .orderBy(desc(hrRejoiningFormsTable.createdAt));
  return res.json(rows.map((r) => toFormJson(r as Record<string, unknown>)));
};

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [row] = await db.select().from(hrRejoiningFormsTable).where(eq(hrRejoiningFormsTable.id, id));
  if (!row) return res.status(404).json({ error: "HR form not found" });
  return res.json(toFormJson(row as Record<string, unknown>));
});

// ── Create form (pre-filled from staff record on the client) ─────────────────
router.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const staffId = Number(body.staffId ?? 0);
  if (!staffId) return res.status(400).json({ error: "staffId is required" });

  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, staffId));
  if (!staff) return res.status(404).json({ error: "Staff member not found" });

  const employeeName = String(body.employeeName ?? `${staff.firstName} ${staff.lastName}`).trim();
  if (!employeeName) return res.status(400).json({ error: "employeeName is required" });

  const formNumber = await generateFormNumber();
  const fields = pickFields(body);

  const [row] = await db
    .insert(hrRejoiningFormsTable)
    .values({
      staffId,
      formNumber,
      employeeName,
      ...fields,
    } as typeof hrRejoiningFormsTable.$inferInsert)
    .returning();
  return res.status(201).json(toFormJson(row as Record<string, unknown>));
});

// ── Update form (locked once approved) ───────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(hrRejoiningFormsTable).where(eq(hrRejoiningFormsTable.id, id));
  if (!existing) return res.status(404).json({ error: "HR form not found" });
  if (existing.managementStatus === "approved") {
    return res.status(409).json({ error: "Approved forms cannot be edited. Create a new form instead." });
  }
  const body = req.body as Record<string, unknown>;
  const fields = pickFields(body);
  const [row] = await db.update(hrRejoiningFormsTable).set(fields).where(eq(hrRejoiningFormsTable.id, id)).returning();
  return res.json(toFormJson(row as Record<string, unknown>));
});

// ── Approve form: write fixedSalary back to staff.baseSalary in a tx ─────────
router.post("/:id/approve", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const session = req.staffSession;
  if (!session) return res.status(401).json({ error: "Staff authentication required" });

  try {
    const result = await db.transaction(async (tx) => {
      // Row-lock the form so two concurrent /approve calls cannot both pass
      // the "still pending" check and double-apply the salary update.
      const [form] = await tx
        .select()
        .from(hrRejoiningFormsTable)
        .where(eq(hrRejoiningFormsTable.id, id))
        .for("update");
      if (!form) throw new Error("HR form not found");
      if (form.managementStatus === "approved") throw new Error("Form already approved");

      const fixed = Number(form.fixedSalary ?? 0);
      const [updatedForm] = await tx
        .update(hrRejoiningFormsTable)
        .set({
          managementStatus: "approved",
          approvedAt: new Date(),
          approvedByUserId: session.subjectId,
          approvedByName: session.subjectName,
        })
        .where(eq(hrRejoiningFormsTable.id, id))
        .returning();

      if (fixed > 0) {
        await tx
          .update(staffTable)
          .set({ baseSalary: String(fixed) })
          .where(eq(staffTable.id, form.staffId));
      }
      return updatedForm;
    });
    return res.json(toFormJson(result as Record<string, unknown>));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Approve failed";
    const code = msg.includes("not found") ? 404 : msg.includes("already approved") ? 409 : 500;
    return res.status(code).json({ error: msg });
  }
});

// ── Reject form ──────────────────────────────────────────────────────────────
router.post("/:id/reject", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  const session = req.staffSession;
  if (!session) return res.status(401).json({ error: "Staff authentication required" });
  const [form] = await db.select().from(hrRejoiningFormsTable).where(eq(hrRejoiningFormsTable.id, id));
  if (!form) return res.status(404).json({ error: "HR form not found" });
  if (form.managementStatus === "approved") {
    return res.status(409).json({ error: "Approved forms cannot be rejected" });
  }
  const [row] = await db
    .update(hrRejoiningFormsTable)
    .set({
      managementStatus: "rejected",
      approvedAt: new Date(),
      approvedByUserId: session.subjectId,
      approvedByName: session.subjectName,
    })
    .where(eq(hrRejoiningFormsTable.id, id))
    .returning();
  return res.json(toFormJson(row as Record<string, unknown>));
});

// ── Delete (only when not approved) ──────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid id" });
  const [form] = await db.select().from(hrRejoiningFormsTable).where(eq(hrRejoiningFormsTable.id, id));
  if (!form) return res.status(404).json({ error: "HR form not found" });
  if (form.managementStatus === "approved") {
    return res.status(409).json({ error: "Approved forms cannot be deleted" });
  }
  await db.delete(hrRejoiningFormsTable).where(eq(hrRejoiningFormsTable.id, id));
  return res.json({ ok: true });
});

export default router;
