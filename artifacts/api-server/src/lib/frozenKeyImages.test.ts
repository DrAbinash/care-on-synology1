/**
 * Server-side frozen key image resolution + detach semantics.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { radiologyReportDraftsTable, radiologyReportKeyImagesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  buildObservationCaption,
  detachKeyImagesFromObservation,
  FROZEN_KEY_IMAGE_DIR,
  frozenRowsToPresentationModels,
  isSafeKeyImageFilename,
  listDraftFrozenKeyImages,
  resolveDraftPrintKeyImages,
  resolveKeyImageDiskPath,
} from "./frozenKeyImages";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

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

  it("report-level image exists without observation; includeInReport defaults true", async () => {
    const name = `${randomUUID()}.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    // Minimal JPEG (1x1)
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
      "base64",
    );
    await fs.writeFile(abs, jpeg);
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

    const models = await frozenRowsToPresentationModels([row]);
    expect(models.length).toBe(1);
    expect(models[0].src.startsWith("data:image/")).toBe(true);
    expect(models[0].caption).toBe("Report level");
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
    const models = await resolveDraftPrintKeyImages(draftId);
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models.every((m) => m.src.startsWith("data:image/"))).toBe(true);
  });

  it("excluded images are not printed", async () => {
    const rows = await listDraftFrozenKeyImages(draftId);
    const excluded = { ...rows[0], includeInReport: false };
    const models = await frozenRowsToPresentationModels([excluded]);
    expect(models).toEqual([]);
    const included = await frozenRowsToPresentationModels([rows[0]]);
    expect(included.length).toBe(1);
  });
});
