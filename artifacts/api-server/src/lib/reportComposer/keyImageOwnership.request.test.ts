/**
 * Request/DB-level ownership checks for SELECTED_IMAGES key-image resolution.
 * Skips when DATABASE_URL is unset — do not treat skip as pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { FROZEN_KEY_IMAGE_DIR } from "../frozenKeyImages";
import { resolveSelectedKeyImagesForCompose } from "./resolveSelectedKeyImages";
import { parseComposerSnapshot } from "./types";
import type { KeyImageOwnershipContext } from "./keyImageOwnership";

const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("SELECTED_IMAGES ownership (DB)", () => {
  const marker = `own-${randomUUID().slice(0, 8)}`;
  const writtenFiles: string[] = [];
  const imageIds: number[] = [];
  let draftId = 0;
  let otherDraftId = 0;
  let ownedImageId = 0;
  let otherPatientImageId = 0;
  let legacyDraftOnlyImageId = 0;
  let nullIdentityImageId = 0;

  const ownership: KeyImageOwnershipContext = {
    draftId: 0,
    studyId: 50,
    worklistId: 900,
    patientId: 7,
    draftStudyId: 50,
    draftWorklistId: 900,
    draftPatientId: 7,
  };

  async function writeKeyImageFile(): Promise<string> {
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const name = `${marker}-${randomUUID()}.jpg`;
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, JPEG_1X1);
    writtenFiles.push(abs);
    return `/uploads/radiology-key-images/${name}`;
  }

  beforeAll(async () => {
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: `Own ${marker}`,
        modality: "MR",
        studyId: 50,
        patientId: 7,
        worklistId: 900,
        rawFindings: "x",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;
    ownership.draftId = draftId;

    const [other] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: `Other ${marker}`,
        modality: "MR",
        studyId: 999,
        patientId: 999,
        worklistId: 999,
        rawFindings: "y",
        impression: "[]",
      })
      .returning();
    otherDraftId = other.id;

    const ownedUrl = await writeKeyImageFile();
    const [owned] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        studyId: 50,
        patientId: 7,
        imageUrl: ownedUrl,
        thumbnailUrl: ownedUrl,
        caption: "owned",
        sourceType: "UPLOAD",
      })
      .returning();
    ownedImageId = owned.id;
    imageIds.push(ownedImageId);

    const otherUrl = await writeKeyImageFile();
    const [otherImg] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: otherDraftId,
        studyId: 999,
        patientId: 999,
        imageUrl: otherUrl,
        thumbnailUrl: otherUrl,
        caption: "malicious",
        sourceType: "UPLOAD",
      })
      .returning();
    otherPatientImageId = otherImg.id;
    imageIds.push(otherPatientImageId);

    const legacyUrl = await writeKeyImageFile();
    const [legacy] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        studyId: null,
        patientId: 7,
        imageUrl: legacyUrl,
        thumbnailUrl: legacyUrl,
        caption: "legacy-draft",
        sourceType: "UPLOAD",
      })
      .returning();
    legacyDraftOnlyImageId = legacy.id;
    imageIds.push(legacyDraftOnlyImageId);

    const nullUrl = await writeKeyImageFile();
    const [nullRow] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId: null,
        studyId: null,
        patientId: 7,
        imageUrl: nullUrl,
        thumbnailUrl: nullUrl,
        caption: "null-ids",
        sourceType: "UPLOAD",
      })
      .returning();
    nullIdentityImageId = nullRow.id;
    imageIds.push(nullIdentityImageId);
  });

  afterAll(async () => {
    if (imageIds.length) {
      await db
        .delete(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, imageIds));
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
    if (otherDraftId) {
      await db
        .delete(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.id, otherDraftId));
    }
    for (const f of writtenFiles) {
      await fs.unlink(f).catch(() => undefined);
    }
  });

  function snapshotFor(ids: number[]) {
    return parseComposerSnapshot({
      studyId: 50,
      worklistId: 900,
      aiMode: "SELECTED_IMAGES",
      findings: "Fazekas grade 1.",
      impression: "",
      recommendation: "",
      observations: [{ concept: "fazekas", findingsText: "Fazekas grade 1.", source: "quick-select" }],
      selectedKeyImages: ids.map((keyImageId) => ({ keyImageId, caption: "t" })),
    });
  }

  it("accepts correct study + correct draft", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([ownedImageId]),
      ownership,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selectedKeyImageIds).toEqual([ownedImageId]);
  });

  it("rejects wrong study on row", async () => {
    const wrongStudyUrl = await writeKeyImageFile();
    const [row] = await db
      .insert(radiologyReportKeyImagesTable)
      .values({
        draftId,
        studyId: 777,
        patientId: 7,
        imageUrl: wrongStudyUrl,
        thumbnailUrl: wrongStudyUrl,
        caption: "wrong-study",
        sourceType: "UPLOAD",
      })
      .returning();
    imageIds.push(row.id);
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([row.id]),
      ownership,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toMatch(/cross_study|ownership_unverified/);
  });

  it("rejects wrong draft on row", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([otherPatientImageId]),
      ownership: { ...ownership, patientId: 7 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        ["selected_images_cross_draft", "selected_images_ownership_unverified"].includes(
          r.safeError,
        ),
      ).toBe(true);
    }
  });

  it("rejects both-null identity rows", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([nullIdentityImageId]),
      ownership,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("rejects malicious key-image from another patient", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([otherPatientImageId]),
      ownership,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });

  it("accepts legacy draft-linked row with null studyId when draft linkage proves ownership", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([legacyDraftOnlyImageId]),
      ownership,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when ownership context has no draft and no study", async () => {
    const r = await resolveSelectedKeyImagesForCompose({
      snapshot: snapshotFor([ownedImageId]),
      ownership: {
        draftId: null,
        studyId: null,
        worklistId: null,
        patientId: null,
        draftStudyId: null,
        draftWorklistId: null,
        draftPatientId: null,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("selected_images_ownership_unverified");
  });
});

describe("SELECTED_IMAGES ownership (DB gate)", () => {
  it("documents whether DATABASE_URL was available for ownership request tests", () => {
    if (!dbReady) {
      console.warn(
        "[SKIP] DATABASE_URL unset — selected-images ownership request tests did not run",
      );
    }
    expect(typeof dbReady).toBe("boolean");
  });
});
