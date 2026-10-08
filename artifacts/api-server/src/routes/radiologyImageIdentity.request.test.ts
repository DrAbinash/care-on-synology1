/**
 * D2 — trustworthy displayed-image identity, request-level.
 *
 * Every case here is a claim about the image a radiologist was looking at, arriving
 * over the surfaces that persist it: /viewer-measurements, /key-images (multipart
 * capture) and /image-references. The rule being tested is the same in all three:
 * a DICOM identity may only become durable when CARE's own PACS says the chain
 * Study → Series → SOP (and, for a genuinely multi-frame instance, the frame)
 * is real for THIS study. Anything the client invents — the frame-1 default that
 * WADO-RS puts in every URL, a series the SOP does not live in, another study's
 * image — is refused, and anything CARE cannot check is stored as unknown rather
 * than as a claim.
 *
 * Needs PostgreSQL (DATABASE_URL). The PACS is a real HTTP server on localhost
 * speaking Orthanc's DICOMweb QIDO protocol — the ERP's own listStudyInstances()
 * reaches it over the network exactly as it reaches the NAS, so the ownership
 * check is exercised end to end, not stubbed.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
  radiologyImageReferencesTable,
  viewerMeasurementsTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { FROZEN_KEY_IMAGE_DIR } from "../lib/frozenKeyImages";
import { startMockDicomWeb, type MockDicomWeb, type MockInstance } from "../testSupport/mockDicomWeb";

// A real 16×16 JPEG, built by sharp rather than pasted: a hand-copied base64
// constant decoded to a corrupt stream and every capture test then died on the
// route's own "Unreadable image file" check, which is not what is under test.
const jpegBytes: { current: Buffer } = { current: Buffer.alloc(0) };

// ── The PACS fixture: what Orthanc would actually answer for this study ──
const d = String(Math.floor(100000 + Math.random() * 899999));
const STUDY_A = `1.2.840.99901${d}`;
const SERIES_A1 = `1.2.840.99902${d}`;
const INST_A_SINGLE = `1.2.840.99903${d}`; // no (0028,0008) at all — plain CT/MR slice
const INST_A_ONEFRAME = `1.2.840.99904${d}`; // (0028,0008) = "1" — explicitly single frame
const SERIES_A2 = `1.2.840.99905${d}`;
const INST_A_CINE = `1.2.840.99906${d}`; // (0028,0008) = "60" — genuinely multi-frame
const STUDY_B = `1.2.840.99907${d}`;
const SERIES_B1 = `1.2.840.99908${d}`;
const INST_B1 = `1.2.840.99909${d}`;

const MANIFEST: Record<string, Record<string, MockInstance[]>> = {
  [STUDY_A]: {
    [SERIES_A1]: [{ sopUid: INST_A_SINGLE }, { sopUid: INST_A_ONEFRAME, numberOfFrames: 1 }],
    [SERIES_A2]: [{ sopUid: INST_A_CINE, numberOfFrames: 60 }],
  },
  [STUDY_B]: { [SERIES_B1]: [{ sopUid: INST_B1 }] },
};

let pacs: MockDicomWeb | null = null;
let pacsPort = 0;

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("D2 displayed-image identity at the API boundary", () => {
  let app: Express;
  const marker = `d2id-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const prevOrthanc = process.env.ORTHANC_INTERNAL_URL;
  let userId = 0;
  let worklistId = 0;
  let draftId = 0;
  const patientId = 900000 + Number(d.slice(0, 5));
  const cleanupKeyImageIds: number[] = [];
  const cleanupRefIds: number[] = [];
  const cleanupMeasurementIds: number[] = [];

  const auth = { Authorization: `Bearer ${token}` };

  function expectStatus(res: { status: number; text: string }, code: number) {
    expect(res.status, `${code} expected; got ${res.status} ${res.text.slice(0, 1600)}`).toBe(code);
  }

  async function keyImagePost(fields: Record<string, string>) {
    const req = request(app)
      .post("/api/radiology/report-generator/key-images")
      .set(auth)
      .field("draftId", String(draftId))
      .attach("image", jpegBytes.current, { filename: "cap.jpg", contentType: "image/jpeg" });
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req;
  }

  async function rowFor(keyImageId: number) {
    const [row] = await db
      .select()
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.id, keyImageId))
      .limit(1);
    return row;
  }

  beforeAll(async () => {
    app = await createTestApp();
    jpegBytes.current = await sharp(Buffer.alloc(16 * 16 * 3, 96), {
      raw: { width: 16, height: 16, channels: 3 },
    }).jpeg({ quality: 80 }).toBuffer();
    // radiology_image_references.presentation_json exists in the Drizzle model
    // (radiologyReportGenerator.ts:224, NOT NULL DEFAULT '{}') but in no migration
    // file — `grep -rl presentation_json migrations/` returns 0 — so a database
    // built by apply-all-migrations cannot complete a successful
    // POST /image-references: the INSERT names a column that is not there and the
    // route 500s. The production fix is a migrations/*.sql file; it is not D2's
    // scope, so the harness adds the column locally and the gap is reported.
    await db.execute(
      sql`ALTER TABLE radiology_image_references
            ADD COLUMN IF NOT EXISTS presentation_json text NOT NULL DEFAULT '{}'`,
    );
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    pacs = await startMockDicomWeb(MANIFEST);
    pacsPort = pacs.port;
    process.env.ORTHANC_INTERNAL_URL = pacs.url;

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `D2 ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/orders", "/radiology", "/report-generator", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `D2 ^${marker}`,
        patientId,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: new Date().toISOString().slice(0, 10),
        accessionNumber: `ACC-${d}`,
        studyInstanceUID: STUDY_A,
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        studyId: worklistId,
        worklistId,
        patientId,
        rawFindings: "D2 identity",
        status: "DRAFT",
      })
      .returning();
    draftId = draft.id;
  });

  afterAll(async () => {
    await pacs?.close();
    if (cleanupKeyImageIds.length) {
      const rows = await db
        .select({ imageUrl: radiologyReportKeyImagesTable.imageUrl })
        .from(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, cleanupKeyImageIds));
      await db
        .delete(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, cleanupKeyImageIds));
      for (const r of rows) {
        const base = (r.imageUrl || "").split("/").pop();
        if (base) await fs.rm(`${FROZEN_KEY_IMAGE_DIR}/${base}`, { force: true }).catch(() => undefined);
      }
    }
    if (cleanupRefIds.length) {
      await db
        .delete(radiologyImageReferencesTable)
        .where(inArray(radiologyImageReferencesTable.id, cleanupRefIds));
    }
    if (cleanupMeasurementIds.length) {
      await db
        .delete(viewerMeasurementsTable)
        .where(inArray(viewerMeasurementsTable.id, cleanupMeasurementIds));
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
    if (worklistId) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    if (prevOrthanc === undefined) delete process.env.ORTHANC_INTERNAL_URL;
    else process.env.ORTHANC_INTERNAL_URL = prevOrthanc;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // D2-R2 — the frame the viewer did not name must stay unknown.
  // A WADO-RS URL ends in /frames/1 for a single-frame instance whatever the
  // radiologist is looking at, so "1" is a default, not a measurement.
  // ────────────────────────────────────────────────────────────────────────────
  it("D2-R2a: a viewer measurement without a frame stores no frame (never 1)", async () => {
    const res = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set(auth)
      .send({
        patientId,
        studyId: worklistId,
        studyInstanceUID: STUDY_A,
        seriesInstanceUID: SERIES_A1,
        sopInstanceUID: INST_A_SINGLE,
        viewerName: "OHIF",
        measurementType: "Length",
        value: "12.5",
        unit: "mm",
      });
    expect([200, 201]).toContain(res.status);
    const rows = await db
      .select()
      .from(viewerMeasurementsTable)
      .where(eq(viewerMeasurementsTable.studyInstanceUID, STUDY_A));
    const mine = rows.filter((r) => r.sopInstanceUID === INST_A_SINGLE);
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) {
      cleanupMeasurementIds.push(r.id);
      // Absent frame must remain absent — this is the fabrication the brief forbids.
      expect(r.frameNumber).toBeNull();
    }
  });

  it("D2-R2b (positive control): a frame the viewer did name is stored as named", async () => {
    const res = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set(auth)
      .send({
        patientId,
        studyId: worklistId,
        studyInstanceUID: STUDY_A,
        seriesInstanceUID: SERIES_A2,
        sopInstanceUID: INST_A_CINE,
        frameNumber: 7,
        viewerName: "OHIF",
        measurementType: "Length",
        value: "3.2",
        unit: "mm",
      });
    expect([200, 201]).toContain(res.status);
    const rows = await db
      .select()
      .from(viewerMeasurementsTable)
      .where(eq(viewerMeasurementsTable.sopInstanceUID, INST_A_CINE));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) cleanupMeasurementIds.push(r.id);
    expect(rows[0].frameNumber).toBe(7);
  });

  it("D2-I1: a measurement naming a study that is not this study's is refused", async () => {
    const before = await db
      .select({ id: viewerMeasurementsTable.id })
      .from(viewerMeasurementsTable)
      .where(eq(viewerMeasurementsTable.studyInstanceUID, STUDY_B));
    const res = await request(app)
      .post("/api/radiology-lesions/viewer-measurements")
      .set(auth)
      .send({
        patientId,
        studyId: worklistId,
        studyInstanceUID: STUDY_B, // another study, while the CARE study id is this one
        seriesInstanceUID: SERIES_B1,
        sopInstanceUID: INST_B1,
        viewerName: "OHIF",
        measurementType: "Length",
        value: "9.9",
        unit: "mm",
      });
    expectStatus(res, 409);
    const after = await db
      .select({ id: viewerMeasurementsTable.id })
      .from(viewerMeasurementsTable)
      .where(eq(viewerMeasurementsTable.studyInstanceUID, STUDY_B));
    expect(after.length).toBe(before.length);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // D2-R5 / D2-R6 / D2-R8 — the capture path had no ownership check at all.
  // ────────────────────────────────────────────────────────────────────────────
  it("D2-R5: a captured key image from another study is refused", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_B,
      seriesInstanceUID: SERIES_B1,
      sopInstanceUID: INST_B1,
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "foreign study",
    });
    expectStatus(res, 409);
    const rows = await db
      .select({ id: radiologyReportKeyImagesTable.id })
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.draftId, draftId));
    expect(rows.length).toBe(0);
  });

  it("D2-R6a: a SOP the study's manifest does not contain is refused", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A1,
      sopInstanceUID: `1.2.840.99998${d}`, // well-formed, right study, no such instance
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "invented sop",
    });
    expectStatus(res, 409);
  });

  it("D2-R6b: a SOP that exists but not in the claimed series is refused", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A2, // INST_A_SINGLE lives in SERIES_A1
      sopInstanceUID: INST_A_SINGLE,
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "wrong series",
    });
    expectStatus(res, 409);
  });

  it("D2-I5/I7: a verified single-frame capture persists the chain with no frame", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A1,
      sopInstanceUID: INST_A_SINGLE,
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "verified slice",
    });
    expectStatus(res, 201);
    const id = res.body?.item?.id;
    expect(id).toBeTruthy();
    cleanupKeyImageIds.push(id);
    const row = await rowFor(id);
    expect(row.studyInstanceUid).toBe(STUDY_A);
    expect(row.seriesInstanceUid).toBe(SERIES_A1);
    expect(row.sopInstanceUid).toBe(INST_A_SINGLE);
    expect(row.frameNumber).toBeNull();
  });

  it("D2-R8a: a frame-1 default on a single-frame instance is not kept", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A1,
      sopInstanceUID: INST_A_ONEFRAME, // (0028,0008) = 1
      frameNumber: "1", // exactly what the WADO-RS URL says
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "frame default",
    });
    expectStatus(res, 201);
    cleanupKeyImageIds.push(res.body?.item?.id);
    const row = await rowFor(res.body.item.id);
    expect(row.frameNumber).toBeNull();
  });

  it("D2-R8b: a real frame of a multi-frame instance is kept", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A2,
      sopInstanceUID: INST_A_CINE, // 60 frames
      frameNumber: "17",
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "cine frame 17",
    });
    expectStatus(res, 201);
    cleanupKeyImageIds.push(res.body?.item?.id);
    const row = await rowFor(res.body.item.id);
    expect(row.frameNumber).toBe(17);
  });

  it("D2-R8c: a frame number beyond the instance's frame count is refused", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A2,
      sopInstanceUID: INST_A_CINE,
      frameNumber: "999",
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "impossible frame",
    });
    expectStatus(res, 409);
  });

  it("D2-I6: when the PACS cannot answer, the image survives and the identity does not", async () => {
    pacs?.setMode("down");
    try {
      const res = await keyImagePost({
        studyInstanceUID: STUDY_A,
        seriesInstanceUID: SERIES_A1,
        sopInstanceUID: INST_A_SINGLE,
        viewer: "ohif",
        sourceType: "VIEWPORT_CAPTURE",
        caption: "pacs unreachable",
      });
      expectStatus(res, 201);
      cleanupKeyImageIds.push(res.body?.item?.id);
      const row = await rowFor(res.body.item.id);
      // Unverifiable must not become a durable DICOM claim.
      expect(row.sopInstanceUid).toBeNull();
      expect(row.seriesInstanceUid).toBeNull();
      expect(row.frameNumber).toBeNull();
      expect(String(res.body.warningCode)).toBe("IMAGE_PACS_UNREACHABLE");
    } finally {
      pacs?.setMode("serve");
    }
  });

  it("D2-R4: transient viewer ids never become the stored identity", async () => {
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A1,
      sopInstanceUID: INST_A_SINGLE,
      viewportId: "0",
      displaySetInstanceUID: "ds-should-be-ignored",
      imageId: `wadors:http://127.0.0.1:${pacsPort}/dicom-web/studies/${STUDY_A}/series/${SERIES_A1}/instances/${INST_A_SINGLE}/frames/1`,
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "transient ids must not leak in",
    });
    expectStatus(res, 201);
    cleanupKeyImageIds.push(res.body?.item?.id);
    const row = await rowFor(res.body.item.id);
    expect(row.sopInstanceUid).toBe(INST_A_SINGLE);
    expect(row.seriesInstanceUid).toBe(SERIES_A1);
    // The row is the whole durable record: no column may carry a viewer-local id.
    const jsonish = JSON.stringify(row);
    expect(jsonish).not.toMatch(/ds-should-be-ignored/);
    expect(jsonish).not.toMatch(/wadors:/);
    expect(row.viewportSnapshotJson ?? "").not.toMatch(/ds-should-be-ignored/);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // /image-references — the report's image list. Study was checked; the rest was not.
  // ────────────────────────────────────────────────────────────────────────────
  it("D2-R6c: an image reference with a foreign SOP inside the right study is refused", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId,
        description: "not in this study",
        studyInstanceUid: STUDY_A,
        seriesInstanceUid: SERIES_A1,
        sopInstanceUid: INST_B1, // belongs to STUDY_B
        isKeyImage: true,
      });
    expectStatus(res, 409);
  });

  it("D2-R6d: an image reference whose series does not hold the SOP is refused", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId,
        description: "wrong series",
        studyInstanceUid: STUDY_A,
        seriesInstanceUid: SERIES_A2,
        sopInstanceUid: INST_A_SINGLE,
        isKeyImage: true,
      });
    expectStatus(res, 409);
  });

  it("D2-R8d: an image reference frame on a single-frame instance is stored as unknown", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId,
        description: "slice with default frame",
        studyInstanceUid: STUDY_A,
        seriesInstanceUid: SERIES_A1,
        sopInstanceUid: INST_A_ONEFRAME,
        frameNumber: 1,
        isKeyImage: true,
      });
    expectStatus(res, 201);
    cleanupRefIds.push(res.body.id);
    const [row] = await db
      .select()
      .from(radiologyImageReferencesTable)
      .where(eq(radiologyImageReferencesTable.id, res.body.id))
      .limit(1);
    expect(row.frameNumber).toBeNull();
  });

  it("D2-I5 (positive control): a verified chain is accepted and kept exactly", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId,
        description: "verified cine frame",
        studyInstanceUid: STUDY_A,
        seriesInstanceUid: SERIES_A2,
        sopInstanceUid: INST_A_CINE,
        frameNumber: 4,
        isKeyImage: true,
      });
    expectStatus(res, 201);
    cleanupRefIds.push(res.body.id);
    const [row] = await db
      .select()
      .from(radiologyImageReferencesTable)
      .where(eq(radiologyImageReferencesTable.id, res.body.id))
      .limit(1);
    expect(row.studyInstanceUid).toBe(STUDY_A);
    expect(row.seriesInstanceUid).toBe(SERIES_A2);
    expect(row.sopInstanceUid).toBe(INST_A_CINE);
    expect(row.frameNumber).toBe(4);
  });

  it("D2-R1: an image reference with no study at all is refused, not stored unanchored", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/image-references")
      .set(auth)
      .send({
        draftId,
        description: "no study claimed",
        sopInstanceUid: INST_A_SINGLE,
        isKeyImage: true,
      });
    expectStatus(res, 409);
    expect(res.body.code).toBe("IMAGE_STUDY_REQUIRED");
  });

  it("D2 non-vacuity: the ownership check really asked the PACS over HTTP", async () => {
    const before = pacs?.hits().length ?? 0;
    const res = await keyImagePost({
      studyInstanceUID: STUDY_A,
      seriesInstanceUID: SERIES_A2,
      sopInstanceUID: INST_A_CINE,
      frameNumber: "3",
      viewer: "ohif",
      sourceType: "VIEWPORT_CAPTURE",
      caption: "proves the lookup",
    });
    expectStatus(res, 201);
    cleanupKeyImageIds.push(res.body?.item?.id);
    const hits = (pacs?.hits() ?? []).slice(before);
    expect(
      hits.some((h) => h === `/dicom-web/studies/${STUDY_A}/series/${SERIES_A2}/instances/${INST_A_CINE}`),
    ).toBe(true);
  });
});
