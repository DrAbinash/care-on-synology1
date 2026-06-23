import { pgTable, text, serial, timestamp, integer, numeric, date, boolean, uniqueIndex, bigint, jsonb } from "drizzle-orm/pg-core";

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  staffId: text("staff_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  role: text("role").notNull(),
  department: text("department"),
  joiningDate: date("joining_date"),
  baseSalary: numeric("base_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  bankAccount: text("bank_account"),
  ifsc: text("ifsc"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const staffCounterTable = pgTable("staff_counter", {
  id: serial("id").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export const staffAdvancesTable = pgTable("staff_advances", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  advanceDate: date("advance_date").notNull(),
  paymentMode: text("payment_mode").notNull().default("cash"),
  reason: text("reason"),
  recoveredAmount: numeric("recovered_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("outstanding"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffSalaryPaymentsTable = pgTable("staff_salary_payments", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  monthYear: text("month_year").notNull(),
  baseAmount: numeric("base_amount", { precision: 10, scale: 2 }).notNull(),
  bonus: numeric("bonus", { precision: 10, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 10, scale: 2 }).notNull().default("0"),
  advanceDeducted: numeric("advance_deducted", { precision: 10, scale: 2 }).notNull().default("0"),
  daysPresent: integer("days_present").notNull().default(0),
  daysAbsent: integer("days_absent").notNull().default(0),
  netAmount: numeric("net_amount", { precision: 10, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMode: text("payment_mode").notNull().default("cash"),
  reference: text("reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffAttendanceTable = pgTable("staff_attendance", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  attendanceDate: date("attendance_date").notNull(),
  punchIn: timestamp("punch_in", { withTimezone: true }),
  punchOut: timestamp("punch_out", { withTimezone: true }),
  source: text("source").notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqStaffDate: uniqueIndex("staff_attendance_staff_date_uniq").on(t.staffId, t.attendanceDate),
}));

export const staffBiometricCredentialsTable = pgTable("staff_biometric_credentials", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports"),
  deviceName: text("device_name"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Bridge fingerprint templates — for dedicated USB scanners (ZKTeco, Mantra, Morpho, etc.)
// Used by both staff attendance and user login. Matching is performed by the local bridge service.
export const bridgeFingerprintTemplatesTable = pgTable("bridge_fingerprint_templates", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(), // 'staff' | 'user'
  scopeId: integer("scope_id").notNull(),
  vendor: text("vendor").notNull().default("generic"), // mock | zkteco | mantra | morpho | generic
  fingerName: text("finger_name"), // e.g. "right-index"
  template: text("template").notNull(), // base64 vendor-specific template blob
  quality: integer("quality"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Sessions for ERP user login (fingerprint or PIN-based)
export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  loginMethod: text("login_method").notNull().default("fingerprint"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── HR Re-Joining / Update Forms ─────────────────────
// Multi-section employee re-joining form mirroring the paper layout used by
// CARE DIAGNOSTICS / HOPE NEUROTRAUMA. One staff member can have many forms
// (each captures a re-joining or revision event). When a form is `approved`
// the new fixedSalary is written back to staffTable.baseSalary in a tx.

export type HrFamilyDetails = {
  fatherName?: string;
  motherName?: string;
  spouseName?: string;
  anniversaryDate?: string;
  children?: { name: string; age?: string; school?: string }[];
  familyMembers?: { name: string; relation: string; age?: string }[];
};

export type HrSalaryStructure = {
  basic?: number;
  hra?: number;
  conveyance?: number;
  medical?: number;
  special?: number;
  other?: number;
  gross?: number;
  fixed?: number;            // Final fixed monthly salary (used for staff.baseSalary on approve)
  effectiveFrom?: string;    // YYYY-MM-DD
};

export type HrDocumentChecklist = {
  aadhaarCopy?: boolean;
  panCopy?: boolean;
  educationCertificates?: boolean;
  experienceCertificates?: boolean;
  passportPhoto?: boolean;
  cancelledCheque?: boolean;
  bankPassbook?: boolean;
  policeVerification?: boolean;
  medicalFitness?: boolean;
  resignationFromPrevious?: boolean;
};

export const hrRejoiningFormsTable = pgTable("hr_rejoining_forms", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull().references(() => staffTable.id, { onDelete: "cascade" }),
  formNumber: text("form_number").notNull().unique(),

  // Section 1 — Employee details
  // photoDataUrl: legacy inline base64 (kept for backward compatibility with
  // any forms created before the object-storage upload flow was wired up).
  // photoStorageKey: object storage path (e.g. "/objects/uploads/<uuid>") for
  // forms created via the presigned URL upload endpoint. Front-end prefers
  // photoStorageKey when present and falls back to photoDataUrl.
  photoDataUrl: text("photo_data_url"),
  photoStorageKey: text("photo_storage_key"),
  employeeName: text("employee_name").notNull(),
  fatherSpouseName: text("father_spouse_name"),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  bloodGroup: text("blood_group"),
  qualification: text("qualification"),
  aadhaarNumber: text("aadhaar_number"),
  panNumber: text("pan_number"),
  address: text("address"),
  mobile: text("mobile"),
  alternateMobile: text("alternate_mobile"),
  email: text("email"),
  designation: text("designation"),
  department: text("department"),
  joiningDate: date("joining_date"),
  rejoiningDate: date("rejoining_date"),

  // Section 2 — Family
  familyDetails: jsonb("family_details").$type<HrFamilyDetails>(),

  // Section 3 — Emergency contact
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactRelation: text("emergency_contact_relation"),
  emergencyContactPhone: text("emergency_contact_phone"),

  // Section 4 — Bank details
  bankAccountHolder: text("bank_account_holder"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankBranch: text("bank_branch"),

  // Section 5 — Salary structure (jsonb breakdown + denormalised fixed for fast read/sort)
  salaryStructure: jsonb("salary_structure").$type<HrSalaryStructure>(),
  fixedSalary: numeric("fixed_salary", { precision: 10, scale: 2 }).notNull().default("0"),

  // Section 6/7 — Performance incentive & deduction acknowledgements (booleans only;
  // boilerplate text/percentages live in code, not DB, per task scope).
  incentiveAcknowledged: boolean("incentive_acknowledged").notNull().default(false),
  deductionAcknowledged: boolean("deduction_acknowledged").notNull().default(false),

  // Section 8 — Duty / shift policy
  shiftType: text("shift_type"), // 'general' | 'critical'
  reportingTime: text("reporting_time"),
  dutyHours: text("duty_hours"),

  // Section 9 — Confidentiality
  confidentialityAcknowledged: boolean("confidentiality_acknowledged").notNull().default(false),

  // Section 10 — Notice period (30 for general staff, 90 for technical/critical)
  noticePeriodDays: integer("notice_period_days").notNull().default(30),
  noticePolicyAcknowledged: boolean("notice_policy_acknowledged").notNull().default(false),

  // Section 11 — Document checklist
  documentChecklist: jsonb("document_checklist").$type<HrDocumentChecklist>(),

  // Section 12 — Declaration & approval
  employeeDeclarationDate: date("employee_declaration_date"),
  employeeSignatureDataUrl: text("employee_signature_data_url"),
  remarks: text("remarks"),
  managementStatus: text("management_status").notNull().default("pending"), // pending | approved | rejected
  approvedByUserId: integer("approved_by_user_id"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const hrRejoiningFormCounterTable = pgTable("hr_rejoining_form_counter", {
  id: serial("id").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export type Staff = typeof staffTable.$inferSelect;
export type StaffAdvance = typeof staffAdvancesTable.$inferSelect;
export type StaffSalaryPayment = typeof staffSalaryPaymentsTable.$inferSelect;
export type StaffAttendance = typeof staffAttendanceTable.$inferSelect;
export type StaffBiometricCredential = typeof staffBiometricCredentialsTable.$inferSelect;
export type HrRejoiningForm = typeof hrRejoiningFormsTable.$inferSelect;
