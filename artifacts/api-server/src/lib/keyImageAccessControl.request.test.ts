/**
 * End-to-end key-image access control over real HTTP and a real database.
 *
 * Covers the whole boundary: the mint call (who may ask, and what comes back)
 * and the guarded delivery (what the mount will and will not release). The
 * point of the suite is that a stored key image is PHI-bearing pixels and is
 * reachable only by an authenticated, authorized request — and that the URL a
 * browser puts in an `<img>` carries a short, single-file grant instead of the
 * staff session token.
 *
 * Skips when DATABASE_URL is unset. A skip is not a pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyReportKeyImagesTable,
  usersTable,
} from "@workspace/db/schema";
import { FROZEN_KEY_IMAGE_DIR } from "./frozenKeyImages";
import { KEY_IMAGE_MOUNT, radiologyKeyImageHandlers } from "./radiologyKeyImageStatic";
import { mintKeyImageGrant } from "./keyImageAccessToken";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

const GRANT_PARAM = "kimg";

function grantOf(url: string | null): string | null {
  if (!url) return null;
  const q = url.split("?")[1] ?? "";
  for (const part of q.split("&")) {
    const [k, v] = part.split("=");
    if (k === GRANT_PARAM) return decodeURIComponent(v ?? "");
  }
  return null;
}

function fileNameOf(url: string | null): string {
  return String(url ?? "").split("?")[0].split("/").pop() ?? "";
}

describe.skipIf(!hasDatabaseUrl())("radiology key-image access control (HTTP + DB)", () => {
  const marker = `vitest-keyimg-${randomUUID().slice(0, 8)}`;
  let app: Express;
  let radiologyToken = "";
  let billingToken = "";
  let radiologyUserId = 0;
  let billingUserId = 0;
  let draftId = 0;
  const imageIds: number[] = [];
  const writtenFiles: string[] = [];
  let fileA = "";
  let fileB = "";
  let rowAId = 0;
  let rowBId = 0;
  let canaryPath = "";
  const savedSecret = { session: process.env.SESSION_SECRET, jwt: process.env.JWT_SECRET };

  async function writeImage(name: string): Promise<string> {
    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    const abs = path.join(FROZEN_KEY_IMAGE_DIR, name);
    await fs.writeFile(abs, JPEG_1X1);
    writtenFiles.push(abs);
    return abs;
  }

  async function mint(
    ids: number[],
    token: string | null,
  ): Promise<{ status: number; body: any; text: string }> {
    const call = request(app).post("/api/radiology/report-generator/key-images/access-urls");
    const withAuth = token ? call.set("Authorization", `Bearer ${token}`) : call;
    const res = await withAuth.send({ ids });
    return { status: res.status, body: res.body, text: res.text };
  }

  beforeAll(async () => {
    app = await createTestApp();
    // Mounted exactly as app.ts mounts it, so the test exercises the real stack.
    app.use(KEY_IMAGE_MOUNT, ...(radiologyKeyImageHandlers() as never[]));

    process.env.SESSION_SECRET = `vitest-grant-secret-${marker}`;

    const [radiology] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Radiologist ${marker}`,
        email: `rad-${marker}@vitest.invalid`,
        username: `rad-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "1111",
        isActive: true,
      })
      .returning();
    radiologyUserId = radiology.id;
    radiologyToken = `vitest-rad-${marker}`;
    await db.insert(portalSessionsTable).values({
      token: radiologyToken,
      scope: "staff",
      subjectId: radiology.id,
      subjectName: radiology.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [billing] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Bill Desk ${marker}`,
        email: `bil-${marker}@vitest.invalid`,
        username: `bil-${marker}`,
        role: "cashier",
        permissions: JSON.stringify(["/billing"]),
        pin: "2222",
        isActive: true,
      })
      .returning();
    billingUserId = billing.id;
    billingToken = `vitest-bil-${marker}`;
    await db.insert(portalSessionsTable).values({
      token: billingToken,
      scope: "staff",
      subjectId: billing.id,
      subjectName: billing.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        studyName: `Vitest MRI LS Spine ${marker}`,
        modality: "MR",
        studyId: 4401,
        patientId: 4402,
        worklistId: 4403,
        rawFindings: "Left foraminal narrowing at L5-S1.",
        impression: "[]",
      })
      .returning();
    draftId = draft.id;

    fileA = `${marker}-A.jpg`;
    fileB = `${marker}-B.jpg`;
    await writeImage(fileA);
    await writeImage(fileB);

    const rows = await db
      .insert(radiologyReportKeyImagesTable)
      .values([
        {
          draftId,
          studyId: 4401,
          patientId: 4402,
          imageUrl: `/uploads/radiology-key-images/${fileA}`,
          thumbnailUrl: `/uploads/radiology-key-images/${fileA}`,
          caption: "Axial L5-S1 left",
          sourceType: "VIEWPORT_CAPTURE",
        },
        {
          draftId,
          studyId: 4401,
          patientId: 4402,
          imageUrl: `/uploads/radiology-key-images/${fileB}`,
          thumbnailUrl: null,
          caption: "Sagittal T2",
          sourceType: "VIEWPORT_CAPTURE",
        },
        // A row whose image is not a stored file (DICOMweb-rendered) — the guard
        // covers the upload prefix only, and must not invent a grant for it.
        {
          draftId,
          studyId: 4401,
          patientId: 4402,
          imageUrl: "/dicom-web/studies/1.2.3/series/1.2.3.4/instance/1.2.3.4.5/rendered",
          thumbnailUrl: null,
          caption: "Live Orthanc render",
          sourceType: "DICOM",
        },
      ])
      .returning({ id: radiologyReportKeyImagesTable.id });
    imageIds.push(...rows.map((r) => r.id));
    rowAId = rows[0].id;
    rowBId = rows[1].id;

    // A file inside data/uploads but OUTSIDE the guarded prefix.
    canaryPath = path.join(FROZEN_KEY_IMAGE_DIR, "..", `${marker}-canary.txt`);
    await fs.writeFile(canaryPath, "not-a-key-image");
  }, 90_000);

  afterAll(async () => {
    if (imageIds.length) {
      await db
        .delete(radiologyReportKeyImagesTable)
        .where(inArray(radiologyReportKeyImagesTable.id, imageIds))
        .catch(() => {});
    }
    if (draftId) {
      await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, draftId)).catch(() => {});
    }
    for (const token of [radiologyToken, billingToken]) {
      if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    }
    for (const id of [radiologyUserId, billingUserId]) {
      if (id) await db.delete(usersTable).where(eq(usersTable.id, id)).catch(() => {});
    }
    for (const f of writtenFiles) await fs.unlink(f).catch(() => undefined);
    if (canaryPath) await fs.unlink(canaryPath).catch(() => undefined);
    if (savedSecret.session === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret.session;
    if (savedSecret.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret.jwt;
  });

  describe("minting a grant", () => {
    it("refuses an anonymous mint", async () => {
      const res = await mint([rowAId], null);
      expect(res.status).toBe(401);
    });

    it("refuses a staff session that does not hold the radiology module", async () => {
      const res = await mint([rowAId], billingToken);
      expect(res.status).toBe(403);
      expect(res.text).not.toContain(fileA);
    });

    it("returns a per-file grant and never a session token in the URL", async () => {
      const res = await mint([rowAId, rowBId], radiologyToken);
      expect(res.status, res.text).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(2);

      const a = res.body.items.find((i: { id: number }) => i.id === rowAId);
      const b = res.body.items.find((i: { id: number }) => i.id === rowBId);
      expect(a.imageUrl).toContain(`/uploads/radiology-key-images/${fileA}?${GRANT_PARAM}=`);
      expect(a.thumbnailUrl).toContain(`${GRANT_PARAM}=`);
      // B stores no thumbnail file: null, not a guess.
      expect(b.thumbnailUrl).toBeNull();
      for (const url of [a.imageUrl, a.thumbnailUrl, b.imageUrl]) {
        expect(url).not.toContain("staffToken");
        expect(url).not.toContain(radiologyToken);
      }
      expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
    });

    it("passes a non-stored image URL through without inventing a grant", async () => {
      const dicomRowId = imageIds[2];
      const res = await mint([dicomRowId], radiologyToken);
      expect(res.status, res.text).toBe(200);
      expect(res.body.items[0].imageUrl).toBe(
        "/dicom-web/studies/1.2.3/series/1.2.3.4/instance/1.2.3.4.5/rendered",
      );
    });

    it("404s when none of the ids exist (no silent empty success)", async () => {
      const res = await mint([999_999_991], radiologyToken);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("no_key_image_rows");
    });

    it("refuses a malformed body", async () => {
      const res = await request(app)
        .post("/api/radiology/report-generator/key-images/access-urls")
        .set("Authorization", `Bearer ${radiologyToken}`)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("fails closed when the server has no signing secret", async () => {
      const saved = { s: process.env.SESSION_SECRET, j: process.env.JWT_SECRET };
      delete process.env.SESSION_SECRET;
      delete process.env.JWT_SECRET;
      try {
        const res = await mint([rowAId], radiologyToken);
        expect(res.status).toBe(503);
        expect(res.body.error).toBe("key_image_grant_unavailable");
        expect(res.text).not.toContain(fileA);
      } finally {
        if (saved.s !== undefined) process.env.SESSION_SECRET = saved.s;
        if (saved.j !== undefined) process.env.JWT_SECRET = saved.j;
      }
    });
  });

  describe("serving the pixels", () => {
    it("serves the image bytes for a valid grant, with correct Content-Type and private caching", async () => {
      const minted = await mint([rowAId], radiologyToken);
      const url: string = minted.body.items[0].imageUrl;
      const res = await request(app).get(url);
      expect(res.status, res.text).toBe(200);
      expect(res.headers["content-type"]).toContain("image/jpeg");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("private, max-age=300");
      expect(Buffer.isBuffer(res.body) ? res.body.equals(JPEG_1X1) : true).toBe(true);
    });

    it("serves nothing to an anonymous request — the filename alone is not a credential", async () => {
      const res = await request(app).get(`${KEY_IMAGE_MOUNT}/${fileA}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("key_image_access_grant_required");
      expect(res.headers["content-type"]).not.toContain("image/jpeg");
    });

    it("does NOT honor a staff session token in the query string", async () => {
      const res = await request(app).get(
        `${KEY_IMAGE_MOUNT}/${fileA}?staffToken=${encodeURIComponent(radiologyToken)}`,
      );
      expect(res.status).toBe(401);
      // The long-lived token must not appear anywhere in the response either.
      expect(res.text).not.toContain(radiologyToken);
    });

    it("accepts the Bearer session header, and only for staff who hold /radiology", async () => {
      const ok = await request(app)
        .get(`${KEY_IMAGE_MOUNT}/${fileA}`)
        .set("Authorization", `Bearer ${radiologyToken}`);
      expect(ok.status).toBe(200);
      expect(ok.headers["cache-control"]).toBe("private, max-age=300");

      const denied = await request(app)
        .get(`${KEY_IMAGE_MOUNT}/${fileA}`)
        .set("Authorization", `Bearer ${billingToken}`);
      expect(denied.status).toBe(403);
      expect(denied.headers["content-type"]).not.toContain("image/jpeg");
    });

    it("403s a tampered grant", async () => {
      const minted = await mint([rowAId], radiologyToken);
      const token = grantOf(minted.body.items[0].imageUrl) ?? "";
      const flipped = `${token.slice(0, -3)}aaa`;
      const res = await request(app).get(`${KEY_IMAGE_MOUNT}/${fileA}?${GRANT_PARAM}=${flipped}`);
      expect(res.status).toBe(403);
      expect(res.headers["content-type"]).not.toContain("image/jpeg");
    });

    it("403s a valid grant replayed against a different file", async () => {
      const minted = await mint([rowAId], radiologyToken);
      const grantForA = grantOf(minted.body.items[0].imageUrl);
      const res = await request(app).get(`${KEY_IMAGE_MOUNT}/${fileB}?${GRANT_PARAM}=${grantForA}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("key_image_access_grant_mismatch");
    });

    it("410s an expired grant, distinctly from a forged one", async () => {
      const expired = mintKeyImageGrant(fileA, { nowMs: Date.now() - 30 * 60 * 1000 });
      const res = await request(app).get(`${KEY_IMAGE_MOUNT}/${fileA}?${GRANT_PARAM}=${expired.token}`);
      expect(res.status).toBe(410);
      expect(res.body.error).toBe("key_image_access_grant_expired");
    });

    it("serves a thumbnail grant for the row that has one, and the full image where the row has none", async () => {
      const minted = await mint([rowAId, rowBId], radiologyToken);
      const a = minted.body.items.find((i: { id: number }) => i.id === rowAId);
      const b = minted.body.items.find((i: { id: number }) => i.id === rowBId);
      expect((await request(app).get(a.thumbnailUrl)).status).toBe(200);
      expect((await request(app).get(b.imageUrl)).status).toBe(200);
    });

    it("lists no directory and never reads outside the guarded prefix", async () => {
      const listing = await request(app).get(`${KEY_IMAGE_MOUNT}/`);
      expect(listing.status).not.toBe(200);
      expect(listing.text).not.toContain(fileA);

      const nested = await request(app).get(`${KEY_IMAGE_MOUNT}/../${marker}-canary.txt`);
      expect(nested.status).not.toBe(200);
      expect(nested.text).not.toContain("not-a-key-image");

      const encoded = await request(app).get(
        `${KEY_IMAGE_MOUNT}/%2e%2e%2f${marker}-canary.txt`,
      );
      expect(encoded.status).not.toBe(200);
      expect(encoded.text).not.toContain("not-a-key-image");
    });

    it("does not leak the filesystem path in any refusal", async () => {
      const res = await request(app).get(`${KEY_IMAGE_MOUNT}/${fileA}`);
      expect(res.status).toBe(401);
      expect(res.text).not.toContain(FROZEN_KEY_IMAGE_DIR);
      expect(fileNameOf(res.text)).not.toContain("uploads");
    });
  });
});
