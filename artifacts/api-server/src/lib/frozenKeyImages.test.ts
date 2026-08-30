/**
 * Server-side frozen key image resolution + detach + integrity semantics.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@workspace/db";
import { radiologyReportDraftsTable, radiologyReportKeyImagesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  buildObservationCaption,
  detachKeyImagesFromObservation,
  FROZEN_KEY_IMAGE_DIR,
  FROZEN_PRINT_MAX_INLINE_BYTES,
  FROZEN_STORE_MAX_EDGE_PX,
  FROZEN_UNAVAILABLE_CAPTION_PREFIX,
  FROZEN_UNAVAILABLE_PLACEHOLDER_SRC,
  frozenRowsToPresentationModels,
  isSafeKeyImageFilename,
  listDraftFrozenKeyImages,
  normalizeKeyImageForPrint,
  parseAnnotationMetadataJson,
  parseCapturedAt,
  parseViewer,
  parseViewportSnapshotJson,
  resolveDraftPrintKeyImagesDetailed,
  resolveKeyImageDiskPath,
} from "./frozenKeyImages";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

describe("frozenKeyImages helpers", () => {
  it("buildObservationCaption matches client caption rules", () => {
    expect(
      buildObservationCaption({
        level: "L4-L5",
        lastRenderedFindings: "Broad-based posterior disc bulge",
      }),
    ).toBe("L4-L5: Broad-based posterior disc bulge.");
  });

  it("resolveKeyImageDiskPath rejects traversal", () => {
    expect(resolveKeyImageDiskPath("/uploads/radiology-key-images/../../etc/passwd")).toBeNull();
    expect(resolveKeyImageDiskPath("/uploads/radiology-key-images/ok.jpg")).toContain("ok.jpg");
    expect(isSafeKeyImageFilename("x.webp")).toBe(true);
  });

  it("validates viewport snapshot / annotation / viewer / capturedAt", () => {
    expect(parseViewportSnapshotJson("{not json").ok).toBe(false);
    expect(parseViewportSnapshotJson(JSON.stringify({ version: 2, zoom: 1 })).ok).toBe(false);
    expect(parseViewportSnapshotJson(JSON.stringify({ version: 1, zoom: 1.2 })).ok).toBe(true);
    expect(parseAnnotationMetadataJson("[]").ok).toBe(true);
    expect(parseAnnotationMetadataJson("nope").ok).toBe(false);
    expect(parseViewer("frames").ok).toBe(true);
    expect(parseViewer("dicom").ok).toBe(false);
    expect(parseCapturedAt("not-a-date").ok).toBe(false);
    expect(parseCapturedAt("2024-01-01T00:00:00.000Z").ok).toBe(true);
  });

  it("normalizes oversized images under print budget", async () => {
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const name = `${randomUUID()}.png`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    // Large-ish RGB buffer → well over 1.5 MB as PNG before normalize
    await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .png()
      .toFile(abs);
    const before = (await fs.stat(abs)).size;
    expect(before).toBeGreaterThan(1_500_000);

    const norm = await normalizeKeyImageForPrint(abs);
    expect(norm.filename.endsWith(".jpg")).toBe(true);
    expect(Math.max(norm.width, norm.height)).toBeLessThanOrEqual(FROZEN_STORE_MAX_EDGE_PX);
    expect(norm.bytes).toBeLessThanOrEqual(FROZEN_PRINT_MAX_INLINE_BYTES);
    expect(norm.bytes).toBeGreaterThan(1000);
    await fs.unlink(norm.absPath).catch(() => undefined);
  });
});

describe.skipIf(!hasDb)("frozenKeyImages DB", () => {
  let draftId = 0;
  const createdIds: number[] = [];
  const files: string[] = [];

  beforeAll(async () => {
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: "Frozen KI test",
        modality: "MR",
        rawFindings: "test",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, id));
    }
    for (const f of files) {
      await fs.unlink(f).catch(() => undefined);
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
  });

  it("report-level image exists without observation; includeInReport defaults true", async () => {
    const name = `${randomUUID()}.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, TINY_JPEG);
    files.push(abs);

    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        imageUrl: `/uploads/radiology-key-images/${name}`,
        thumbnailUrl: `/uploads/radiology-key-images/${name}`,
        caption: "Report level",
        sourceType: "VIEWPORT_CAPTURE",
        studyInstanceUid: "1.2.3",
        seriesInstanceUid: "1.2.3.4",
        sopInstanceUid: "1.2.3.4.5",
        frameNumber: 3,
        viewer: "frames",
        viewportSnapshotJson: JSON.stringify({ version: 1, zoom: 1.2, panX: 0, panY: 0, brightness: 100, contrast: 100 }),
        capturedAt: new Date(),
      })
      .returning();
    createdIds.push(row.id);

    expect(row.observationId).toBeNull();
    expect(row.includeInReport).toBe(true);
    expect(row.sourceType).toBe("VIEWPORT_CAPTURE");

    const listed = await listDraftFrozenKeyImages(draftId);
    expect(listed.some((r) => r.id === row.id)).toBe(true);

    const { images, unavailableCount } = await frozenRowsToPresentationModels([row]);
    expect(unavailableCount).toBe(0);
    expect(images.length).toBe(1);
    expect(images[0].src.startsWith("data:image/")).toBe(true);
    expect(images[0].caption).toBe("Report level");
  });

  it("attach/detach observation without destroying file", async () => {
    const rows = await listDraftFrozenKeyImages(draftId);
    const row = rows[0];
    expect(row).toBeTruthy();

    await db
      .update(radiologyReportKeyImagesTable)
      .set({ observationId: "obs-abc" })
      .where(eq(radiologyReportKeyImagesTable.id, row.id));

    const detached = await detachKeyImagesFromObservation({
      draftId,
      observationId: "obs-abc",
    });
    expect(detached).toBeGreaterThanOrEqual(1);

    const [again] = await db
      .select()
      .from(radiologyReportKeyImagesTable)
      .where(eq(radiologyReportKeyImagesTable.id, row.id));
    expect(again.observationId).toBeNull();
    const disk = resolveKeyImageDiskPath(again.imageUrl);
    expect(disk).toBeTruthy();
    await expect(fs.access(disk!)).resolves.toBeUndefined();
  });

  it("print resolver prefers frozen artifacts over Orthanc refs", async () => {
    const result = await resolveDraftPrintKeyImagesDetailed(draftId);
    expect(result.source).toBe("frozen");
    expect(result.integrityOk).toBe(true);
    expect(result.images.length).toBeGreaterThanOrEqual(1);
    expect(result.images.every((m) => m.src.startsWith("data:image/"))).toBe(true);
  });

  it("excluded images are not printed", async () => {
    const rows = await listDraftFrozenKeyImages(draftId);
    const excluded = { ...rows[0], includeInReport: false };
    const models = await frozenRowsToPresentationModels([excluded]);
    expect(models.images).toEqual([]);
    expect(models.unavailableCount).toBe(0);
    const included = await frozenRowsToPresentationModels([rows[0]]);
    expect(included.images.length).toBe(1);
  });

  it("missing frozen file yields explicit placeholder — never Orthanc fallback", async () => {
    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        imageUrl: `/uploads/radiology-key-images/${randomUUID()}-missing.jpg`,
        thumbnailUrl: `/uploads/radiology-key-images/${randomUUID()}-missing-thumb.jpg`,
        caption: "Gone",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        sopInstanceUid: "1.2.840.should.not.hydrate",
        sortOrder: 99,
      })
      .returning();
    createdIds.push(row.id);

    const result = await resolveDraftPrintKeyImagesDetailed(draftId);
    expect(result.source).toBe("frozen");
    expect(result.integrityOk).toBe(false);
    expect(result.unavailableFrozenCount).toBeGreaterThanOrEqual(1);
    const bad = result.images.find((m) => m.caption.includes(FROZEN_UNAVAILABLE_CAPTION_PREFIX));
    expect(bad).toBeTruthy();
    expect(bad!.src).toBe(FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
    expect(bad!.sopInstanceUid).toBeNull();
  });

  it("corrupt frozen file cannot silently disappear", async () => {
    const name = `${randomUUID()}-corrupt.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, Buffer.from("not-an-image-at-all"));
    files.push(abs);
    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        imageUrl: `/uploads/radiology-key-images/${name}`,
        thumbnailUrl: `/uploads/radiology-key-images/${name}`,
        caption: "Corrupt",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        sopInstanceUid: "1.2.3.corrupt",
        sortOrder: 100,
      })
      .returning();
    createdIds.push(row.id);

    const { images, unavailableCount } = await frozenRowsToPresentationModels([row]);
    expect(images.length).toBe(1);
    expect(unavailableCount).toBe(1);
    expect(images[0].src).toBe(FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
    expect(images[0].sopInstanceUid).toBeNull();
    expect(images[0].caption).toContain(FROZEN_UNAVAILABLE_CAPTION_PREFIX);
  });

  it("Phase 1 acceptance: finalized draft prints frozen image without Orthanc", async () => {
    const name = `${randomUUID()}-final.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, TINY_JPEG);
    files.push(abs);

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "FINAL",
        finalReportId: 9_900_001,
        studyName: "Frozen finalize acceptance",
        modality: "MR",
        rawFindings: "x",
        impression: "[]",
      })
      .returning();

    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: draft.id,
        imageUrl: `/uploads/radiology-key-images/${name}`,
        thumbnailUrl: `/uploads/radiology-key-images/${name}`,
        caption: "Final frozen",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        viewer: "frames",
      })
      .returning();

    const result = await resolveDraftPrintKeyImagesDetailed(draft.id);
    expect(result.source).toBe("frozen");
    expect(result.integrityOk).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].src.startsWith("data:image/")).toBe(true);
    expect(result.images[0].caption).toBe("Final frozen");

    await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, row.id));
    await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draft.id));
  });

  it(">1.5MB valid file still prints after normalization", async () => {
    const name = `${randomUUID()}.png`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await sharp({
      create: {
        width: 2200,
        height: 1600,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toFile(abs);
    expect((await fs.stat(abs)).size).toBeGreaterThan(1_500_000);

    const norm = await normalizeKeyImageForPrint(abs);
    files.push(norm.absPath);

    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        imageUrl: `/uploads/radiology-key-images/${norm.filename}`,
        thumbnailUrl: `/uploads/radiology-key-images/${norm.filename}`,
        caption: "Large normalized",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        sortOrder: 50,
      })
      .returning();
    createdIds.push(row.id);

    const { images, unavailableCount } = await frozenRowsToPresentationModels([row]);
    expect(unavailableCount).toBe(0);
    expect(images).toHaveLength(1);
    expect(images[0].src.startsWith("data:image/jpeg")).toBe(true);
  });
});
