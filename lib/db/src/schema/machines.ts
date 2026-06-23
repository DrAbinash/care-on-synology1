import { pgTable, text, serial, timestamp, integer, numeric, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const machinesTable = pgTable(
  "machines",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    modelNumber: text("model_number"),
    serialNumber: text("serial_number"),
    manufacturer: text("manufacturer"),
    department: text("department").notNull().default(""),
    location: text("location"),
    purchaseDate: text("purchase_date"),
    purchaseCost: numeric("purchase_cost", { precision: 14, scale: 2 }),
    warrantyEnd: text("warranty_end"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    deptIdx: index("machines_dept_idx").on(t.department),
    statusIdx: index("machines_status_idx").on(t.status),
  }),
);

export const machineAmcContractsTable = pgTable(
  "machine_amc_contracts",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id").notNull().references(() => machinesTable.id, { onDelete: "cascade" }),
    contractType: text("contract_type").notNull().default("AMC"),
    vendor: text("vendor").notNull(),
    contractNumber: text("contract_number"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    cost: numeric("cost", { precision: 12, scale: 2 }).notNull().default("0"),
    contactPerson: text("contact_person"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    coverage: text("coverage"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    machineIdx: index("amc_machine_idx").on(t.machineId),
    endDateIdx: index("amc_end_date_idx").on(t.endDate),
  }),
);

export const machineBreakdownsTable = pgTable(
  "machine_breakdowns",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id").notNull().references(() => machinesTable.id, { onDelete: "cascade" }),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    reportedBy: text("reported_by"),
    description: text("description").notNull(),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    downtimeHours: numeric("downtime_hours", { precision: 8, scale: 2 }),
    repairCost: numeric("repair_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    serviceVendor: text("service_vendor"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    machineIdx: index("breakdown_machine_idx").on(t.machineId),
    statusIdx: index("breakdown_status_idx").on(t.status),
    reportedIdx: index("breakdown_reported_idx").on(t.reportedAt),
  }),
);

export const machineServiceRecordsTable = pgTable(
  "machine_service_records",
  {
    id: serial("id").primaryKey(),
    machineId: integer("machine_id").notNull().references(() => machinesTable.id, { onDelete: "cascade" }),
    serviceDate: text("service_date").notNull(),
    serviceType: text("service_type").notNull().default("preventive"),
    engineer: text("engineer"),
    vendor: text("vendor"),
    cost: numeric("cost", { precision: 12, scale: 2 }).notNull().default("0"),
    partsReplaced: text("parts_replaced"),
    notes: text("notes"),
    nextDueDate: text("next_due_date"),
    certificateNumber: text("certificate_number"),
    certificateUrl: text("certificate_url"),
    performedBy: text("performed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    machineIdx: index("service_machine_idx").on(t.machineId),
    typeIdx: index("service_type_idx").on(t.serviceType),
    nextDueIdx: index("service_next_due_idx").on(t.nextDueDate),
    serviceDateIdx: index("service_date_idx").on(t.serviceDate),
  }),
);

export const insertMachineSchema = createInsertSchema(machinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMachineAmcSchema = createInsertSchema(machineAmcContractsTable).omit({ id: true, createdAt: true });
export const insertMachineBreakdownSchema = createInsertSchema(machineBreakdownsTable).omit({ id: true, createdAt: true });
export const insertMachineServiceSchema = createInsertSchema(machineServiceRecordsTable).omit({ id: true, createdAt: true });

export type Machine = typeof machinesTable.$inferSelect;
export type MachineAmcContract = typeof machineAmcContractsTable.$inferSelect;
export type MachineBreakdown = typeof machineBreakdownsTable.$inferSelect;
export type MachineServiceRecord = typeof machineServiceRecordsTable.$inferSelect;
export type InsertMachine = z.infer<typeof insertMachineSchema>;
export type InsertMachineAmc = z.infer<typeof insertMachineAmcSchema>;
export type InsertMachineBreakdown = z.infer<typeof insertMachineBreakdownSchema>;
export type InsertMachineService = z.infer<typeof insertMachineServiceSchema>;
