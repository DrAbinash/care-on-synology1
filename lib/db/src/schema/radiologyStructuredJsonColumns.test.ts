import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { radiologyReportDraftsTable } from "./radiologyReportGenerator";
import { patientReportsTable, type PatientReport } from "./patientReports";

// Ticket A2 coverage: a minimal schema-level sanity check for the nullable
// structured_json / render-context columns added to two EXISTING, populated
// tables. No route reads or writes these columns yet — nothing here touches
// a live database; this only proves the schema declarations are correct
// and, critically, that every pre-existing insert call site elsewhere in
// the codebase (which never mentions these new columns) still compiles.

describe("radiology_report_drafts.structured_json — additive, nullable, optional on insert", () => {
  it("an insert that never mentions structured_json still type-checks (existing call sites unaffected)", () => {
    const preExistingShapeInsert: typeof radiologyReportDraftsTable.$inferInsert = {
      studyId: 1,
      patientId: 2,
      modality: "MR",
    };
    expect(preExistingShapeInsert.structuredJson).toBeUndefined();
  });

  it("structuredJson accepts an explicit JSON value or null", () => {
    const withValue: typeof radiologyReportDraftsTable.$inferInsert = { structuredJson: { findings: [] } };
    const withNull: typeof radiologyReportDraftsTable.$inferInsert = { structuredJson: null };
    expect(withValue.structuredJson).toEqual({ findings: [] });
    expect(withNull.structuredJson).toBeNull();
  });

  it("a selected row's structuredJson is nullable in its type (not accidentally NOT NULL)", () => {
    const fakeSelectedRow: typeof radiologyReportDraftsTable.$inferSelect = {
      id: 1, studyId: null, worklistId: null, patientId: null, templateId: null,
      modality: null, studyName: null, clinicalHistory: null, rawFindings: null,
      findingsSections: null, impression: null, recommendation: null,
      formattedReportHtml: null, formattedReportText: null, status: "DRAFT",
      finalReportId: null,
      structuredJson: null, // compiles only if the column is genuinely nullable
      createdBy: null, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(fakeSelectedRow.structuredJson).toBeNull();
  });

  it("the column reference works with drizzle-orm's real eq() helper", () => {
    expect(() => eq(radiologyReportDraftsTable.structuredJson, { a: 1 })).not.toThrow();
  });
});

describe("patient_reports — structured_json + render-context columns, additive, nullable, optional on insert", () => {
  it("an insert that never mentions the new columns still type-checks (existing call sites unaffected)", () => {
    const preExistingShapeInsert: typeof patientReportsTable.$inferInsert = {
      reportNumber: "RPT-20260709-001",
      type: "radiology",
      patientId: 1,
      testId: 1,
      title: "MRI LS Spine",
    };
    expect(preExistingShapeInsert.structuredJson).toBeUndefined();
    expect(preExistingShapeInsert.renderEngineVersion).toBeUndefined();
    expect(preExistingShapeInsert.templateVersion).toBeUndefined();
    expect(preExistingShapeInsert.catalogVersion).toBeUndefined();
  });

  it("all four new columns accept an explicit value or null", () => {
    const withValues: typeof patientReportsTable.$inferInsert = {
      reportNumber: "RPT-20260709-002", type: "radiology", patientId: 1, testId: 1, title: "x",
      structuredJson: { findings: [] },
      renderEngineVersion: "1.0.0",
      templateVersion: "mri-ls-spine-v3",
      catalogVersion: "2026.07.09-3",
    };
    const withNulls: typeof patientReportsTable.$inferInsert = {
      reportNumber: "RPT-20260709-003", type: "radiology", patientId: 1, testId: 1, title: "x",
      structuredJson: null, renderEngineVersion: null, templateVersion: null, catalogVersion: null,
    };
    expect(withValues.catalogVersion).toBe("2026.07.09-3");
    expect(withNulls.catalogVersion).toBeNull();
  });

  it("a selected row's new columns are nullable in their type (not accidentally NOT NULL)", () => {
    const fakeSelectedRow: PatientReport = {
      id: 1, reportNumber: "RPT-20260709-004", type: "radiology", patientId: 1, testId: 1,
      orderTestId: null, orderId: null, billId: null, studyId: null, title: "x",
      body: "", parameters: null, impression: null, status: "draft",
      isCritical: false, criticalNote: null, criticalAcknowledgedAt: null, criticalAcknowledgedBy: null,
      signatureId: null, signedByName: null, signedAt: null,
      verifiedBySignatureId: null, verifiedByName: null, verifiedAt: null, verifierNotes: null,
      deliveredAt: null, deliveredBy: null, templateId: null,
      publicToken: null, publicTokenExpiresAt: null, stylePresetUsed: null,
      // compiles only if every one of these four is genuinely nullable
      structuredJson: null, renderEngineVersion: null, templateVersion: null, catalogVersion: null,
      createdBy: null, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(fakeSelectedRow.structuredJson).toBeNull();
    expect(fakeSelectedRow.renderEngineVersion).toBeNull();
  });

  it("every new column reference works with drizzle-orm's real eq() helper", () => {
    expect(() => eq(patientReportsTable.structuredJson, { a: 1 })).not.toThrow();
    expect(() => eq(patientReportsTable.renderEngineVersion, "1.0.0")).not.toThrow();
    expect(() => eq(patientReportsTable.templateVersion, "v3")).not.toThrow();
    expect(() => eq(patientReportsTable.catalogVersion, "2026.07.09-3")).not.toThrow();
  });
});
