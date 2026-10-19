import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ─── AI provider settings ─────────────────────────────────────────────────────
// One row per provider (openai | gemini | anthropic | ollama).
// The additional '__global__' row holds general settings as settingsJson.
// encryptedApiKey is AES-256-CBC encrypted; never returned to the frontend raw.
export const aiProviderSettingsTable = pgTable("ai_provider_settings", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // 'openai' | 'gemini' | 'anthropic' | '__global__'
  isEnabled: boolean("is_enabled").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  encryptedApiKey: text("encrypted_api_key"),   // null → key not yet set
  defaultModel: text("default_model"),           // e.g. 'gpt-4o', 'gemini-1.5-pro', 'claude-3-5-sonnet-20241022'
  endpointUrl: text("endpoint_url"),             // e.g. 'http://100.79.100.41:11434' for local Ollama
  settingsJson: text("settings_json"),           // used by '__global__' row; JSON string
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── AI reporting audit log ───────────────────────────────────────────────────
// Every call to /api/ai-reporting/query is logged here regardless of outcome.
export const aiReportingAuditLogsTable = pgTable(
  "ai_reporting_audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    userName: text("user_name"),
    patientId: integer("patient_id"),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    provider: text("provider").notNull(),
    model: text("model"),
    promptText: text("prompt_text"),
    numImages: integer("num_images").notNull().default(0),
    // Records whether identifiers were actually removed from what was sent.
    // Defaults to false so that an insert which forgets the column cannot
    // silently file a positive privacy claim. This line only declares intent:
    // the deployed column default comes from
    // migrations/zzz_ai_audit_anonymized_default.sql, because care-db-patch-v2
    // — not drizzle-kit push — is what reaches a production database.
    anonymized: boolean("anonymized").notNull().default(false),
    includedDemographics: boolean("included_demographics").notNull().default(false),
    wasInsertedToReport: boolean("was_inserted_to_report").notNull().default(false),
    draftId: integer("draft_id"),             // FK → ai_reporting_drafts if saved
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    // ── PR-A image-egress evidence ────────────────────────────────────────────
    // An audit row that says only "provider=ollama, num_images=3" cannot answer
    // the question an auditor actually asks: did these pixels leave the building,
    // and who authorised it? `provider` is a name, and a name is not a network
    // destination. These four columns record the decision that was made and on
    // what evidence. Nothing here holds image bytes, base64, or prompt text — an
    // audit table is not where a patient's picture belongs.
    /**
     * `local` | `cloud` as derived from the resolved endpoint at send time
     * (`classifyEffectiveLocality`), or `unknown` when no endpoint was resolved.
     * Written, not inferred: an absent value means the send predates this column,
     * not that it was local.
     */
    endpointLocality: text("endpoint_locality"),
    /**
     * The durable job this send belongs to — `compose_job:17`, `shadow_job:9`,
     * `self_test:2026-10-19T03:00`. Text, not an integer: these ids come from
     * three different tables, and a foreign key to none of them is more honest
     * than a fake key to one.
     */
    jobReference: text("job_reference"),
    /** Correlates one clinical action across the HTTP request and the job that served it. */
    correlationId: text("correlation_id"),
    /**
     * Comma-separated `radiology_report_key_images.source_type` values, so a
     * reader can tell a viewport capture from a phantom an operator supplied.
     * Provenance only — never a caption, never an image reference.
     */
    imageSourceTypes: text("image_source_types"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStudy: index("ai_audit_study_idx").on(t.studyInstanceUID),
    byUser: index("ai_audit_user_idx").on(t.userId),
    byCreated: index("ai_audit_created_idx").on(t.createdAt),
  }),
);

// ─── AI reporting drafts ──────────────────────────────────────────────────────
// AI-generated draft reports pending doctor/radiologist review and approval.
// AI must NEVER auto-sign. status transitions: draft → inserted | approved.
export const aiReportingDraftsTable = pgTable(
  "ai_reporting_drafts",
  {
    id: serial("id").primaryKey(),
    studyInstanceUID: text("study_instance_uid"),
    accessionNumber: text("accession_number"),
    patientId: integer("patient_id"),
    userId: integer("user_id"),
    userName: text("user_name"),
    provider: text("provider").notNull(),
    model: text("model"),
    promptText: text("prompt_text"),
    templateName: text("template_name"),     // preset template used, if any
    aiResponse: text("ai_response"),         // raw AI output
    draftText: text("draft_text"),           // (optionally edited) draft text
    status: text("status").notNull().default("draft"), // draft | inserted | approved
    insertedAt: timestamp("inserted_at", { withTimezone: true }),
    insertedBy: text("inserted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byStudy: index("ai_draft_study_idx").on(t.studyInstanceUID),
    byPatient: index("ai_draft_patient_idx").on(t.patientId),
  }),
);

export type AiProviderSettings = typeof aiProviderSettingsTable.$inferSelect;
export type AiReportingAuditLog = typeof aiReportingAuditLogsTable.$inferSelect;
export type AiReportingDraft = typeof aiReportingDraftsTable.$inferSelect;
