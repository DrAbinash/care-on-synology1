/**
 * Request-level tests for the PACS image picker's attach leg:
 * POST /api/radiology/report-generator/key-images/from-pacs.
 *
 * This is the endpoint that restores "SELECT IMAGES FROM PACS": CARE fetches the
 * picture from Orthanc itself and freezes it into the table print/PDF already
 * builds from. The proofs that matter here are clinical, not cosmetic —
 *   • the stored row carries the identity the PACS confirmed, not the identity
 *     the browser asserted;
 *   • an image of a different study is refused and leaves nothing behind;
 *   • a multiframe object can be attached frame by frame;
 *   • nothing needs OHIF, and a PACS that is down cannot fabricate a row.
 *
 * The PACS is the same test double the D2 suites use, over real HTTP, so the
 * route reaches it exactly the way it reaches the NAS.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
  radiologyImageReferencesTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { FROZEN_KEY_IMAGE_DIR, resolveKeyImageDiskPath } from "../lib/frozenKeyImages";
import { startMockDicomWeb, type MockDicomWeb } from "../testSupport/mockDicomWeb";

const MRI_STUDY = "1.2.826.0.1.3680043.9.7701.3";
const MRI_SERIES = "1.2.826.0.1.3680043.9.7701.3.1";
const MRI_SINGLE = "1.2.826.0.1.3680043.9.7701.30101";
const MRI_CINE = "1.2.826.0.1.3680043.9.7701.30102";
/** A second single-frame image, never frozen by this suite, so a reference to it
 *  is provably uncovered by a frozen row. */
