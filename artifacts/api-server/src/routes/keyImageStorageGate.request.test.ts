/**
 * A radiology key image is only "stored" when its bytes are on disk.
 *
 * `POST /key-images` inserts the row and then re-reads what it just wrote; if the
 * artifact (or its thumbnail) is not there, the row is deleted, the partial files
 * are removed and the caller gets an explicit failure. Without that gate a
 * radiologist signs a report whose picture vanishes at the next reprint — which
 * is how 42 of the 46 files this module holds ended up cited-but-absent.
 *
 * The gate is exercised by making the presence check answer "absent" for one call
 * while everything else stays real, and the control half proves the refusal came
 * from that check and not from a route that never stores anything:
 *  - control: a normal upload → 2xx, a row, bytes on disk;
 *  - gated: same request with the presence check forced to false → 500
 *    KEY_IMAGE_STORAGE_FAILED, no row, and no new file left on disk.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { FROZEN_KEY_IMAGE_DIR } from "../lib/frozenKeyImages";

vi.mock("../lib/frozenKeyImages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/frozenKeyImages")>();
  return {
    ...actual,
    frozenKeyImageFilePresent: async (absPath: string) => {
      if ((globalThis as { __kimgForceAbsent?: boolean }).__kimgForceAbsent === true) return false;
      return actual.frozenKeyImageFilePresent(absPath);
    },
  };
});

async function jpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 20, g: 30, b: 40 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("key-image storage refuses a row without its bytes", () => {
  let app: Express;
  const marker = `kimgate-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let draftId = 0;
  let userId = 0;
  const cleanupImageIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `KI gate ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/report-generator"]),
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
        studyName: "KI gate test",
        modality: "MR",
        rawFindings: "x",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;
  }, 180_000);

  afterAll(async () => {
    for (const id of cleanupImageIds) {
      await db.delete(radiologyReportKeyImagesTable).where(eq(radiologyReportKeyImagesTable.id, id));
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId));
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    delete (globalThis as { __kimgForceAbsent?: boolean }).__kimgForceAbsent;
  });

  async function rowsForDraft(): Promise<number> {
    return (
      await db
        .select({ id: radiologyReportKeyImagesTable.id })
        .from(radiologyReportKeyImagesTable)
        .where(eq(radiologyReportKeyImagesTable.draftId, draftId))
    ).length;
  }

  async function postOneImage() {
    return request(app)
      .post("/api/radiology/report-generator/key-images")
      .set("Authorization", `Bearer ${token}`)
      .field("draftId", String(draftId))
      .field("caption", "")
      .attach("image", await jpegBuffer(), { filename: `${randomUUID()}.jpg`, contentType: "image/jpeg" });
  }

  it("control: a real upload leaves a row AND bytes on disk", async () => {
    const before = new Set(await fs.readdir(FROZEN_KEY_IMAGE_DIR));
    const res = await postOneImage();
    expect(res.status).toBe(201);
    expect(res.body?.success).toBe(true);
    const rows = await db
      .select()
      .from(radiologyReportKeyImagesTable)
      .where(and(eq(radiologyReportKeyImagesTable.draftId, draftId)));
    expect(rows.length).toBe(1);
    cleanupImageIds.push(rows[0].id);
    const name = path.basename(String(rows[0].imageUrl));
    const st = await fs.stat(path.join(FROZEN_KEY_IMAGE_DIR, name));
    expect(st.size).toBeGreaterThan(0);
    const added = (await fs.readdir(FROZEN_KEY_IMAGE_DIR)).filter((f) => !before.has(f));
    expect(added.length).toBeGreaterThan(0);
  });

  it("refuses to cite an image whose bytes are not there, and leaves nothing behind", async () => {
    const rowsBefore = await rowsForDraft();
    const filesBefore = new Set(await fs.readdir(FROZEN_KEY_IMAGE_DIR));
    (globalThis as { __kimgForceAbsent?: boolean }).__kimgForceAbsent = true;
    let res;
    try {
      res = await postOneImage();
    } finally {
      delete (globalThis as { __kimgForceAbsent?: boolean }).__kimgForceAbsent;
    }
    expect(res.status).toBe(500);
    expect(res.body?.error).toBe("KEY_IMAGE_STORAGE_FAILED");
    expect(await rowsForDraft()).toBe(rowsBefore);
    const leftover = (await fs.readdir(FROZEN_KEY_IMAGE_DIR)).filter((f) => !filesBefore.has(f));
    expect(leftover).toEqual([]);
  });
});
