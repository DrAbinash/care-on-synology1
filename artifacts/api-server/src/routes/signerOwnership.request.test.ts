/**
 * SIGNER OWNERSHIP — request level. Proves the routes, not just the rule.
 *
 * Measured on the real app before this rule existed: signed in as one radiologist, the
 * picker offered every active block and `POST /api/patient-reports/:id/sign
 * { signatureId: <a colleague's block> }` answered 200, so the report printed that
 * colleague's name, qualification and registration number — and because the stamp
 * rewrites `signed_by_name`, the account that actually wrote the report could then no
 * longer withdraw it (403 `not_the_signer`). The countersign route checked neither
 * ownership nor whether the block was still active.
 *
 * Every assertion below is an HTTP status plus a re-read of the stored row. Skipped
 * without DATABASE_URL; runs in CI against postgres:16.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  patientsTable,
  testsTable,
  patientReportsTable,
  signaturesTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("signature block ownership — request level", () => {
  let app: Express;
  const marker = `own-${randomUUID().slice(0, 8)}`;
  const mineToken = `vitest-token-${randomUUID()}`;
  const colleagueToken = `vitest-token-${randomUUID()}`;
  const MINE = `Dr. Mine ${marker}`;
  const COLLEAGUE = `Dr. Colleague ${marker}`;

  let myUserId = 0;
  let colleagueUserId = 0;
  let patientId = 0;
  let testId = 0;
  const signatureIds: number[] = [];
  const reportIds: number[] = [];

  async function makeStaff(name: string, token: string) {
    const [user] = await db.insert(usersTable).values({
      name,
      email: `${name.replace(/\W+/g, "-").toLowerCase()}@vitest.invalid`,
      username: `${name}-${randomUUID().slice(0, 6)}`,
      role: "radiologist",
      permissions: JSON.stringify(["/reports", "/reports:sign", "/reports:verify", "/radiology"]),
      pin: "0000",
      isActive: true,
    }).returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return user.id;
  }

  async function makeBlock(name: string, userId: number | null, isActive = true) {
    const [sig] = await db.insert(signaturesTable).values({
      name,
      role: "Radiologist",
      qualification: "MD (Radiodiagnosis)",
      registrationNo: `REG-${marker}`,
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      isActive,
      userId,
    }).returning();
    signatureIds.push(sig.id);
    return sig.id;
  }

  async function newDraft() {
    const res = await request(app)
      .post("/api/patient-reports")
      .set("Authorization", `Bearer ${mineToken}`)
      .send({
        type: "pathology",
        patientId,
        testId,
        title: `Ownership Probe ${marker}`,
        body: "BODY UNDER TEST",
        impression: "IMPRESSION UNDER TEST",
      });
    expect([200, 201]).toContain(res.status);
    reportIds.push(res.body.id);
    return res.body.id as number;
  }

  const row = async (id: number) =>
    (await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id)))[0];

  const sign = (id: number, token: string, signatureId: number | null) =>
    request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${token}`).send({ signatureId });

  async function audits(id: number, action: string) {
    const rows = await db.select().from(auditLogsTable).where(eq(auditLogsTable.entityId, String(id)));
    return rows.filter((r) => r.action === action);
  }

  /** `audit_logs.new_value` arrives as JSON text over some drivers and an object
   *  over others; the assertion is about the field, not the column's shape. */
  function payloadOf(row: { newValue: unknown }) {
    return typeof row.newValue === "string" ? JSON.parse(row.newValue) : row.newValue;
  }

  beforeAll(async () => {
    app = await createTestApp();
    myUserId = await makeStaff(MINE, mineToken);
    colleagueUserId = await makeStaff(COLLEAGUE, colleagueToken);
    const [patient] = await db.insert(patientsTable).values({
      patientId: `OWN-${marker}`,
      firstName: "Owner",
      lastName: `Probe ${marker}`,
      dateOfBirth: "1980-01-01",
      gender: "male",
      phone: "0000000000",
    }).returning();
    patientId = patient.id;
    const [test] = await db.insert(testsTable).values({
      name: `Haematology ${marker}`,
      code: `HM${marker.slice(-4).toUpperCase()}`,
      price: "900",
      category: "Pathology",
      department: "Pathology",
      duration: "1 day",
      isActive: true,
    }).returning();
    testId = test.id;
  });

  afterAll(async () => {
    if (reportIds.length) {
      for (const id of reportIds) await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id));
    }
    for (const id of signatureIds) await db.delete(signaturesTable).where(eq(signaturesTable.id, id));
    await db.delete(testsTable).where(eq(testsTable.id, testId));
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    for (const t of [mineToken, colleagueToken]) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, t));
    }
    for (const u of [myUserId, colleagueUserId]) await db.delete(usersTable).where(eq(usersTable.id, u));
  });

  it("signs with the caller's own block and records it as owned", async () => {
    const blockId = await makeBlock(`${MINE} (own)`, myUserId);
    const id = await newDraft();
    const res = await sign(id, mineToken, blockId);
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r.signatureId).toBe(blockId);
    expect(r.signedByName).toBe(`${MINE} (own)`);
    expect(r.status).toBe("pending_verification");
    const signed = await audits(id, "legacy_sign");
    expect(payloadOf(signed[signed.length - 1])).toMatchObject({ blockOwnedByCaller: true });
  });

  it("REFUSES to authorize a report under a colleague's active block, and signs nothing", async () => {
    const theirs = await makeBlock(`${COLLEAGUE} (theirs)`, colleagueUserId);
    const id = await newDraft();
    const res = await sign(id, mineToken, theirs);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("signature_not_yours");
    const r = await row(id);
    expect(r.signatureId).toBeNull();
    expect(r.signedByName).toBeNull();
    expect(r.status).not.toBe("pending_verification");
    const rejected = await audits(id, "legacy_sign_rejected");
    expect(rejected.some((a) => a.reason === "signature_not_yours")).toBe(true);
  });

  it("still accepts a block nobody has claimed, and says so in the audit trail", async () => {
    const legacy = await makeBlock(`Dr. Unclaimed ${marker}`, null);
    const id = await newDraft();
    const res = await sign(id, mineToken, legacy);
    expect(res.status).toBe(200);
    expect((await row(id)).signatureId).toBe(legacy);
    const signed = await audits(id, "legacy_sign");
    expect(payloadOf(signed[signed.length - 1])).toMatchObject({ blockOwnedByCaller: false });
  });

  it("refuses a retired block — for the signer and for the verifier", async () => {
    const retired = await makeBlock(`Dr. Retired ${marker}`, myUserId, false);
    const id = await newDraft();
    const res = await sign(id, mineToken, retired);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("signature_not_active");

    const other = await makeBlock(`${COLLEAGUE} (live)`, colleagueUserId);
    const id2 = await newDraft();
    expect((await sign(id2, mineToken, await makeBlock(`${MINE} (live)`, myUserId))).status).toBe(200);
    const verifyRetired = await request(app)
      .post(`/api/patient-reports/${id2}/verify`)
      .set("Authorization", `Bearer ${colleagueToken}`)
      .send({ signatureId: retired, verifiedByName: COLLEAGUE });
    expect(verifyRetired.status).toBe(400);
    expect(verifyRetired.body.error).toBe("signature_not_active");
    // control: the same verifier with their own live block is accepted
    const ok = await request(app)
      .post(`/api/patient-reports/${id2}/verify`)
      .set("Authorization", `Bearer ${colleagueToken}`)
      .send({ signatureId: other, verifiedByName: COLLEAGUE });
    expect(ok.status).toBe(200);
  });

  it("refuses a countersign recorded under a block the verifier does not own", async () => {
    const mineBlock = await makeBlock(`${MINE} (cs)`, myUserId);
    const theirs = await makeBlock(`${COLLEAGUE} (cs)`, colleagueUserId);
    const id = await newDraft();
    expect((await sign(id, mineToken, mineBlock)).status).toBe(200);
    // The colleague may verify — with their own block. What they may not do is stamp
    // the verification with the signer's block, which is how a countersign by
    // whoever-holds-the-first-id used to look like a second reader.
    const res = await request(app)
      .post(`/api/patient-reports/${id}/verify`)
      .set("Authorization", `Bearer ${colleagueToken}`)
      .send({ signatureId: mineBlock, verifiedByName: COLLEAGUE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("signature_not_yours");
    expect((await row(id)).status).toBe("pending_verification");
    expect((await row(id)).verifiedByName).toBeNull();
    // control: the same verifier, their own block, accepted
    const ok = await request(app)
      .post(`/api/patient-reports/${id}/verify`)
      .set("Authorization", `Bearer ${colleagueToken}`)
      .send({ signatureId: theirs, verifiedByName: COLLEAGUE });
    expect(ok.status).toBe(200);
    expect((await row(id)).status).toBe("verified");
  });

  it("signing with no block uses the caller's own session name", async () => {
    const id = await newDraft();
    const res = await sign(id, mineToken, null);
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r.signedByName).toBe(MINE);
    expect(r.signatureId).toBeNull();
  });

  it("stamps the creator's account on a new block, and cannot edit or retire another's", async () => {
    const created = await request(app)
      .post("/api/signatures")
      .set("Authorization", `Bearer ${mineToken}`)
      .send({
        name: `Dr. Created ${marker}`,
        role: "Radiologist",
        qualification: "MD",
        registrationNo: `CRE-${marker}`,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      });
    expect(created.status).toBe(201);
    expect(created.body.userId).toBe(myUserId);
    signatureIds.push(created.body.id);

    const theirs = await makeBlock(`${COLLEAGUE} (manager)`, colleagueUserId);
    const patch = await request(app)
      .patch(`/api/signatures/${theirs}`)
      .set("Authorization", `Bearer ${mineToken}`)
      .send({ qualification: "MD (Hacked)" });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe("signature_not_yours");
    const del = await request(app).delete(`/api/signatures/${theirs}`).set("Authorization", `Bearer ${mineToken}`);
    expect(del.status).toBe(403);

    const own = await request(app)
      .patch(`/api/signatures/${created.body.id}`)
      .set("Authorization", `Bearer ${mineToken}`)
      .send({ qualification: "MD (Radiodiagnosis)" });
    expect(own.status).toBe(200);

    const unowned = await makeBlock(`Dr. Legacy ${marker}`, null);
    const legacyPatch = await request(app)
      .patch(`/api/signatures/${unowned}`)
      .set("Authorization", `Bearer ${colleagueToken}`)
      .send({ qualification: "MD (Pathology)" });
    expect(legacyPatch.status).toBe(200);
  });
});
