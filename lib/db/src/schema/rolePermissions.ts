import { pgTable, serial, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Granular role-permission matrix.
 * Each row grants a specific permission bit for a (role, module) pair.
 *
 * Roles: super_admin | admin | reception | billing | radiology_typist |
 *        radiologist | lab_technician | accountant
 *
 * Modules: dashboard | patients | billing | payments | reports | radiology |
 *           lab | doctors | commission | accounting | settings | backups | audit
 */
export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    role: text("role").notNull(),
    module: text("module").notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    canPrint: boolean("can_print").notNull().default(false),
    canReprint: boolean("can_reprint").notNull().default(false),
    canRefund: boolean("can_refund").notNull().default(false),
    canExport: boolean("can_export").notNull().default(false),
    canApprove: boolean("can_approve").notNull().default(false),
    canFinalize: boolean("can_finalize").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("role_module_unique_idx").on(table.role, table.module),
  ],
);

export const insertRolePermissionSchema = createInsertSchema(rolePermissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type RolePermission = typeof rolePermissionsTable.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;

// Canonical list of modules for the permission editor UI
export const PERMISSION_MODULES = [
  "dashboard",
  "patients",
  "appointments",
  "queue",
  "billing",
  "payments",
  "orders",
  "tests",
  "reports",
  "radiology",
  "lab",
  "doctors",
  "commission",
  "accounting",
  "inventory",
  "expenses",
  "form_f",
  "settings",
  "backups",
  "audit",
] as const;

// Canonical list of roles
export const ERP_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "receptionist",
  "billing",
  "radiology_typist",
  "radiologist",
  "lab",
  "accountant",
] as const;
