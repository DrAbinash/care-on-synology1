/**
 * The Quick Select boxes are the clinic's data now, so the write API has to run.
 *
 * WHY REQUEST LEVEL. The rules themselves are unit-tested in
 * lib/quickSelectBoxRules.test.ts, but a rule that is never reached is worse than
 * no rule: this namespace already produced exactly that defect once, when
 * POST /api/billing/save answered 500 on every call while its source-text tests
 * stayed green (see testSupport/apiTestApp.ts). Every assertion here executes the
 * real router, the real requireStaffAuth → requireBoxAuthor chain and a real
 * PostgreSQL row.
 *
 * WHAT IT PINS
 *   1. A reporting doctor — not only an admin — can author a box.
 *   2. A role that stays narrow by the owner's request cannot.
 *   3. The blocking rules answer 422 naming the rule, and write no row.
 *   4. Father → son ownership survives a round trip through the strip's payload.
 *   5. The deploy contract: an edit stamps a shipped box, and Restore defaults
 *      un-stamps it — without resurrecting a box the clinic retired.
 *   6. A father cannot vanish and orphan its sons unless the caller says which.
 *   7. Usage counts and the audit trail are written by the same request.
 *   8. The two clients that already PATCH this route keep working, because they
 *      send no authoring columns at all.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs
 * against the postgres service.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyStudyTabsTable,
  radiologyQuickFindingsTable,
  radiologyQuickFindingHistoryTable,
  radiologyQuickFindingUsageTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const BASE = "/api/radiology/quick-select";
const AUTHOR_REFUSAL = "Only an administrator or a reporting doctor can change Quick Select boxes";

describe.skipIf(!dbReady)("Quick Select box authoring — request level", () => {
  let app: Express;
  const marker = `qsbox-${randomUUID().slice(0, 8)}`;
  const STUDY = `Marker Region ${marker}`;

  const DOCTOR = `Dr. Boxes ${marker}`;
  const RADIOLOGIST = `Rad. Narrow ${marker}`;
  const doctorToken = `vitest-doc-${randomUUID()}`;
  const radiologistToken = `vitest-rad-${randomUUID()}`;

  let doctorId = 0;
  let radiologistId = 0;
  let tabId = 0;
  let factoryBoxId = 0;
  let fatherId = 0;
  let sonId = 0;

  const asDoctor = { Authorization: `Bearer ${doctorToken}` };
  const asRadiologist = { Authorization: `Bearer ${radiologistToken}` };

  const FACTORY_FINDING = "Age-related involutional changes of the brain.";
  const factoryKey = `factory.${marker}.senile`;

  /** The body the workspace's existing editor sends — no authoring columns. */
  const legacyEditorBody = {
    studyType: STUDY,
    label: `Legacy client box ${marker}`,
    findingText: "Written by the pre-authoring editor.",
    impressionText: "",
    techniqueText: "",
    recommendationText: "",
    anatomicalSection: "",
    conflictGroup: "",
    baselineReplaces: "",
    tags: "",
    isActive: true,
  };

  beforeAll(async () => {
    app = await createTestApp();

    const [doc] = await db
      .insert(usersTable)
      .values({
        name: DOCTOR,
        email: `qs-doc-${marker}@vitest.invalid`,
        username: `qs-doc-${marker}`,
        role: "doctor",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    doctorId = doc.id;

    const [rad] = await db
      .insert(usersTable)
      .values({
        name: RADIOLOGIST,
        email: `qs-rad-${marker}@vitest.invalid`,
        username: `qs-rad-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    radiologistId = rad.id;

    await db.insert(portalSessionsTable).values([
      {
        token: doctorToken,
        scope: "staff",
        subjectId: doctorId,
        subjectName: DOCTOR,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
      {
        token: radiologistToken,
        scope: "staff",
        subjectId: radiologistId,
        subjectName: RADIOLOGIST,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    ]);

    // A marker region, so no test row can land in a tab a real report reads.
    const [tab] = await db
      .insert(radiologyStudyTabsTable)
      .values({ name: STUDY, sortOrder: 9999 })
      .returning();
    tabId = tab.id;

    // A shipped box, written the way the seed script writes it: factory_key plus
    // a snapshot of its own wording. The API deliberately cannot set these two
    // columns, which is what the deploy contract rests on.
    const [factory] = await db
      .insert(radiologyQuickFindingsTable)
      .values({
        studyType: STUDY,
        studyTabId: tabId,
        label: `Senile changes ${marker}`,
        findingText: FACTORY_FINDING,
        impressionText: "",
        techniqueText: "",
        recommendationText: "",
        category: "normal",
        field: "findings",
        factoryKey,
        factoryDefinition: JSON.stringify({
          label: `Senile changes ${marker}`,
          findingText: FACTORY_FINDING,
          impressionText: "",
          techniqueText: "",
          recommendationText: "",
          field: "findings",
          sortOrder: 10,
          isActive: true,
        }),
        sortOrder: 10,
      })
      .returning();
    factoryBoxId = factory.id;

    const fatherRes = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({
        studyTabId: tabId,
        label: `Father ${marker}`,
        field: "findings",
        findingText: "Diffuse parenchymal signal change.",
        impressionText: "Diffuse parenchymal signal change.",
      });
    fatherId = fatherRes.body.id;

    const son = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({
        studyTabId: tabId,
        label: `Fazekas 2 ${marker}`,
        field: "findings",
        sonKind: "grade",
        conflictGroup: `fazekas-${marker}`,
        parentId: fatherId,
        findingText: "Confluent periventricular hyperintensities.",
      });
    sonId = son.body.id;
  }, 60_000);

  afterAll(async () => {
    // Marker-scoped: every row this file created carries the marker in its label,
    // its username or its study tab, so cleanup cannot touch clinical data.
    await db
      .delete(radiologyQuickFindingHistoryTable)
      .where(eq(radiologyQuickFindingHistoryTable.studyType, STUDY))
      .catch(() => {});
    await db
      .delete(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.studyType, STUDY))
      .catch(() => {});
    await db.delete(radiologyStudyTabsTable).where(eq(radiologyStudyTabsTable.id, tabId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, doctorToken)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, radiologistToken)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, doctorId)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, radiologistId)).catch(() => {});
  }, 60_000);

  // ── 1/2. Who may author ────────────────────────────────────────────────────
  it("a reporting doctor authors a box, and the strip payload carries the badge", async () => {
    expect(fatherId, "the fixture father should have been created").toBeGreaterThan(0);

    const res = await request(app).get(BASE).set(asDoctor);
    expect(res.status).toBe(200);
    const father = res.body.findings.find((f: { id: number }) => f.id === fatherId);
    expect(father, "the new box must reach the strip").toBeDefined();
    expect(father.provenance).toBe("your-box");
    expect(father.hasFactoryDefault).toBe(false);
    expect(father.field).toBe("findings");
    expect(father.parentId).toBeNull();
    // The snapshot is the deploy contract's private half; the badge is all a
    // client needs to decide whether Restore defaults is a real action.
    expect(father).not.toHaveProperty("factoryDefinition");
  });

  it("a role the owner keeps narrow cannot author a box", async () => {
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asRadiologist)
      .send({ studyTabId: tabId, label: `Should not exist ${marker}`, findingText: "No." });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe(AUTHOR_REFUSAL);

    const rows = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.label, `Should not exist ${marker}`));
    expect(rows).toEqual([]);
  });

  it("an unauthenticated caller is refused before the rules are reached", async () => {
    const res = await request(app)
      .post(`${BASE}/findings`)
      .send({ studyTabId: tabId, label: `Anonymous ${marker}`, findingText: "No." });
    expect(res.status).toBe(401);
  });

  // ── 3. The blocking rules write no row ─────────────────────────────────────
  it("refuses a box that writes nothing, with the rule named and no row left behind", async () => {
    const label = `Dead button ${marker}`;
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({ studyTabId: tabId, label });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("writes-nothing");
    expect(Array.isArray(res.body?.blocking)).toBe(true);

    const rows = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.label, label));
    expect(rows).toEqual([]);
  });

  it("refuses a template hole before it can print as a gap in a signed report", async () => {
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({
        studyTabId: tabId,
        label: `Hole ${marker}`,
        findingText: "Mass effect with midline shift of {shift} mm.",
      });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("placeholder-unknown");
    expect(res.body?.error).toContain("{shift}");
  });

  it("warns but still saves the clinical judgement only the registry can make", async () => {
    const label = `Concluding without a concept ${marker}`;
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({
        studyTabId: tabId,
        label,
        category: "abnormal",
        findingText: "An abnormal signal.",
        impressionText: "Abnormal study.",
      });
    expect(res.status, res.text).toBe(201);
    expect(res.body?.warnings?.map((w: { code: string }) => w.code)).toContain(
      "concept-missing-on-concluding-box",
    );
    await db
      .delete(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, res.body.id))
      .catch(() => {});
  });

  // ── 4. Ownership round trip ────────────────────────────────────────────────
  it("keeps a father and its son linked, and refuses a third level", async () => {
    const res = await request(app).get(BASE).set(asDoctor);
    const son = res.body.findings.find((f: { id: number }) => f.id === sonId);
    expect(son.parentId).toBe(fatherId);
    expect(son.sonKind).toBe("grade");

    const third = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({
        studyTabId: tabId,
        label: `Grandson ${marker}`,
        parentId: sonId,
        findingText: "Too deep.",
      });
    expect(third.status).toBe(422);
    expect(third.body?.code).toBe("three-levels");
  });

  it("refuses a parent id that is not a box, rather than failing at the database", async () => {
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({ studyTabId: tabId, label: `Bogus parent ${marker}`, parentId: "abc", findingText: "X." });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("parent-missing");
  });

  it("refuses a second box with the same name in the same region", async () => {
    const res = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({ studyTabId: tabId, label: `Father ${marker}`, findingText: "Duplicate." });
    expect(res.status).toBe(422);
    expect(res.body?.code).toBe("label-clash");
  });

  // ── 5. The deploy contract ─────────────────────────────────────────────────
  it("stamps a shipped box on the first wording change, and Restore defaults un-stamps it", async () => {
    const before = await request(app).get(BASE).set(asDoctor);
    const shipped = before.body.findings.find((f: { id: number }) => f.id === factoryBoxId);
    expect(shipped.provenance).toBe("built-in");
    expect(shipped.hasFactoryDefault).toBe(true);

    const edited = await request(app)
      .patch(`${BASE}/findings/${factoryBoxId}`)
      .set(asDoctor)
      .send({ findingText: `${FACTORY_FINDING} With the clinic's own emphasis.` });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.provenance).toBe("your-version");

    const [row] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, factoryBoxId));
    expect(row.customizedAt).not.toBeNull();
    expect(row.factoryKey).toBe(factoryKey);

    const restored = await request(app)
      .post(`${BASE}/findings/${factoryBoxId}/restore-defaults`)
      .set(asDoctor);
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body.findingText).toBe(FACTORY_FINDING);
    expect(restored.body.provenance).toBe("built-in");
    expect(restored.body.customizedAt).toBeNull();
  });

  it("a reorder does not stamp the box, so shipped corrections can still reach it", async () => {
    const res = await request(app)
      .patch(`${BASE}/findings/${factoryBoxId}`)
      .set(asDoctor)
      .send({ sortOrder: 11 });
    expect(res.status, res.text).toBe(200);
    const [row] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, factoryBoxId));
    expect(row.customizedAt).toBeNull();
    expect(row.sortOrder).toBe(11);
  });

  it("Restore defaults does not resurrect a box the clinic retired", async () => {
    const off = await request(app)
      .patch(`${BASE}/findings/${factoryBoxId}`)
      .set(asDoctor)
      .send({ isActive: false });
    expect(off.status, off.text).toBe(200);

    const restored = await request(app)
      .post(`${BASE}/findings/${factoryBoxId}/restore-defaults`)
      .set(asDoctor);
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body.isActive).toBe(false);

    await request(app).patch(`${BASE}/findings/${factoryBoxId}`).set(asDoctor).send({ isActive: true });
  });

  it("offers no Restore defaults on a box the clinic wrote itself", async () => {
    const res = await request(app)
      .post(`${BASE}/findings/${fatherId}/restore-defaults`)
      .set(asDoctor);
    expect(res.status).toBe(409);
    expect(res.body?.code).toBe("no-factory-defaults");
    expect(String(res.body?.error)).toContain("Disable it instead");
  });

  // ── 6. Deleting a father ───────────────────────────────────────────────────
  it("refuses to delete a father without saying what happens to its sons", async () => {
    const res = await request(app).delete(`${BASE}/findings/${fatherId}`).set(asDoctor);
    expect(res.status).toBe(409);
    expect(res.body?.code).toBe("box-has-sons");
    expect(res.body?.sons?.map((s: { id: number }) => s.id)).toContain(sonId);

    const [son] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, sonId));
    expect(son, "the son must still exist after a refused delete").toBeDefined();
  });

  it("promotes the sons to top level when the caller says so", async () => {
    const res = await request(app).delete(`${BASE}/findings/${fatherId}?sons=promote`).set(asDoctor);
    expect(res.status, res.text).toBe(200);

    const [son] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, sonId));
    expect(son.parentId).toBeNull();
    expect(son.sonKind).toBe("");
  });

  // ── 7. Usage and the audit trail ───────────────────────────────────────────
  it("counts clicks per doctor without duplicating a row per click", async () => {
    await request(app).post(`${BASE}/usage/${sonId}`).set(asDoctor);
    const second = await request(app).post(`${BASE}/usage/${sonId}`).set(asDoctor);
    expect(second.status).toBe(200);
    expect(second.body.useCount).toBe(2);

    const rows = await db
      .select()
      .from(radiologyQuickFindingUsageTable)
      .where(
        and(
          eq(radiologyQuickFindingUsageTable.userId, doctorId),
          eq(radiologyQuickFindingUsageTable.findingId, sonId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("records who changed which wording, and keeps the record to authors", async () => {
    const denied = await request(app).get(`${BASE}/history`).set(asRadiologist);
    expect(denied.status).toBe(403);

    const res = await request(app).get(`${BASE}/history?findingId=${factoryBoxId}`).set(asDoctor);
    expect(res.status).toBe(200);
    const edits = res.body.filter((h: { fieldName: string }) => h.fieldName === "findingText");
    expect(edits.length).toBeGreaterThan(0);
    const stamp = edits.find((h: { newValue: string }) => h.newValue.includes("clinic's own emphasis"));
    expect(stamp, "the audit trail must carry the wording, not only the fact of a change").toBeDefined();
    expect(stamp.oldValue).toBe(FACTORY_FINDING);
    expect(stamp.userName).toBe(DOCTOR);
    expect(stamp.action).toBe("edit");
  });

  // ── 8. The clients that already write here ─────────────────────────────────
  it("still accepts the workspace editor's body, which names no authoring column", async () => {
    const created = await request(app)
      .post(`${BASE}/findings`)
      .set(asDoctor)
      .send({ ...legacyEditorBody, studyTabId: tabId });
    expect(created.status, created.text).toBe(201);
    expect(created.body.field).toBe("findings");
    expect(created.body.sonKind).toBe("");

    const patched = await request(app)
      .patch(`${BASE}/findings/${created.body.id}`)
      .set(asDoctor)
      .send({ ...legacyEditorBody, studyTabId: tabId, findingText: "Edited by the pre-authoring editor." });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.findingText).toBe("Edited by the pre-authoring editor.");
    expect(patched.body.provenance).toBe("your-box");
  });

  it("ignores a client that echoes the wire row back, factory columns included", async () => {
    const [row] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, factoryBoxId));
    const res = await request(app)
      .patch(`${BASE}/findings/${factoryBoxId}`)
      .set(asDoctor)
      .send({
        label: row.label,
        studyType: row.studyType,
        findingText: row.findingText,
        factoryKey: "",
        factoryDefinition: "",
        customizedAt: null,
      });
    expect(res.status, res.text).toBe(200);
    const [after] = await db
      .select()
      .from(radiologyQuickFindingsTable)
      .where(eq(radiologyQuickFindingsTable.id, factoryBoxId));
    // Letting a caller clear these would erase the deploy protection entirely.
    expect(after.factoryKey).toBe(factoryKey);
    expect(after.factoryDefinition).not.toBe("");
  });
});
