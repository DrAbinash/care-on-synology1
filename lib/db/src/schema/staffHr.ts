import {
  pgTable,
  serial,
  integer,
  text,
  date,
  boolean,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffTable } from "./staff";
import { usersTable } from "./users";
import { departmentsTable } from "./departments";

/**
 * Staff / HR foundation tables — Phase 1 of the CARE Staff, Attendance,
 * Performance & Recognition module.
 *
 * DESIGN NOTES
 *   - These are ADDITIVE, NON-FINANCIAL foundation tables. They introduce no
 *     salary, advance, payroll or ledger behaviour and are not wired into any
 *     financial path. Payroll/salary/commission remain under the Financial
 *     Freeze (see FINANCIAL_FREEZE_RULEBOOK.md / ACCOUNTING_PROTECTED_FILES.md)
 *     and are untouched by this module.
 *   - HR records are legal/quasi-financial records. Per
 *     docs/archive/DATABASE_ARCHITECTURE_AUDIT.md, the existing staff_* child
 *     tables use ON DELETE CASCADE, which the audit flags as a risk ("HR
 *     records ... must never be silently deleted"). NEW tables here therefore
 *     use ON DELETE RESTRICT for the owning staff reference and SET NULL for
 *     the actor (users) reference, so historical HR data can never be silently
 *     removed when a staff row is (mis)deleted.
 *   - The matching production DDL lives in migrations/staff_hr_foundation.sql
 *     (hand-written, idempotent), mirroring the existing staff_quick_doctors
 *     precedent (Drizzle schema file + idempotent migrations/*.sql, no
 *     drizzle-kit migration). Keep the two in sync.
 */

// ── Designations master ──────────────────────────────────────────────────────
// Parallels the existing `departments` master. Today staff.department and
// hr_rejoining_forms.designation are free text; this master lets the module
// migrate to referential integrity later WITHOUT breaking those free-text
// columns (additive — nothing is rewritten).
export const designationsTable = pgTable(
  "designations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    code: text("code"),
    departmentId: integer("department_id").references(() => departmentsTable.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    deptIdx: index("designations_department_idx").on(t.departmentId),
  }),
);

// ── Employment status history ────────────────────────────────────────────────
// Append-style history of employment-status transitions
// (active | inactive | on_leave | suspended | notice_period | resigned |
//  terminated | retired | archived). Never deleted — legal record.
export const staffStatusHistoryTable = pgTable(
  "staff_status_history",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    previousStatus: text("previous_status"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    reason: text("reason"),
    changedByUserId: integer("changed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    changedByName: text("changed_by_name"),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffIdx: index("staff_status_history_staff_idx").on(t.staffId),
    staffEffIdx: index("staff_status_history_staff_eff_idx").on(t.staffId, t.effectiveFrom),
  }),
);

// ── Reporting hierarchy ──────────────────────────────────────────────────────
// Effective-dated supervisor relationships. staff_id reports to
// supervisor_staff_id from effective_from until effective_to (NULL = current).
export const staffReportingLinesTable = pgTable(
  "staff_reporting_lines",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    supervisorStaffId: integer("supervisor_staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    relationship: text("relationship").notNull().default("primary"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    staffIdx: index("staff_reporting_lines_staff_idx").on(t.staffId),
    supIdx: index("staff_reporting_lines_supervisor_idx").on(t.supervisorStaffId),
    uniq: uniqueIndex("staff_reporting_lines_uniq").on(
      t.staffId,
      t.supervisorStaffId,
      t.relationship,
      t.effectiveFrom,
    ),
  }),
);

// ── HR documents ─────────────────────────────────────────────────────────────
// Metadata for securely-stored HR documents. Bytes live in object storage
// (presigned upload → /objects/uploads/<uuid>), same pattern as
// hr_rejoining_forms.photo_storage_key. `confidential` defaults TRUE so
// sensitive documents are not exposed to unauthorised roles by default.
export const staffDocumentsTable = pgTable(
  "staff_documents",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "restrict" }),
    docType: text("doc_type").notNull(),
    title: text("title"),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    confidential: boolean("confidential").notNull().default(true),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    uploadedByName: text("uploaded_by_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    staffIdx: index("staff_documents_staff_idx").on(t.staffId),
    staffTypeIdx: index("staff_documents_staff_type_idx").on(t.staffId, t.docType),
  }),
);

export type Designation = typeof designationsTable.$inferSelect;
export type StaffStatusHistory = typeof staffStatusHistoryTable.$inferSelect;
export type StaffReportingLine = typeof staffReportingLinesTable.$inferSelect;
export type StaffDocument = typeof staffDocumentsTable.$inferSelect;
