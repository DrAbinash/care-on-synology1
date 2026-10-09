/**
 * Key images are PHI-bearing pixels served over HTTP (P0-5).
 *
 * `data/uploads/radiology-key-images/` sits inside the public `/uploads` static
 * mount, so before this guard the only thing between an anonymous request and a
 * patient's MRI screenshot was an unguessable UUID filename. These tests run the
 * real exported handler stack over real HTTP, mounted exactly the way `app.ts`
 * mounts it, and prove the boundary is authentication — not obscurity.
 *
 * Requires a real database for the staff session. Skips when DATABASE_URL is
 * unset — do not treat a skip as a pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { FROZEN_KEY_IMAGE_DIR } from "./frozenKeyImages";
import { KEY_IMAGE_MOUNT, radiologyKeyImageHandlers } from "./radiologyKeyImageStatic";
import { hasDatabaseUrl } from "../testSupport/apiTestApp";

const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
  "base64",
);

/** Raw bytes the server actually returned, whatever supertest parsed them into. */
function sentBytes(res: { body: unknown; text?: string }): Buffer {
  if (Buffer.isBuffer(res.body)) return res.body;
  if (typeof res.body === "string") return Buffer.from(res.body);
  if (res.body && Object.keys(res.body as object).length === 0 && !res.text) return Buffer.alloc(0);
  return Buffer.from(res.text ?? "");
}

describe.skipIf(!hasDatabaseUrl())("radiology key-image HTTP access control", () => {
  const marker = `vitest-keyimg-${randomUUID().slice(0, 8)}`;
  let app: Express;
  let token = "";
  let userId = 0;
  let fileName = "";
  let filePath = "";
  let canaryPath = "";

  const imageUrl = (query = "") => `${KEY_IMAGE_MOUNT}/${fileName}${query}`;

  beforeAll(async () => {
    // Same composition as app.ts:322 — `app.use(KEY_IMAGE_MOUNT, ...handlers())`.
    app = express();
    app.use(KEY_IMAGE_MOUNT, ...(radiologyKeyImageHandlers() as never[]));

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Radiologist ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
        pin: "9876",
        isActive: true,
      })
      .returning();
    userId = user.id;

    token = `vitest-token-${marker}`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await fs.mkdir(FROZEN_KEY_IMAGE_DIR, { recursive: true });
    fileName = `${marker}-${randomUUID()}.jpg`;
    filePath = path.join(FROZEN_KEY_IMAGE_DIR, fileName);
    await fs.writeFile(filePath, JPEG_1X1);

    // A sibling file under data/uploads that the guarded prefix must not reach.
    canaryPath = path.join(FROZEN_KEY_IMAGE_DIR, "..", `${marker}-canary.txt`);
    await fs.writeFile(canaryPath, "not-a-key-image");
  }, 60_000);

  afterAll(async () => {
    if (filePath) await fs.unlink(filePath).catch(() => undefined);
    if (canaryPath) await fs.unlink(canaryPath).catch(() => undefined);
    if (token) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    }
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
  });

  it("returns 401 with an error body, not image bytes, to an anonymous request", async () => {
    const res = await request(app).get(imageUrl());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Staff authentication required" });
    expect(res.headers["content-type"]).not.toContain("image/jpeg");
    expect(sentBytes(res).includes(JPEG_1X1)).toBe(false);
  });

  it("returns 401, not the image, for a bogus token", async () => {
    const res = await request(app).get(
      imageUrl(`?staffToken=${encodeURIComponent("vitest-not-a-session")}`),
    );
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).not.toContain("image/jpeg");
    expect(sentBytes(res).includes(JPEG_1X1)).toBe(false);
  });

  it("serves the image to a staff session over the ?staffToken= convention", async () => {
    const res = await request(app).get(imageUrl(`?staffToken=${encodeURIComponent(token)}`));
    expect(res.status, res.text).toBe(200);
    expect(sentBytes(res).equals(JPEG_1X1)).toBe(true);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("also accepts the Authorization header used by fetch() callers", async () => {
    const res = await request(app).get(imageUrl()).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(sentBytes(res).length).toBe(JPEG_1X1.length);
  });

  it("marks the response private and nosniff so clinical pixels are not shared-cacheable", async () => {
    const res = await request(app).get(imageUrl()).set("Authorization", `Bearer ${token}`);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves no directory listing", async () => {
    const res = await request(app)
      .get(`${KEY_IMAGE_MOUNT}/?staffToken=${encodeURIComponent(token)}`)
      .redirects(0);
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain(fileName);
  });

  it("does not escape the guarded prefix to read a sibling uploads file", async () => {
    const encoded = `/..${path.sep}${path.basename(canaryPath)}`.replace(/\\/g, "/");
    const res = await request(app)
      .get(`${KEY_IMAGE_MOUNT}${encoded}?staffToken=${encodeURIComponent(token)}`)
      .redirects(0);
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain("not-a-key-image");
    expect(res.text).not.toContain(FROZEN_KEY_IMAGE_DIR);
  });
});
