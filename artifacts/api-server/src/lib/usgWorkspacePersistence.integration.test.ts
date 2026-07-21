/**
 * usgWorkspacePersistence.integration.test.ts — real DB evidence for the USG
 * Companion Workspace validation (P0/P1 hardening).
 *
 * Proves against the actual Postgres + canonical tables + the real PCPNDT gate:
 *   (6) a structured UsgFindingObject persists inside the canonical
 *       radiology_report_drafts.findings_sections and survives a store→reload
 *       round-trip with EVERY field intact (no unknown-field stripping);
 *   (8) checkPcpndtFormFCompliance is fail-closed for obstetric studies.
 *
 * DB-gated: skipped when DATABASE_URL is unset (imports are dynamic so the file
 * loads without a database). Run with an isolated Postgres:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

// A fully-populated structured Finding Object, exactly as the frontend composer
// stores it inside findings_sections[organ].findings[].
const FINDING_OBJECT = {
  findingDefId: "prostatomegaly",
  organ: "prostate",
  laterality: null,
  findingType: "Prostate dimensions / volume",
  parameters: { ap: "3.4 cm", tr: "3.1 cm", cc: "2.4 cm", clinical_finding: "Prostatomegaly" },
  units: { ap: "cm", tr: "cm", cc: "cm" },
  derived: [{ key: "volume", label: "Prostate volume", value: 13.23, unit: "cc", source: "manual", provenance: "manual override (on-cart)", calculated: 13.23, entered: 35, reason: "on-cart" }],
  sourceType: "measurement",
  sourceMeasurementRef: "SR#7/frame1",
  findingText: "Prostate measures 3.4 × 3.1 × 2.4 cm with a calculated volume of approximately 13 cc.",
  impressionText: "Prostatomegaly (volume approximately 35 cc).",
  editedText: "Radiologist-edited prose.",
  warnings: ["Manually entered volume (35 cc) differs materially from the calculated volume (13.23 cc)."],
  author: "Dr Test",
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
};

describe.skipIf(!HAS_DB)("USG workspace persistence + PCPNDT (real DB)", () => {
  let db: any, schema: any, eq: any;
  let patientId: number;
  let draftId: number;
  let pcpndt: (id: number | null | undefined) => Promise<any>;

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq } = await import("drizzle-orm"));
    ({ checkPcpndtFormFCompliance: pcpndt } = await import("./pcpndtCompliance"));

    const [p] = await db.insert(schema.patientsTable).values({
      patientId: `USGVAL-${Date.now()}`,
      firstName: "Val", lastName: "Idation", dateOfBirth: "1990-01-01", gender: "male", phone: "0000000000",
    }).returning();
    patientId = p.id;
  });

  afterAll(async () => {
    if (!db) return;
    if (draftId) await db.delete(schema.radiologyReportDraftsTable).where(eq(schema.radiologyReportDraftsTable.id, draftId));
    if (patientId) {
      await db.delete(schema.formFRecordsTable).where(eq(schema.formFRecordsTable.patientId, patientId));
      await db.delete(schema.patientsTable).where(eq(schema.patientsTable.id, patientId));
    }
  });

  it("(6) structured finding object survives the canonical draft store→reload with every field intact", async () => {
    // Store exactly as the save-draft handler does: findings_sections is a JSON
    // string; the structured findings ride inside {normal,text,findings}.
    const findingsSections = {
      "Prostate": { normal: false, text: FINDING_OBJECT.editedText, findings: [FINDING_OBJECT] },
      "Liver": { normal: true, text: "Liver is normal in size and echotexture." },
    };
    const [row] = await db.insert(schema.radiologyReportDraftsTable).values({
      patientId,
      modality: "US",
      studyName: "USG Whole Abdomen",
      findingsSections: JSON.stringify(findingsSections),
      impression: JSON.stringify(["Prostatomegaly (volume approximately 35 cc)."]),
      status: "DRAFT",
    }).returning();
    draftId = row.id;

    // Reload from the DB and parse back.
    const [reloaded] = await db.select().from(schema.radiologyReportDraftsTable)
      .where(eq(schema.radiologyReportDraftsTable.id, draftId));
    const parsed = JSON.parse(reloaded.findingsSections);
    const f = parsed["Prostate"].findings[0];

    // EVERY field the task enumerates must survive unstripped.
    expect(f.organ).toBe("prostate");
    expect(f.laterality).toBeNull();
    expect(f.findingType).toBe("Prostate dimensions / volume");
    expect(f.parameters).toEqual(FINDING_OBJECT.parameters);
    expect(f.units).toEqual(FINDING_OBJECT.units);
    expect(f.derived[0].calculated).toBe(13.23);
    expect(f.derived[0].entered).toBe(35);
    expect(f.derived[0].reason).toBe("on-cart");
    expect(f.sourceType).toBe("measurement");
    expect(f.sourceMeasurementRef).toBe("SR#7/frame1");
    expect(f.findingText).toBe(FINDING_OBJECT.findingText);
    expect(f.impressionText).toBe(FINDING_OBJECT.impressionText);
    expect(f.editedText).toBe("Radiologist-edited prose.");
    expect(f.author).toBe("Dr Test");
    expect(f.createdAt).toBe(FINDING_OBJECT.createdAt);
    expect(f.updatedAt).toBe(FINDING_OBJECT.updatedAt);
    // Normal-organ shape survives too.
    expect(parsed["Liver"].normal).toBe(true);
    // The impression column round-trips as the canonical string[].
    expect(JSON.parse(reloaded.impression)).toEqual(["Prostatomegaly (volume approximately 35 cc)."]);
  });

  it("(8) PCPNDT is fail-closed: no Form F → blocked", async () => {
    const r = await pcpndt(patientId);
    expect(r.compliant).toBe(false);
    expect(r.reason).toBe("no_form_f");
  });

  it("(8) PCPNDT is fail-closed: incomplete Form F → blocked", async () => {
    await db.insert(schema.formFRecordsTable).values({
      patientId,
      idCardVerified: false, // incomplete
      husbandFatherName: "",
      address: "",
    });
    const r = await pcpndt(patientId);
    expect(r.compliant).toBe(false);
    expect(r.reason).toBe("incomplete_form_f");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("(8) PCPNDT passes only when Form F is complete", async () => {
    await db.delete(schema.formFRecordsTable).where(eq(schema.formFRecordsTable.patientId, patientId));
    await db.insert(schema.formFRecordsTable).values({
      patientId,
      idCardVerified: true,
      husbandFatherName: "Test Spouse",
      address: "Test Address, City",
      consentDate: "2026-07-21",
    });
    const r = await pcpndt(patientId);
    expect(r.compliant).toBe(true);
    expect(r.reason).toBe("compliant");
  });

  it("(8) PCPNDT with no patient is fail-closed", async () => {
    const r = await pcpndt(null);
    expect(r.compliant).toBe(false);
    expect(r.reason).toBe("no_patient");
  });
});
