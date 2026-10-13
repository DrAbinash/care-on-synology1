/**
 * Server-side frozen key image resolution + detach + integrity semantics.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, randomFillSync } from "node:crypto";
import sharp from "sharp";
import { db } from "@workspace/db";
import {
  patientReportsTable,
  patientsTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import * as reportImages from "./reportImages";
import {
  buildObservationCaption,
  detachKeyImagesFromObservation,
  FROZEN_KEY_IMAGE_DIR,
  FROZEN_PRINT_MAX_INLINE_BYTES,
  FROZEN_STORE_MAX_EDGE_PX,
  FROZEN_UNAVAILABLE_NOTICE,
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
  resolveReportPrintKeyImagesDetailed,
} from "./frozenKeyImages";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

const TINY_JPEG = Buffer.from(
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
    const png = await makeNoisyPngOver1_5MB();
    await fs.writeFile(abs, png);
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
    const bad = result.images.find((m) => m.src === FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
    expect(bad).toBeTruthy();
    // The stored words survive; the missing-file notice does not become the caption.
    expect(bad!.caption).toBe("Gone");
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
    expect(images[0].caption).toBe("Corrupt");
    expect(images[0].caption).not.toContain(FROZEN_UNAVAILABLE_NOTICE);
  });

  it("a missing frozen file with no caption invents no words of its own", async () => {
    // The failure state has to obey the same rule as the normal one: an image the
    // radiologist never captioned must print with nothing beneath it. The report
    // banner and the placeholder picture still say the pixels are gone.
    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        imageUrl: `/uploads/radiology-key-images/${randomUUID()}-blank-missing.jpg`,
        thumbnailUrl: `/uploads/radiology-key-images/${randomUUID()}-blank-missing-thumb.jpg`,
        caption: "   ",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        sopInstanceUid: "1.2.3.blank.missing",
        sortOrder: 101,
      })
      .returning();
    createdIds.push(row.id);

    const { images, unavailableCount } = await frozenRowsToPresentationModels([row]);
    expect(unavailableCount).toBe(1);
    expect(images[0].src).toBe(FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
    expect(images[0].caption).toBe("");
    expect(images[0].caption).not.toContain(FROZEN_UNAVAILABLE_NOTICE);
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

    // Defining acceptance: Orthanc renderer hard-fails; frozen evidence must still print.
    const orthancSpy = vi
      .spyOn(reportImages, "resolveDraftKeyImages")
      .mockRejectedValue(new Error("Orthanc unavailable (simulated)"));

    try {
      const result = await resolveDraftPrintKeyImagesDetailed(draft.id);
      expect(result.source).toBe("frozen");
      expect(result.integrityOk).toBe(true);
      expect(result.images).toHaveLength(1);
      expect(result.images[0].src.startsWith("data:image/")).toBe(true);
      expect(result.images[0].caption).toBe("Final frozen");
      expect(orthancSpy).not.toHaveBeenCalled();
    } finally {
      orthancSpy.mockRestore();
    }

    await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, row.id));
    await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draft.id));
  });

  it("missing frozen file never calls Orthanc even when Orthanc would fail", async () => {
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "FINAL",
        finalReportId: 9_900_002,
        studyName: "Frozen missing no Orthanc",
        modality: "MR",
        rawFindings: "x",
        impression: "[]",
      })
      .returning();

    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: draft.id,
        imageUrl: `/uploads/radiology-key-images/${randomUUID()}-gone.jpg`,
        thumbnailUrl: `/uploads/radiology-key-images/${randomUUID()}-gone-thumb.jpg`,
        caption: "Lost evidence",
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        sopInstanceUid: "1.2.840.must.not.hydrate",
      })
      .returning();

    const orthancSpy = vi
      .spyOn(reportImages, "resolveDraftKeyImages")
      .mockResolvedValue([
        {
          src: "data:image/jpeg;base64,ORTHANC_SHOULD_NOT_APPEAR",
          caption: "live pacs",
          displayOrder: 0,
          sopInstanceUid: "1.2.840.must.not.hydrate",
          isKeyImage: true,
          framing: null,
        },
      ]);

    try {
      const result = await resolveDraftPrintKeyImagesDetailed(draft.id);
      expect(result.source).toBe("frozen");
      expect(result.integrityOk).toBe(false);
      expect(result.images).toHaveLength(1);
      expect(result.images[0].src).toBe(FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
      expect(result.images[0].sopInstanceUid).toBeNull();
      expect(result.images[0].src).not.toContain("ORTHANC_SHOULD_NOT_APPEAR");
      expect(orthancSpy).not.toHaveBeenCalled();
    } finally {
      orthancSpy.mockRestore();
    }

    await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, row.id));
    await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draft.id));
  });

  it(">1.5MB valid file still prints after normalization", async () => {
    const name = `${randomUUID()}.png`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, await makeNoisyPngOver1_5MB());
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

// ────────────────────────────────────────────────────────────────────────────
// D-6 — which images a SIGNED report prints.
//
// `resolveReportPrintKeyImagesDetailed` found a draft only through
// `radiology_report_drafts.final_report_id`, which is stamped by
// structuredFinalizeTransaction — behind ff_radiology_structured_final. The
// legacy finalize the clinic actually runs never stamps it (measured on the
// synthetic fixture: report 12 ↔ worklist 1 ↔ draft 88 with
// `final_report_id = NULL`), so the signed document resolved to
// `legacy_orthanc` with no images at all and re-read its pictures from PACS on
// every reprint, while the draft preview the radiologist approved had been
// printing the frozen artifacts from disk.
//
// The recovery reads the binding the legacy path DOES write
// (`radiology_worklist.report_id`) and writes nothing, so a withdrawn signature
// cannot leave a stale stamp behind — which is why the read side is the fix and
// `final_report_id` back-filling on create is not.
// ────────────────────────────────────────────────────────────────────────────
describe.skipIf(!hasDb)("signed-report key image resolution (D-6)", () => {
  const marker = `vitest-d6-${randomUUID().slice(0, 8)}`;
  const LIVE_SENTINEL = "data:image/jpeg;base64,LIVE_PACS_SENTINEL";

  const patientIds: number[] = [];
  const worklistIds: number[] = [];
  const reportIds: number[] = [];
  const draftIds: number[] = [];
  const imageIds: number[] = [];
  const files: string[] = [];

  let p1 = 0;
  let p2 = 0;

  async function patient(tag: string): Promise<number> {
    const [row] = await db
      .insert(patientsTable)
      .values({
        patientId: `MRN-${marker}-${tag}`,
        firstName: "Synthetic",
        lastName: tag,
        dateOfBirth: "1970-01-01",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    patientIds.push(row.id);
    return row.id as number;
  }

  async function signedReport(patientId: number, tag: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-${tag}`,
        type: "radiology",
        patientId,
        testId: 1,
        title: "MRI LS Spine",
        body: `Synthetic findings ${tag}`,
        impression: `Synthetic impression ${tag}`,
        status: "pending_verification",
        signedAt: new Date(),
        ...overrides,
      })
      .returning();
    reportIds.push(row.id);
    return row.id as number;
  }

  async function worklist(opts: { tag: string; patientId: number; reportId: number | null }) {
    const [row] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Synthetic ${opts.tag}`,
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: `1.2.826.vitest.d6.${marker}.${opts.tag}`,
        accessionNumber: `ACC-${marker}-${opts.tag}`,
        patientId: opts.patientId,
        status: "REPORT_FINAL",
        reportId: opts.reportId,
      })
      .returning();
    worklistIds.push(row.id);
    return row.id as number;
  }

  /** A draft with one printable frozen artifact whose bytes exist on disk. */
  async function draftWithFrozenImage(opts: {
    worklistId: number;
    patientId: number;
    caption: string;
    finalReportId?: number | null;
    status?: string;
    /** Omit the file so the artifact reads as lost evidence. */
    writeFile?: boolean;
  }) {
    const name = `${randomUUID()}.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    if (opts.writeFile !== false) {
      await fs.writeFile(abs, TINY_JPEG);
      files.push(abs);
    }
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        worklistId: opts.worklistId,
        patientId: opts.patientId,
        modality: "MR",
        studyName: "D-6 frozen resolution",
        rawFindings: "x",
        impression: "[]",
        status: opts.status ?? "DRAFT",
        finalReportId: opts.finalReportId ?? null,
      })
      .returning();
    draftIds.push(draft.id);

    const [img] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: draft.id,
        imageUrl: `/uploads/radiology-key-images/${name}`,
        thumbnailUrl: `/uploads/radiology-key-images/${name}`,
        caption: opts.caption,
        includeInReport: true,
        sourceType: "VIEWPORT_CAPTURE",
        viewer: "frames",
        sopInstanceUid: `1.2.840.d6.${marker}.${opts.caption.replace(/\s+/g, "")}`,
      })
      .returning();
    imageIds.push(img.id);
    return { draftId: draft.id as number, imageId: img.id as number };
  }

  function liveOrthancSpy() {
    return vi.spyOn(reportImages, "resolveDraftKeyImages").mockResolvedValue([
      {
        src: LIVE_SENTINEL,
        caption: "live pacs",
        displayOrder: 0,
        sopInstanceUid: "1.2.840.d6.live",
        isKeyImage: true,
        framing: null,
      },
    ]);
  }

  beforeAll(async () => {
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    p1 = await patient("A");
    p2 = await patient("B");
  });

  afterAll(async () => {
    for (const id of imageIds) await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, id));
    for (const id of draftIds) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id));
    for (const id of reportIds) await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id));
    for (const id of worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    for (const id of patientIds) await db.delete(patientsTable).where(eq(patientsTable.id, id));
    for (const f of files) await fs.unlink(f).catch(() => undefined);
  });

  it("D6-1 a legacy signed report prints its frozen evidence through the worklist binding", async () => {
    const reportId = await signedReport(p1, "bound");
    const wl = await worklist({ tag: "bound", patientId: p1, reportId });
    const { draftId } = await draftWithFrozenImage({ worklistId: wl, patientId: p1, caption: "Signed frozen" });
    // The exact shape the legacy finalize leaves behind.
    const [row] = await db
      .select({ finalReportId: radiologyReportDraftsTable.finalReportId })
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.id, draftId));
    expect(row.finalReportId).toBeNull();

    const spy = liveOrthancSpy();
    try {
      const result = await resolveReportPrintKeyImagesDetailed([reportId]);
      expect(result.source).toBe("frozen");
      expect(result.integrityOk).toBe(true);
      expect(result.images.map((i) => i.caption)).toEqual(["Signed frozen"]);
      expect(result.images[0].src.startsWith("data:image/")).toBe(true);
      // Case C for a signed document: no live picture joins it, so a reprint
      // cannot show an image that was not there when the report was signed.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("D6-2 a binding that names another patient's report is refused, not followed", async () => {
    const reportId = await signedReport(p1, "xpatient");
    // The queue row points at Patient A's report but belongs to Patient B, and
    // carries a draft with its own frozen image — a lead that must not be
    // followed, because printing it would put Patient B's evidence on Patient
    // A's signed document.
    const wl = await worklist({ tag: "xpatient", patientId: p2, reportId });
    await draftWithFrozenImage({ worklistId: wl, patientId: p2, caption: "Wrong patient decoy" });

    const result = await resolveReportPrintKeyImagesDetailed([reportId]);
    expect(result.source).toBe("legacy_orthanc");
    expect(result.images).toHaveLength(0);
  });

  it("D6-3 a report that is not signed yet still prints frozen evidence plus live references", async () => {
    const reportId = await signedReport(p1, "open", { status: "draft", signedAt: null });
    const wl = await worklist({ tag: "open", patientId: p1, reportId });
    await draftWithFrozenImage({ worklistId: wl, patientId: p1, caption: "Draft frozen" });

    const spy = liveOrthancSpy();
    try {
      const result = await resolveReportPrintKeyImagesDetailed([reportId]);
      expect(result.source).toBe("frozen");
      // #815's other half: an image attached through the picker but not frozen
      // must keep appearing while the document is still being composed.
      expect(result.images.map((i) => i.caption).sort()).toEqual(["Draft frozen", "live pacs"]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("D6-4 the stamped draft wins over the binding when both exist", async () => {
    const reportId = await signedReport(p1, "stamped");
    const wl = await worklist({ tag: "stamped", patientId: p1, reportId });
    // Created FIRST, so it has the LOWER id: if the two lookups were ever
    // ordered the other way round, this one would win on id order alone and the
    // test below would pass for the wrong reason.
    await draftWithFrozenImage({ worklistId: wl, patientId: p1, caption: "Binding decoy" });
    // The same report id, stamped the way structuredFinalizeTransaction stamps
    // it. Both lookups now match, so only precedence can decide the answer.
    await draftWithFrozenImage({
      worklistId: wl,
      patientId: p1,
      caption: "Stamped original",
      finalReportId: reportId,
    });

    const spy = liveOrthancSpy();
    try {
      const result = await resolveReportPrintKeyImagesDetailed([reportId]);
      expect(result.images.map((i) => i.caption)).toEqual(["Stamped original"]);

      // And a report with no stamp at all still resolves through the binding,
      // so the two lookups cannot shadow each other.
      const unbound = await signedReport(p1, "binding-only");
      const unboundWl = await worklist({ tag: "binding-only", patientId: p1, reportId: unbound });
      await draftWithFrozenImage({ worklistId: unboundWl, patientId: p1, caption: "Binding only" });
      const viaBinding = await resolveReportPrintKeyImagesDetailed([unbound]);
      expect(viaBinding.images.map((i) => i.caption)).toEqual(["Binding only"]);

      // A draft stamped against a different (here, synthetic) report id is found
      // by the stamped lookup wherever the queue binding lives.
      const stamp = 9_800_000 + (reportId % 100_000);
      await draftWithFrozenImage({
        worklistId: unboundWl,
        patientId: p1,
        caption: "Other stamp",
        finalReportId: stamp,
      });
      const viaStamp = await resolveReportPrintKeyImagesDetailed([stamp]);
      expect(viaStamp.images.map((i) => i.caption)).toContain("Other stamp");
    } finally {
      spy.mockRestore();
    }
  });

  it("D6-6 one open member of a multi-row print keeps the live leg", async () => {
    // The print route passes an amendment chain (root, resolved, requested). If
    // any member is still open the document is being composed, so unanimity is
    // required before the live leg is suppressed — otherwise an attached image
    // that is not frozen yet would vanish from a reprint of a half-corrected
    // report, which is the #815 failure case B exists to prevent.
    const signedId = await signedReport(p1, "chain-signed");
    const signedWl = await worklist({ tag: "chain-signed", patientId: p1, reportId: signedId });
    await draftWithFrozenImage({ worklistId: signedWl, patientId: p1, caption: "Chain frozen" });

    const openId = await signedReport(p1, "chain-open", { status: "draft", signedAt: null });
    const openWl = await worklist({ tag: "chain-open", patientId: p1, reportId: openId });
    await draftWithFrozenImage({ worklistId: openWl, patientId: p1, caption: "Chain open" });

    const spy = liveOrthancSpy();
    try {
      const result = await resolveReportPrintKeyImagesDetailed([signedId, openId]);
      expect(result.source).toBe("frozen");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result.images.map((i) => i.src)).toContain(LIVE_SENTINEL);
    } finally {
      spy.mockRestore();
    }
  });

  it("D6-5 a signed report with lost frozen bytes prints the placeholder and never Orthanc", async () => {
    const reportId = await signedReport(p1, "lost");
    const wl = await worklist({ tag: "lost", patientId: p1, reportId });
    await draftWithFrozenImage({
      worklistId: wl,
      patientId: p1,
      caption: "Lost evidence",
      writeFile: false,
    });

    const spy = liveOrthancSpy();
    try {
      const result = await resolveReportPrintKeyImagesDetailed([reportId]);
      expect(result.source).toBe("frozen");
      expect(result.integrityOk).toBe(false);
      expect(result.unavailableFrozenCount).toBe(1);
      expect(result.images[0].src).toBe(FROZEN_UNAVAILABLE_PLACEHOLDER_SRC);
      expect(result.images[0].src).not.toContain(LIVE_SENTINEL);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
