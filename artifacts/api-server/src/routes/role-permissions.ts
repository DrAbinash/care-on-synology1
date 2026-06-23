import { Router } from "express";
import { z } from "zod/v4";
import { db, rolePermissionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { requireSuperAdminUsb } from "../middleware/requireSuperAdminUsb";
import { logger } from "../lib/logger";
import { PERMISSION_MODULES, ERP_ROLES } from "@workspace/db/schema";

const router = Router();

router.use(requireSuperAdminUsb);
router.use(requireSuperAdmin);

// GET /api/admin/role-permissions — list all permission rows
router.get("/", async (_req, res) => {
  const rows = await db.select().from(rolePermissionsTable);
  // Group by role for the UI
  const grouped: Record<string, typeof rows> = {};
  for (const r of ERP_ROLES) grouped[r] = [];
  for (const row of rows) {
    if (!grouped[row.role]) grouped[row.role] = [];
    grouped[row.role].push(row);
  }
  res.json({ roles: ERP_ROLES, modules: PERMISSION_MODULES, permissions: grouped });
});

// PUT /api/admin/role-permissions — single-row upsert (backward-compat)
const UpsertBody = z.object({
  role: z.string().min(1),
  module: z.string().min(1),
  canView: z.boolean().default(false),
  canCreate: z.boolean().default(false),
  canEdit: z.boolean().default(false),
  canDelete: z.boolean().default(false),
  canPrint: z.boolean().default(false),
  canReprint: z.boolean().default(false),
  canRefund: z.boolean().default(false),
  canExport: z.boolean().default(false),
  canApprove: z.boolean().default(false),
  canFinalize: z.boolean().default(false),
});

router.put("/", async (req, res) => {
  const body = UpsertBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.format() });
    return;
  }
  const d = body.data;

  try {
    const existing = await db
      .select()
      .from(rolePermissionsTable)
      .where(and(eq(rolePermissionsTable.role, d.role), eq(rolePermissionsTable.module, d.module)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(rolePermissionsTable)
        .set({
          canView: d.canView,
          canCreate: d.canCreate,
          canEdit: d.canEdit,
          canDelete: d.canDelete,
          canPrint: d.canPrint,
          canReprint: d.canReprint,
          canRefund: d.canRefund,
          canExport: d.canExport,
          canApprove: d.canApprove,
          canFinalize: d.canFinalize,
          updatedAt: new Date(),
        })
        .where(eq(rolePermissionsTable.id, existing[0].id));
      res.json({ updated: true, id: existing[0].id });
    } else {
      const [created] = await db
        .insert(rolePermissionsTable)
        .values({
          role: d.role,
          module: d.module,
          canView: d.canView,
          canCreate: d.canCreate,
          canEdit: d.canEdit,
          canDelete: d.canDelete,
          canPrint: d.canPrint,
          canReprint: d.canReprint,
          canRefund: d.canRefund,
          canExport: d.canExport,
          canApprove: d.canApprove,
          canFinalize: d.canFinalize,
        })
        .returning();
      res.status(201).json({ created: true, id: created.id });
    }
  } catch (err) {
    logger.error({ err }, "Role permission upsert failed");
    res.status(500).json({ error: "Failed to save role permission" });
  }
});

// POST /api/admin/role-permissions — batch update from super-admin UI
// Body: { updates: [{ role, module, permission, value }] }
// permission key maps to canView, canCreate, canEdit, canDelete, canPrint,
// canReprint, canRefund, canExport, canApprove, canFinalize.
const BatchUpdateBody = z.object({
  updates: z.array(z.object({
    role: z.string().min(1),
    module: z.string().min(1),
    permission: z.string().min(1),
    value: z.boolean(),
  })),
});

const COL_MAP: Record<string, keyof typeof rolePermissionsTable> = {
  view: "canView",
  create: "canCreate",
  edit: "canEdit",
  delete: "canDelete",
  print: "canPrint",
  reprint: "canReprint",
  refund: "canRefund",
  export: "canExport",
  approve: "canApprove",
  finalize: "canFinalize",
};

router.post("/", async (req, res) => {
  const parsed = BatchUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
    return;
  }

  const { updates } = parsed.data;
  if (updates.length === 0) {
    res.json({ saved: 0 });
    return;
  }

  try {
    let saved = 0;
    for (const u of updates) {
      const col = COL_MAP[u.permission];
      if (!col) continue;

      const existing = await db
        .select({ id: rolePermissionsTable.id })
        .from(rolePermissionsTable)
        .where(and(eq(rolePermissionsTable.role, u.role), eq(rolePermissionsTable.module, u.module)))
        .limit(1);

      if (existing[0]) {
        await db
          .update(rolePermissionsTable)
          .set({ [col]: u.value, updatedAt: new Date() } as never)
          .where(eq(rolePermissionsTable.id, existing[0].id));
      } else {
        const defaults: Record<string, boolean> = {
          canView: false, canCreate: false, canEdit: false, canDelete: false,
          canPrint: false, canReprint: false, canRefund: false, canExport: false,
          canApprove: false, canFinalize: false,
        };
        defaults[u.permission] = u.value;
        await db.insert(rolePermissionsTable).values({
          role: u.role,
          module: u.module,
          canView: defaults.canView,
          canCreate: defaults.canCreate,
          canEdit: defaults.canEdit,
          canDelete: defaults.canDelete,
          canPrint: defaults.canPrint,
          canReprint: defaults.canReprint,
          canRefund: defaults.canRefund,
          canExport: defaults.canExport,
          canApprove: defaults.canApprove,
          canFinalize: defaults.canFinalize,
        });
      }
      saved++;
    }
    res.json({ saved });
  } catch (err) {
    logger.error({ err }, "Role permission batch save failed");
    res.status(500).json({ error: "Failed to save role permissions" });
  }
});

