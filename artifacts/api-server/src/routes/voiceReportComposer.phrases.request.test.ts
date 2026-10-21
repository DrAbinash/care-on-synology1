/**
 * Request-level tests for the Smart Dictation custom-findings vocabulary
 * (Settings → Radiology → Voice → Smart Dictation findings).
 *
 * The owner asked for NEW findings to be addable from the user interface. These
 * tests pin the full stack contract against the real routes and Postgres:
 *   - auth split: dictators (ai_reporting.use) read + preview; admins write;
 *   - a custom finding is dictatable END-TO-END through /compose (exact stored
 *     sentence, baseline retirement through the same engine);
 *   - a built-in concept key can never be overridden from the UI;
 *   - disabling a finding removes it from the dictation vocabulary;
 *   - the offline preview answers "if I dictate this, what prints?"
 *
 * Needs DATABASE_URL + Postgres (describe.skipIf when absent).
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import { usersTable, portalSessionsTable, radiologySmartDictationPhrasesTable } from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const dbAvailable = hasDatabaseUrl();

describe.skipIf(!dbAvailable)("Smart Dictation custom findings — request level", () => {
  let app: Express;
  let adminToken = "";
  let dictatorToken = "";
  const marker = `sd-${randomUUID().slice(0, 8)}`;
  // NOTE the permissions: every /radiology/* mount sits behind a global
  // requireStaffPermission("/radiology") module gate, so a dictating
  // radiologist always carries BOTH "/radiology" (module) and
  // "ai_reporting.use" (the composer route's own gate) — mirror that reality.
  let concept = "";
  let createdId = 0;
  let adminUserId = 0;
  let dictatorUserId = 0;

  const FINDINGS_SENTENCE = `Well-defined T2 hyperintense Tarlov cyst at S1 (${marker}).`;

  beforeAll(async () => {
    app = await createTestApp();

    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Vitest SD Admin ${marker}`,
        email: `admin-${marker}@vitest.invalid`,
        username: `sd-admin-${marker}`,
        role: "admin",
        permissions: JSON.stringify(["ai_reporting.use"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    adminUserId = admin.id;
    adminToken = `vitest-token-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: adminToken,
      scope: "staff",
      subjectId: admin.id,
      subjectName: admin.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const [dictator] = await db
      .insert(usersTable)
      .values({
        name: `Vitest SD Radiologist ${marker}`,
        email: `rad-${marker}@vitest.invalid`,
        username: `sd-rad-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "ai_reporting.use"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    dictatorUserId = dictator.id;
    dictatorToken = `vitest-token-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: dictatorToken,
      scope: "staff",
      subjectId: dictator.id,
      subjectName: dictator.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  afterAll(async () => {
    // Vocabulary rows + test users/sessions are test-scoped by the marker key.
    // The stored CONCEPT slug replaces the marker's hyphens with underscores
    // (slugifyConcept), so LIKE on the raw marker would miss the rows and leak
    // them into long-lived dev databases — normalize the same way.
    await db.delete(radiologySmartDictationPhrasesTable)
      .where(like(radiologySmartDictationPhrasesTable.concept, `%${marker.replace(/-/g, "_")}%`));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, adminUserId));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, dictatorUserId));
    await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
    await db.delete(usersTable).where(eq(usersTable.id, dictatorUserId));
  });

  test("auth split: no session → 401/403, never an open admin door", async () => {
    const res = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .send({ label: "x" });
    expect([401, 403]).toContain(res.status);
  });

  test("a radiologist (dictator) can list but cannot create", async () => {
    const list = await request(app)
      .get("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${dictatorToken}`);
    expect(list.status).toBe(200);
    expect(list.body.ok).toBe(true);

    const create = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${dictatorToken}`)
      .send({ label: "Nope", synonyms: "nope", findingsText: "Nope." , families: "lumbar" });
    expect(create.status).toBe(403);
  });

  test("admin creates a finding; the concept slug derives from the label", async () => {
    const res = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: `Tarlov Cyst ${marker}`,
        synonyms: `tarlov cyst ${marker}, perineural cyst ${marker}`,
        findingsText: FINDINGS_SENTENCE,
        impressionText: `Tarlov cyst at S1 (${marker}).`,
        families: "lumbar",
        anatomicalSection: "sacrum",
        conflictGroup: "sacral_lesion",
        baselineReplaces: `The sacrum and coccyx are normal (${marker}).`,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // slugifyConcept("Tarlov Cyst sd-ab12cd34") → "tarlov_cyst_sd_ab12cd34"
    expect(res.body.row.concept).toBe(`tarlov_cyst_${marker.replace(/-/g, "_")}`);
    concept = res.body.row.concept;
    expect(res.body.row.enabled).toBe(true);
    createdId = res.body.row.id;
  });

  test("a duplicate concept is refused with 409, a built-in concept with a readable 400", async () => {
    const dup = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Again", concept, synonyms: "again", findingsText: "Again.", families: "lumbar" });
    expect(dup.status).toBe(409);

    // The vocabulary can never silently override shipped tile wording.
    const builtin = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Fake", concept: "canal_stenosis", synonyms: "fake stenosis", findingsText: "Fake.", families: "lumbar" });
    expect(builtin.status).toBe(400);
    expect(String(builtin.body.error)).toContain("built-in");
  });

  test("validation: label, a synonym, the findings sentence and a family are all required", async () => {
    const missing = await request(app)
      .post("/api/radiology/voice-report-composer/phrases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "", synonyms: "", findingsText: "", families: "" });
    expect(missing.status).toBe(400);
    expect(String(missing.body.error)).toContain("required");
  });

  test("dictating the custom synonym composes EXACTLY the stored sentence, end to end", async () => {
    const res = await request(app)
      .post("/api/radiology/voice-report-composer/compose")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        transcript: `there is a tarlov cyst ${marker} at S1`,
        region: "LS Spine",
        modality: "MR",
        findingsText: "",
        impressionText: "",
        usePhraseFallback: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const obs = res.body.plan.observations[0];
    expect(obs.concept).toBe(concept);
    expect(obs.findingsText).toBe(FINDINGS_SENTENCE);
    expect(res.body.plan.removeConflictingBaselineConcepts)
      .toContain(`The sacrum and coccyx are normal (${marker}).`);
  });

  test("disabling the finding removes it from the vocabulary — dictation invents nothing", async () => {
    const toggle = await request(app)
      .patch(`/api/radiology/voice-report-composer/phrases/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ enabled: false });
    expect(toggle.status).toBe(200);
    expect(toggle.body.row.enabled).toBe(false);

    const res = await request(app)
      .post("/api/radiology/voice-report-composer/compose")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        transcript: `there is a tarlov cyst ${marker} at S1`,
        region: "LS Spine",
        modality: "MR",
        findingsText: "",
        impressionText: "",
        usePhraseFallback: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false); // nothing matches, nothing is invented

    await request(app)
      .patch(`/api/radiology/voice-report-composer/phrases/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ enabled: true });
  });

  test("the offline preview shows what a sample dictation would print", async () => {
    const res = await request(app)
      .post("/api/radiology/voice-report-composer/phrases/preview")
      .set("Authorization", `Bearer ${dictatorToken}`)
      .send({ sample: `a perineural cyst ${marker}`, families: "lumbar" });
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].concept).toBe(concept);
    expect(res.body.matches[0].findingsText).toBe(FINDINGS_SENTENCE);

    // The built-in pass reports a shipped-tile collision when one exists.
    const builtinRes = await request(app)
      .post("/api/radiology/voice-report-composer/phrases/preview")
      .set("Authorization", `Bearer ${dictatorToken}`)
      .send({ sample: "disc desiccation at L4-L5", families: "lumbar" });
    expect(builtinRes.status).toBe(200);
    expect(builtinRes.body.builtInMatches.some((m: { concept: string }) => m.concept === "disc_desiccation")).toBe(true);
  });

  test("full update renames safely; deleting removes the finding; 404 after", async () => {
    const upd = await request(app)
      .patch(`/api/radiology/voice-report-composer/phrases/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        label: `Tarlov Cyst ${marker}`,
        synonyms: `tarlov cyst ${marker}, perineural cyst ${marker}, nerve root sleeve cyst`,
        findingsText: FINDINGS_SENTENCE,
        families: "lumbar, dorsal",
      });
    expect(upd.status).toBe(200);
    expect(upd.body.row.synonyms).toContain("nerve root sleeve cyst");
    expect(upd.body.row.families).toBe("lumbar,dorsal");

    const del = await request(app)
      .delete(`/api/radiology/voice-report-composer/phrases/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const again = await request(app)
      .delete(`/api/radiology/voice-report-composer/phrases/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(again.status).toBe(404);

    const dictatorDel = await request(app)
      .delete(`/api/radiology/voice-report-composer/phrases/999999`)
      .set("Authorization", `Bearer ${dictatorToken}`);
    expect(dictatorDel.status).toBe(403);
  });
});
