/**
 * usgCineService.integration.test.ts — real-DB evidence for P7 cine key-frame
 * capture. Proves against actual Postgres:
 *   - a key frame from a real cine clip persists a DICOM reference (SOP + the
 *     REAL selected frame) into usg_key_images;
 *   - re-capturing the same frame is idempotent;
 *   - a single-frame (non-cine) image is refused (no key frame, no fabrication).
 *
 * DB-gated (dynamic imports); run with:
 *   DATABASE_URL=postgres://…/care_test pnpm exec vitest run <thisfile>
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;

const CINE = {
  "0020000D": { Value: ["1.2.cine.study"] },
  "0020000E": { Value: ["1.2.cine.series"] },
  "00080018": { Value: ["1.2.cine.sop"] },
  "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.3.1"] },
  "00280008": { Value: [60] },  // NumberOfFrames
  "00180040": { Value: [30] },  // CineRate
};
const STILL = { ...CINE, "00280008": { Value: [1] } };

describe.skipIf(!HAS_DB)("P7 cine key-frame capture (real DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, schema: any, eq: any, svc: any;
  const stamp = Date.now();
  const studyUID = `1.2.cine.${stamp}`;

  beforeAll(async () => {
    ({ db } = await import("@workspace/db"));
    schema = await import("@workspace/db/schema");
    ({ eq } = await import("drizzle-orm"));
    svc = await import("./usgCineService");
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.usgKeyImagesTable).where(eq(schema.usgKeyImagesTable.studyInstanceUID, studyUID));
  });

  it("captures a key frame as a DICOM reference and is idempotent", async () => {
    const first = await svc.captureKeyFrame(CINE, { studyInstanceUID: studyUID }, { selectedFrame: 20 });
    expect("keyImageId" in first).toBe(true);
    expect(first.frameNumber).toBe(20);        // the REAL selected frame
    expect(first.sopInstanceUID).toBe("1.2.cine.sop");
    expect(first.created).toBe(true);

    const rows = await db.select().from(schema.usgKeyImagesTable).where(eq(schema.usgKeyImagesTable.studyInstanceUID, studyUID));
    expect(rows.length).toBe(1);
    expect(rows[0].frameNumber).toBe(20);
    expect(rows[0].source).toBe("cine");

    // Re-capture same frame → idempotent.
    const second = await svc.captureKeyFrame(CINE, { studyInstanceUID: studyUID }, { selectedFrame: 20 });
    expect(second.created).toBe(false);
    const rowsAfter = await db.select().from(schema.usgKeyImagesTable).where(eq(schema.usgKeyImagesTable.studyInstanceUID, studyUID));
    expect(rowsAfter.length).toBe(1);
  });

  it("refuses a non-cine (single-frame) image — no key frame, no fabricated frame", async () => {
    const stillUID = `${studyUID}.still`;
    const result = await svc.captureKeyFrame(STILL, { studyInstanceUID: stillUID });
    expect(result.error).toBe("not_cine");
    const rows = await db.select().from(schema.usgKeyImagesTable).where(eq(schema.usgKeyImagesTable.studyInstanceUID, stillUID));
    expect(rows.length).toBe(0);
  });

  it("describes a clip's playback capability and suggested key frame", () => {
    const d = svc.describeCineClip(CINE);
    expect(d.isCine).toBe(true);
    expect(d.playback.fps).toBe(30);
    expect(d.suggestedKeyFrame).toBe(30);   // middle of 60
  });
});
