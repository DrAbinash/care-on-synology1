/**
 * `POST /api/radiology/report-composer/vision-trial` — what happens to the picture set.
 *
 * The route used to build the set inline: map every entry, `filter` out the ones that failed a
 * mime or size rule, then `.slice(0, 6)` the survivors. Eight selected pictures became six with
 * no trace of the drop, and the trial still ran — `imageCount` and the "Image count: N" line the
 * model is shown are both computed from what survived, so the operator judged an answer to a
 * shorter request than the one they made.
 *
 * These run the REAL router over real HTTP against a real database
 * (`createTestApp` mounts `routes/index`, so `requireStaffAuth` → `canUse` → the handler all
 * execute). The provider call is mocked, for two reasons that are both load-bearing here: it
 * keeps the case off the network, and it is the only way to assert the thing that matters —
 * that a refused set never reaches a model.
 *
 * Why this is not the same as `reportComposer.visionTrialGate.test.ts`: that file is a static
 * source guard because it also tests the cloud-vision flag, which is a literal assignment. A
 * source-text grep cannot catch this regression — the old code passed every grep for
 * "normalizeTrialImageSet" the day someone renamed it, and the bug it must catch is a
 * *behaviour* (`filter` + `slice` returning 200). So the behaviour is executed.
 *
 * DB-gated: without `DATABASE_URL` this file collects and skips. CI provisions Postgres 16 and
 * runs the full suite, so CI is where these cases actually execute — a green local run proves
 * nothing about them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../src/testSupport/apiTestApp";
import { runDeepSeekVisionAbTrial } from "../lib/reportComposer/providers/deepseekVisionTrial";

vi.mock("../lib/reportComposer/providers/deepseekVisionTrial", () => ({
  runDeepSeekVisionAbTrial: vi.fn(async (opts: { images?: unknown[] }) => ({
    ok: true,
    writesClinicalReport: false,
    deepSeekConfigured: false,
    privacy: {},
    local: null,
    deepseek: null,
    sameImageCount: opts.images?.length ?? 0,
    samePrompt: "canned",
  })),
}));

const marker = `vitest-vtimg-${randomUUID().slice(0, 8)}`;
const trial = vi.mocked(runDeepSeekVisionAbTrial);

/** Small, valid, and nothing to do with a patient — the rule under test is about counting. */
function pic(mimeType = "image/jpeg", base64 = "AAAAAAAA") {
  return { mimeType, base64, label: "synthetic_deidentified_trial", filename: "trial.bin" };
}

describe.skipIf(!hasDatabaseUrl())("POST /vision-trial image set", () => {
  let app: Express;
  let adminToken = "";
  let userId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Vitest VisionTrial ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/admin"]),
        pin: "4321",
        isActive: true,
      })
      .returning();
    userId = admin.id;
    adminToken = `vitest-token-${marker}`;
    await db.insert(portalSessionsTable).values({
      token: adminToken,
      scope: "staff",
      subjectId: admin.id,
      subjectName: admin.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.subjectId, [userId]));
      await db.delete(usersTable).where(inArray(usersTable.id, [userId]));
    }
  });

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/radiology/report-composer/vision-trial")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body);

  it("refuses a seventh picture with 400 and never opens a provider", async () => {
    trial.mockClear();
    const res = await post({
      confirmCloudVisionTrial: false,
      runLocal: true,
      runDeepSeek: false,
      images: Array.from({ length: 7 }, () => pic()),
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/at most 6 images/i);
    // The number the operator needs is the number they selected, not the number that survived.
    expect(res.body.suppliedCount).toBe(7);
    expect(trial).not.toHaveBeenCalled();
  });

  it("refuses the whole set when one picture is an unsupported type, and says which", async () => {
    trial.mockClear();
    const res = await post({
      confirmCloudVisionTrial: false,
      runLocal: true,
      runDeepSeek: false,
      images: [pic(), pic("image/tiff"), pic("image/png")],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Picture 2 of 3/);
    expect(res.body.error).toMatch(/image\/tiff/);
    expect(res.body.suppliedCount).toBe(3);
    expect(res.body.droppedIndexes).toEqual([1]);
    expect(trial).not.toHaveBeenCalled();
  });

  it("refuses a picture that carries no data instead of running a two-picture trial", async () => {
    trial.mockClear();
    const res = await post({
      confirmCloudVisionTrial: false,
      runLocal: true,
      runDeepSeek: false,
      images: [pic(), pic("image/png", "   ")],
    });
    expect(res.status).toBe(400);
    expect(res.body.droppedIndexes).toEqual([1]);
    expect(res.body.error).toMatch(/no image data/i);
    expect(trial).not.toHaveBeenCalled();
  });

  it("sends six pictures untouched — the ceiling is still usable", async () => {
    trial.mockClear();
    const res = await post({
      confirmCloudVisionTrial: false,
      runLocal: true,
      runDeepSeek: false,
      images: Array.from({ length: 6 }, () => pic()),
    });
    expect(res.status).toBe(200);
    expect(trial).toHaveBeenCalledTimes(1);
    const sent = trial.mock.calls[0][0].images ?? [];
    expect(sent).toHaveLength(6);
  });

  it("still treats an absent image list as the synthetic prompt-only trial", async () => {
    // Positive control for the default path: the lab's own screen posts no images at all
    // (ReportComposerTestPanel.tsx runVisionTrial), and that must not become a 400.
    trial.mockClear();
    const res = await post({ confirmCloudVisionTrial: false, runLocal: true, runDeepSeek: false });
    expect(res.status).toBe(200);
    expect(trial).toHaveBeenCalledTimes(1);
    expect(trial.mock.calls[0][0].images ?? []).toEqual([]);
  });
});