// POST /api/admin/role-permissions/seed — bootstrap default permissions
router.post("/seed", async (_req, res) => {
  try {
    // Super admin = all permissions
    for (const mod of PERMISSION_MODULES) {
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "super_admin",
          module: mod,
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canPrint: true,
          canReprint: true,
          canRefund: true,
          canExport: true,
          canApprove: true,
          canFinalize: true,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Admin = everything except backups and audit
    for (const mod of PERMISSION_MODULES) {
      const isRestricted = mod === "backups" || mod === "audit";
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "admin",
          module: mod,
          canView: true,
          canCreate: !isRestricted,
          canEdit: !isRestricted,
          canDelete: !isRestricted,
          canPrint: true,
          canReprint: true,
          canRefund: true,
          canExport: true,
          canApprove: true,
          canFinalize: true,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Manager — everything except backups, settings, audit
    for (const mod of PERMISSION_MODULES) {
      const isRestricted = mod === "backups" || mod === "audit" || mod === "settings";
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "manager",
          module: mod,
          canView: !isRestricted,
          canCreate: !isRestricted,
          canEdit: !isRestricted,
          canDelete: !isRestricted,
          canPrint: true,
          canReprint: true,
          canRefund: true,
          canExport: true,
          canApprove: true,
          canFinalize: true,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Receptionist — patients, appointments, billing (view), payments, queue, dashboard
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        patients: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        appointments: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        queue: { canView: true, canCreate: true, canEdit: false, canPrint: true },
        billing: { canView: true, canCreate: false, canEdit: false, canPrint: true },
        payments: { canView: true, canCreate: true, canEdit: false, canPrint: true },
        dashboard: { canView: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "receptionist",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: false,
          canRefund: false,
          canExport: false,
          canApprove: false,
          canFinalize: false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Billing — billing, payments, orders, reports (view), dashboard
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        billing: { canView: true, canCreate: true, canEdit: true, canPrint: true, canReprint: true, canRefund: true },
        payments: { canView: true, canCreate: true, canEdit: true, canPrint: true, canReprint: true },
        orders: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        reports: { canView: true, canPrint: true, canExport: true },
        dashboard: { canView: true },
        queue: { canView: true, canCreate: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "billing",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: m.canReprint ?? false,
          canRefund: m.canRefund ?? false,
          canExport: m.canExport ?? false,
          canApprove: false,
          canFinalize: false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Radiology typist — radiology, reports
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        radiology: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        reports: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "radiology_typist",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: false,
          canRefund: false,
          canExport: m.canExport ?? false,
          canApprove: false,
          canFinalize: false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Radiologist — radiology, reports, doctors (view)
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        radiology: { canView: true, canCreate: true, canEdit: true, canPrint: true, canApprove: true, canFinalize: true },
        reports: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true, canApprove: true, canFinalize: true },
        doctors: { canView: true, canPrint: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "radiologist",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: false,
          canRefund: false,
          canExport: m.canExport ?? false,
          canApprove: m.canApprove ?? false,
          canFinalize: m.canFinalize ?? false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Lab — lab, reports, tests
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        lab: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        tests: { canView: true, canPrint: true },
        reports: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true },
        samples: { canView: true, canCreate: true, canEdit: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "lab",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: false,
          canRefund: false,
          canExport: m.canExport ?? false,
          canApprove: false,
          canFinalize: false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    // Accountant — accounting, banking, reports, expenses, commission
    for (const mod of PERMISSION_MODULES) {
      const perms: Record<string, Partial<Record<string, boolean>>> = {
        accounting: { canView: true, canCreate: true, canEdit: true, canPrint: true, canExport: true },
        banking: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        reports: { canView: true, canPrint: true, canExport: true },
        expenses: { canView: true, canCreate: true, canEdit: true },
        commission: { canView: true, canCreate: true, canEdit: true, canPrint: true },
        dashboard: { canView: true },
      };
      const m = perms[mod] ?? {};
      await db
        .insert(rolePermissionsTable)
        .values({
          role: "accountant",
          module: mod,
          canView: m.canView ?? false,
          canCreate: m.canCreate ?? false,
          canEdit: m.canEdit ?? false,
          canDelete: false,
          canPrint: m.canPrint ?? false,
          canReprint: false,
          canRefund: false,
          canExport: m.canExport ?? false,
          canApprove: false,
          canFinalize: false,
        })
        .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.module] });
    }

    res.json({ seeded: true });
  } catch (err) {
    logger.error({ err }, "Role permission seed failed");
    res.status(500).json({ error: "Failed to seed role permissions" });
  }
});

export { router as rolePermissionsRouter };