const MRI_EXTRA_SINGLE = "1.2.826.0.1.3680043.9.7701.30103";
/** A different study, different patient, served by the same PACS. */
const OTHER_STUDY = "1.2.826.0.1.3680043.9.7701.4";
const OTHER_SERIES = "1.2.826.0.1.3680043.9.7701.4.1";
const OTHER_SOP = "1.2.826.0.1.3680043.9.7701.40101";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("PACS image picker — attach from Orthanc", () => {
  let app: Express;
  let pacs: MockDicomWeb;
  const marker = `pip-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let worklistId = 0;
  let draftId = 0;
  let otherDraftId = 0;
  const createdImageIds: number[] = [];
  const writtenFiles: string[] = [];
  const prevOrthanc = process.env.ORTHANC_INTERNAL_URL;
  let jpeg: Buffer;

  const body = (over: Record<string, unknown> = {}) => ({
    draftId,
    studyId: worklistId,
    accessionNumber: `PI-${marker}`,
    studyInstanceUid: MRI_STUDY,
    seriesInstanceUid: MRI_SERIES,
    sopInstanceUid: MRI_SINGLE,
    instanceNumber: 12,
    seriesDescription: "T2 TSE AXIAL",
    modality: "MR",
    ...over,
  });

  const attach = async (payload: Record<string, unknown>) => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images/from-pacs")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    const id = (res.body as { item?: { id?: number } })?.item?.id;
    if (id) createdImageIds.push(id);
    return res;
  };

  /** Any file this suite wrote, so a refused attach can be proved to have left
   *  nothing on the print volume. */
  const diskFiles = async () => (await fs.readdir(FROZEN_KEY_IMAGE_DIR).catch(() => [] as string[]));

  beforeAll(async () => {
    app = await createTestApp();
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    // A decodable 60x40 JPEG — the route re-encodes what the PACS renders, so the
    // double has to answer with something an image decoder accepts.
    jpeg = await sharp(Buffer.alloc(60 * 40 * 3, 0x20), { raw: { width: 60, height: 40, channels: 3 } })
      .jpeg()
      .toBuffer();

    pacs = await startMockDicomWeb(
      {
        [MRI_STUDY]: {
          [MRI_SERIES]: [
            { sopUid: MRI_SINGLE },
            { sopUid: MRI_CINE, numberOfFrames: 8 },
            { sopUid: MRI_EXTRA_SINGLE },
          ],
        },
        [OTHER_STUDY]: { [OTHER_SERIES]: [{ sopUid: OTHER_SOP }] },
      },
      { renderedJpeg: jpeg },
    );
    process.env.ORTHANC_INTERNAL_URL = pacs.url;

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Picks ${marker}`,
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
        patientName: `Pick ${marker}`,
        modality: "MR",
        studyDescription: "Brain MRI",
        studyDate: new Date().toISOString().slice(0, 10),
        accessionNumber: `PI-${marker}`,
        studyInstanceUID: MRI_STUDY,
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: "Brain MRI",
        modality: "MR",
        worklistId,
        studyId: worklistId,
        rawFindings: "x",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;

    const [other] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: "Another patient",
        modality: "CT",
        rawFindings: "y",
        impression: "[]",
      })
      .returning();
    otherDraftId = other.id;
  });

  afterAll(async () => {
    process.env.ORTHANC_INTERNAL_URL = prevOrthanc;
    await pacs?.close();
    if (createdImageIds.length > 0) {
      const rows = await db
        .select({ imageUrl: radiologyReportKeyImagesTable.imageUrl })
        .from(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, createdImageIds));
      await db
        .delete(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, createdImageIds));
      for (const row of rows) {
        const disk = resolveKeyImageDiskPath(row.imageUrl);
        if (disk) await fs.unlink(disk).catch(() => undefined);
        const stem = path.parse(disk ?? "").name;
        if (stem) {
          for (const f of await diskFiles()) {
            if (f.startsWith(stem)) await fs.unlink(path.join(FROZEN_KEY_IMAGE_DIR, f)).catch(() => undefined);
          }
        }
      }
    }
    for (const f of writtenFiles) {
      await fs.unlink(path.join(FROZEN_KEY_IMAGE_DIR, f)).catch(() => undefined);
    }
    if (draftId) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    if (otherDraftId) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, otherDraftId));
    if (worklistId) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("attaches a picture straight from Orthanc, with the identity the PACS confirmed", async () => {
    const before = await diskFiles();
    const res = await attach(body());
    expect(res.status).toBe(201);
    const item = res.body.item;
    expect(item).toMatchObject({
      sourceType: "DICOM",
      includeInReport: true,
      studyInstanceUid: MRI_STUDY,
      seriesInstanceUid: MRI_SERIES,
      sopInstanceUid: MRI_SINGLE,
      caption: "T2 TSE AXIAL",
      modality: "MR",
    });
    // A single-frame object is stored with NO frame claim, so later rendering
    // cannot ask Orthanc for a frame that does not exist.
    expect(item.frameNumber).toBeNull();

    const disk = resolveKeyImageDiskPath(item.imageUrl);
    expect(disk).not.toBeNull();
    const stat = await fs.stat(disk!);
    expect(stat.size).toBeGreaterThan(0);
    writtenFiles.push(...(await diskFiles()).filter((f) => !before.includes(f)));

    // Pixels came from the PACS, addressed by the exact instance chosen.
    expect(pacs.hits().some((h) => h.includes(`/instances/${MRI_SINGLE}/rendered`))).toBe(true);
  });

  it("keeps the chosen frame of a multiframe object", async () => {
    const res = await attach(body({ sopInstanceUid: MRI_CINE, frameNumber: 5, instanceNumber: 13 }));
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ sopInstanceUid: MRI_CINE, frameNumber: 5 });
    expect(pacs.hits().some((h) => h.includes(`/instances/${MRI_CINE}/frames/5/rendered`))).toBe(true);
  });

  it("refuses an image that is not in this report's study, and stores nothing", async () => {
    const before = await diskFiles();
    const res = await attach(body({ studyInstanceUid: OTHER_STUDY, seriesInstanceUid: OTHER_SERIES, sopInstanceUid: OTHER_SOP }));
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/study|not in/i);
    const rows = await db
      .select({ id: radiologyReportKeyImagesTable.id })
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.draftId, draftId));
    expect(rows.some((r) => r.id === res.body?.item?.id)).toBe(false);
    expect((await diskFiles()).filter((f) => !before.includes(f))).toEqual([]);
  });

  it("refuses an SOP this study does not contain, and leaves no orphan file", async () => {
    // The study claim is correct here, so the draft binding cannot catch it — the
    // refusal comes from the PACS saying it has never heard of that object. This
    // is the arm that fails if the identity verification is removed.
    const before = await diskFiles();
    const res = await attach(body({ sopInstanceUid: "1.2.826.0.1.3680043.9.7701.99999" }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMAGE_SOP_NOT_IN_STUDY");
    expect((await diskFiles()).filter((f) => !before.includes(f))).toEqual([]);
  });

  it("refuses to attach when the PACS is unreachable, and creates no row", async () => {
    const countBefore = (await db
      .select({ id: radiologyReportKeyImagesTable.id })
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.draftId, draftId))).length;
    pacs.setMode("down");
    try {
      const res = await attach(body({ sopInstanceUid: MRI_CINE, frameNumber: 2 }));
      expect([409, 502]).toContain(res.status);
    } finally {
      pacs.setMode("serve");
    }
    const countAfter = (await db
      .select({ id: radiologyReportKeyImagesTable.id })
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.draftId, draftId))).length;
    expect(countAfter).toBe(countBefore);
  });

  it("will not attach the same frame twice", async () => {
    const first = await attach(body({ sopInstanceUid: MRI_CINE, frameNumber: 3 }));
    expect(first.status).toBe(201);
    const again = await attach(body({ sopInstanceUid: MRI_CINE, frameNumber: 3 }));
    expect(again.status).toBe(409);
    // …but the next frame of the same object is a different picture.
    const nextFrame = await attach(body({ sopInstanceUid: MRI_CINE, frameNumber: 4 }));
    expect(nextFrame.status).toBe(201);
  });

  it("refuses a finalized report — the delivered document's images are what was signed", async () => {
    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL", finalReportId: 997701 })
      .where(eq(radiologyReportDraftsTable.id, otherDraftId));
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images/from-pacs")
      .set("Authorization", `Bearer ${token}`)
      .send(body({ draftId: otherDraftId }));
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/finalized/i);
    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "DRAFT", finalReportId: null })
      .where(eq(radiologyReportDraftsTable.id, otherDraftId));
  });

  it("rejects a body that is not a complete DICOM reference", async () => {
    const res = await attach(body({ sopInstanceUid: undefined }));
    expect(res.status).toBe(400);
  });

  it("prints a reference image the frozen rows do not cover, even with the PACS down", async () => {
    // The mixed case that used to lose pictures: a report carrying both a frozen
    // attach from this picker and an image-reference from the older picker must
    // print BOTH, not silently drop the reference — while a reference whose own
    // picture is already frozen still prints once, from disk.
    const [uncovered] = await db
      .insert(radiologyImageReferencesTable)
      .values({
        draftId,
        description: "Older picker image",
        studyInstanceUid: MRI_STUDY,
        seriesInstanceUid: MRI_SERIES,
        sopInstanceUid: MRI_EXTRA_SINGLE,
        frameNumber: null,
        displayOrder: 0,
      })
      .returning();
    const [covered] = await db
      .insert(radiologyImageReferencesTable)
      .values({
        draftId,
        description: "Already frozen above",
        studyInstanceUid: MRI_STUDY,
        seriesInstanceUid: MRI_SERIES,
        sopInstanceUid: MRI_SINGLE,
        frameNumber: null,
        displayOrder: 1,
      })
      .returning();
    const { resolveDraftPrintKeyImagesDetailed } = await import("../lib/frozenKeyImages");

    const offlineFirst = await resolveDraftPrintKeyImagesDetailed(draftId);
    expect(offlineFirst.source).toBe("frozen");
    const captions = offlineFirst.images.map((i) => i.caption);
    // The reference the frozen rows do not cover is no longer dropped.
    expect(captions).toContain("Older picker image");
    // …and the one they do cover is not printed a second time.
    expect(captions.filter((c) => c === "Already frozen above")).toHaveLength(0);
    expect(offlineFirst.images.filter((i) => i.sopInstanceUid === MRI_SINGLE)).toHaveLength(1);

    pacs.setMode("down");
    try {
      const withPacsDown = await resolveDraftPrintKeyImagesDetailed(draftId);
      expect(withPacsDown.images.length).toBe(offlineFirst.images.length);
      expect(withPacsDown.integrityOk).toBe(true);
    } finally {
      pacs.setMode("serve");
    }

    await db
      .delete(radiologyImageReferencesTable)
      .where(inArray(radiologyImageReferencesTable.id, [uncovered.id, covered.id]));
  });

  it("keeps a SIGNED report off the PACS entirely — #815's guarantee survives the change", async () => {
    // Same mixed draft as above, but finalized: the delivered document must print
    // from frozen evidence alone, so a reference that would need live pixels is
    // left out rather than reaching Orthanc.
    const [ref] = await db
      .insert(radiologyImageReferencesTable)
      .values({
        draftId,
        description: "Live only",
        studyInstanceUid: MRI_STUDY,
        seriesInstanceUid: MRI_SERIES,
        sopInstanceUid: MRI_EXTRA_SINGLE,
        frameNumber: null,
        displayOrder: 0,
      })
      .returning();
    const { resolveDraftPrintKeyImagesDetailed } = await import("../lib/frozenKeyImages");

    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL", finalReportId: 997702 })
      .where(eq(radiologyReportDraftsTable.id, draftId));
    pacs.setMode("down");
    try {
      const result = await resolveDraftPrintKeyImagesDetailed(draftId);
      expect(result.source).toBe("frozen");
      expect(result.images.map((i) => i.caption)).not.toContain("Live only");
      expect(result.images.every((i) => i.src.startsWith("data:image/"))).toBe(true);
    } finally {
      pacs.setMode("serve");
      await db
        .update(radiologyReportDraftsTable)
        .set({ status: "DRAFT", finalReportId: null })
        .where(eq(radiologyReportDraftsTable.id, draftId));
      await db.delete(radiologyImageReferencesTable).where(eq(radiologyImageReferencesTable.id, ref.id));
    }
  });
});
