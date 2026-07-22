/**
 * usgProvenanceIngest.integration.test.ts — real-DB evidence for P3 exact-
 * provenance persistence. Proves against actual Postgres:
 *   - SR measurements persist into viewer_measurements with viewerName "DICOM SR";
 *   - a measurement with no image reference persists frame_number NULL (the
 *     column default of 1 does NOT fabricate a frame);
 *   - re-ingesting the same SR is idempotent (no duplicates).
 *
 * DB-gated (dynamic imports); run with:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("P3 provenance ingest (real DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, schema: any, eq: any, and: any, ingest: any, fixtures: any;
  let patientId: number;
  const stamp = Date.now();
  const studyUID = `1.2.p3.prov.${stamp}`;

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq, and } = await import("drizzle-orm"));
    ingest = await import("./usgProvenanceIngest");
    fixtures = await import("./__fixtures__/usgSrFixtures");
    const [p] = await db.insert(schema.patientsTable).values({
      patientId: `P3-${stamp}`, firstName: "Prov", lastName: "Test",
      dateOfBirth: "1990-01-01", gender: "female", phone: "0000000000",
    }).returning();
    patientId = p.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.viewerMeasurementsTable).where(eq(schema.viewerMeasurementsTable.studyInstanceUID, studyUID));
    if (patientId) await db.delete(schema.patientsTable).where(eq(schema.patientsTable.id, patientId));
  });

  it("persists SR provenance rows and is idempotent on re-ingest", async () => {
    const ctx = { studyInstanceUID: studyUID, patientId };
    const first = await ingest.ingestSrProvenance(fixtures.OB_SR_FIXTURE, ctx);
    expect(first.inserted).toBeGreaterThan(0);

    const rows = await db.select().from(schema.viewerMeasurementsTable)
      .where(and(eq(schema.viewerMeasurementsTable.studyInstanceUID, studyUID), eq(schema.viewerMeasurementsTable.viewerName, "DICOM SR")));
    expect(rows.length).toBe(first.inserted);

    // Re-ingest → nothing new (idempotent).
    const second = await ingest.ingestSrProvenance(fixtures.OB_SR_FIXTURE, ctx);
    expect(second.inserted).toBe(0);
    expect(second.skippedExisting).toBe(first.inserted);

    const rowsAfter = await db.select().from(schema.viewerMeasurementsTable)
      .where(eq(schema.viewerMeasurementsTable.studyInstanceUID, studyUID));
    expect(rowsAfter.length).toBe(rows.length);
  });

  it("stores frame_number NULL for a measurement with no image reference (no fabrication)", async () => {
    const noImgUID = `${studyUID}.noimg`;
    await ingest.ingestSrProvenance(fixtures.SR_NO_IMAGE_FIXTURE, { studyInstanceUID: noImgUID, patientId });
    const rows = await db.select().from(schema.viewerMeasurementsTable)
      .where(eq(schema.viewerMeasurementsTable.studyInstanceUID, noImgUID));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (!r.sopInstanceUID) expect(r.frameNumber).toBeNull(); // NOT the default 1
    }
    await db.delete(schema.viewerMeasurementsTable).where(eq(schema.viewerMeasurementsTable.studyInstanceUID, noImgUID));
  });
});
