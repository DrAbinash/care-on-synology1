/**
 * Request-level tests for frozen key-image API (finalize lock, MIME, detach, auth, provenance).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, randomFillSync } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { FROZEN_KEY_IMAGE_DIR } from "../lib/frozenKeyImages";

const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

async function makeNoisyPngOver1_5MB(): Promise<Buffer> {
  const width = 800;
  const height = 800;
  const raw = Buffer.alloc(width * height * 3);
  randomFillSync(raw);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("frozen key-images API", () => {
  let app: Express;
  const marker = `fki-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let draftId = 0;
  let otherDraftId = 0;
  let imageId = 0;
  let otherImageId = 0;
  let userId = 0;
  const cleanupImageIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `FKI ${marker}`,
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

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: "KI API test",
        modality: "MR",
        rawFindings: "x",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;

    const [other] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: "Other draft",
        modality: "CT",
        rawFindings: "y",
        impression: "[]",
      })
      .returning();
    otherDraftId = other.id;

    const [otherImg] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: otherDraftId,
        imageUrl: `/uploads/radiology-key-images/${randomUUID()}.jpg`,
        thumbnailUrl: `/uploads/radiology-key-images/${randomUUID()}.jpg`,
        caption: "other",
        sourceType: "UPLOAD",
      })
      .returning();
    otherImageId = otherImg.id;
    cleanupImageIds.push(otherImageId);
  });

  afterAll(async () => {
    for (const id of cleanupImageIds) {
      await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, id));
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
    if (otherDraftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, otherDraftId));
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("rejects SVG / invalid MIME", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .attach("image", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), {
        filename: "x.svg",
        contentType: "image/svg+xml",
      });
    expect([400, 500]).toContain(res.status);
  });

  it("rejects malformed viewportSnapshotJson", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("viewportSnapshotJson", "{broken")
      .attach("image", JPEG_1X1, { filename: "cap.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/viewportSnapshotJson/i);
  });

  it("rejects invalid DICOM UID / viewer", async () => {
    const badUid = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("studyInstanceUID", "not a uid!!!")
      .attach("image", JPEG_1X1, { filename: "cap.jpg", contentType: "image/jpeg" });
    expect(badUid.status).toBe(400);

    const badViewer = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("viewer", "evil")
      .attach("image", JPEG_1X1, { filename: "cap.jpg", contentType: "image/jpeg" });
    expect(badViewer.status).toBe(400);
  });

  it("accepts JPEG viewport capture with provenance and normalizes to jpg", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("sourceType", "VIEWPORT_CAPTURE")
      .field("caption", "L4-L5: disc bulge.")
      .field("studyInstanceUID", "1.2.840.10008.1.2.1")
      .field("seriesInstanceUID", "1.2.840.10008.1.2.2")
      .field("sopInstanceUID", "1.2.840.10008.1.2.3")
      .field("frameNumber", "4")
      .field("viewer", "frames")
      .field(
        "viewportSnapshotJson",
        JSON.stringify({ version: 1, zoom: 1.5, panX: 10, panY: -5, brightness: 110, contrast: 100 }),
      )
      .field("observationId", "obs-1")
      .attach("image", JPEG_1X1, { filename: "cap.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.item?.sourceType).toBe("VIEWPORT_CAPTURE");
    expect(res.body.item?.observationId).toBe("obs-1");
    expect(res.body.item?.includeInReport).toBe(true);
    expect(res.body.item?.studyInstanceUid).toBe("1.2.840.10008.1.2.1");
    expect(res.body.item?.imageUrl).toMatch(/^\/uploads\/radiology-key-images\/.+\.jpg$/);
    imageId = res.body.item.id;
    cleanupImageIds.push(imageId);

    const disk = path.join(FROZEN_KEY_IMAGE_DIR, path.basename(res.body.item.imageUrl));
    await expect(fs.access(disk)).resolves.toBeUndefined();
  });

  it("accepts large PNG and stores normalized printable JPEG", async () => {
    const big = await makeNoisyPngOver1_5MB();
    expect(big.length).toBeGreaterThan(1_500_000);

    const res = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("sourceType", "VIEWPORT_CAPTURE")
      .field("viewer", "frames")
      .field("caption", "large")
      .attach("image", big, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    cleanupImageIds.push(res.body.item.id);
    expect(res.body.item.imageUrl).toMatch(/\.jpg$/);
    const disk = path.join(FROZEN_KEY_IMAGE_DIR, path.basename(res.body.item.imageUrl));
    const st = await fs.stat(disk);
    expect(st.size).toBeLessThan(2_500_000);
    expect(st.size).toBeGreaterThan(5000);
  });

  it("GET unknown draftId returns 404", async () => {
    const res = await request(app)
      .get("/api/radiology/report-generator/key-images?draftId=999999991")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("reorder rejects foreign orderedIds", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({ draftId, orderedIds: [imageId, otherImageId] });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/orderedIds/i);
  });

  it("detach observation preserves row", async () => {
    const res = await request(app)
      .post("/api/radiology/report-generator/key-images/detach-observation")
      .set("Authorization", `Bearer ${token}`)
      .send({ draftId, observationId: "obs-1" });
    expect(res.status).toBe(200);
    expect(res.body.detached).toBeGreaterThanOrEqual(1);
    const get = await request(app)
      .get(`/api/radiology/report-generator/key-images?draftId=${draftId}`)
      .set("Authorization", `Bearer ${token}`);
    const row = get.body.items.find((i: { id: number }) => i.id === imageId);
    expect(row.observationId).toBeNull();
  });

  it("blocks mutations after finalize and keeps image readable", async () => {
    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL", finalReportId: 999001 })
      .where(eq(radiologyReportDraftsTable.id, draftId));

    const put = await request(app)
      .put(`/api/radiology/report-generator/key-images/${imageId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ caption: "hacked" });
    expect(put.status).toBe(409);

    const del = await request(app)
      .delete(`/api/radiology/report-generator/key-images/${imageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(409);

    const post = await request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .attach("image", JPEG_1X1, { filename: "cap2.jpg", contentType: "image/jpeg" });
    expect(post.status).toBe(409);

    const get = await request(app)
      .get(`/api/radiology/report-generator/key-images?draftId=${draftId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.items.some((i: { id: number }) => i.id === imageId)).toBe(true);

    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "DRAFT", finalReportId: null })
      .where(eq(radiologyReportDraftsTable.id, draftId));
  });

  it("PUT/DELETE cannot mutate another draft's finalized key image by id alone", async () => {
    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "FINAL", finalReportId: 999002 })
      .where(eq(radiologyReportDraftsTable.id, otherDraftId));

    const put = await request(app)
      .put(`/api/radiology/report-generator/key-images/${otherImageId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ caption: "cross-draft hack" });
    expect(put.status).toBe(409);

    const del = await request(app)
      .delete(`/api/radiology/report-generator/key-images/${otherImageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(409);

    await db
      .update(radiologyReportDraftsTable)
      .set({ status: "DRAFT", finalReportId: null })
      .where(eq(radiologyReportDraftsTable.id, otherDraftId));
  });
});
