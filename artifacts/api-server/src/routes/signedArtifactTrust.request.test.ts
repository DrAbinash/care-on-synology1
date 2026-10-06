/**
 * The signed-artifact trust model, exercised over real HTTP against a real
 * database. The pure decision rules are covered in lib/signedArtifactGuard.test.ts;
 * this file proves the ROUTES actually apply them — because a guard that is
 * correct but unreachable is indistinguishable from no guard at all.
 *
 * Each test names the Phase 5 case it discharges.
 *
 * WHY REQUEST-LEVEL AND NOT SOURCE GREPS
 * -------------------------------------
 * AGENTS.md records the precedent: the grep test for POST /api/billing/save
 * stayed green while the endpoint returned HTTP 500 on every call. Every claim
 * here is therefore an HTTP status plus a re-read of the stored row, not an
 * assertion that some protective-looking string exists in the file.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs
 * against the postgres:16 service.
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

describe.skipIf(!dbReady)("signed-artifact trust model — request level", () => {
  let app: Express;
  const marker = `sigtrust-${randomUUID().slice(0, 8)}`;

  // Two staff, so "verifier must differ from signer" and "only the signer may
  // withdraw" are both testable with real distinct identities.
  const signerToken = `vitest-token-${randomUUID()}`;
  const otherToken = `vitest-token-${randomUUID()}`;
  const SIGNER_NAME = `Dr. Signer ${marker}`;
  const OTHER_NAME = `Dr. Other ${marker}`;
  const SIGNATURE_NAME = `Dr. OnFile ${marker}`;

  let signerUserId = 0;
  let otherUserId = 0;
  let patientId = 0;
  let testId = 0;
  let signatureId = 0;
  const reportIds: number[] = [];

  async function makeStaff(name: string, token: string, role = "radiologist") {
    const [user] = await db
      .insert(usersTable)
      .values({
        name,
        email: `${name.replace(/\W+/g, "-").toLowerCase()}@vitest.invalid`,
        username: `${name}-${randomUUID().slice(0, 6)}`,
        role,
        permissions: JSON.stringify(["/reports", "/reports:sign", "/reports:verify", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    return user.id;
  }

  /** Create a fresh draft report so each case starts from a known state. */
  async function newDraft(overrides: Record<string, unknown> = {}): Promise<number> {
    const res = await request(app)
      .post("/api/patient-reports")
      .set("Authorization", `Bearer ${signerToken}`)
      .send({
        type: "pathology",
        patientId,
        testId,
        title: `Signed Artifact Probe ${marker}`,
        body: "ORIGINAL SIGNED BODY",
        impression: "ORIGINAL IMPRESSION",
        ...overrides,
      });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`POST /api/patient-reports → ${res.status}: ${res.text}`);
    }
    reportIds.push(res.body.id);
    return res.body.id as number;
  }

  async function row(id: number) {
    const [r] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
    if (!r) throw new Error(`report ${id} vanished`);
    return r;
  }

  async function auditRowsFor(id: number, action: string) {
    return db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, String(id)))
      .then((rows) => rows.filter((r) => r.action === action));
  }

  beforeAll(async () => {
    app = await createTestApp();
    signerUserId = await makeStaff(SIGNER_NAME, signerToken);
    otherUserId = await makeStaff(OTHER_NAME, otherToken);

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `SIG-${marker}`,
        firstName: "Probe",
        lastName: `Signed ${marker}`,
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `Histopathology ${marker}`,
        code: `HP${marker.slice(-4).toUpperCase()}`,
        price: "1200",
        category: "Pathology",
        department: "Pathology",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNATURE_NAME,
        role: "Pathologist",
        qualification: "MD (Pathology)",
        registrationNo: `REG-${marker}`,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    signatureId = sig.id;
  });

  afterAll(async () => {
    // Marker-scoped: every row this file created carries the marker in a
    // name/number, so cleanup cannot touch unrelated clinical data.
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
    }
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    await db.delete(signaturesTable).where(eq(signaturesTable.id, signatureId)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, signerToken)).catch(() => {});
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, otherToken)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, signerUserId)).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, otherUserId)).catch(() => {});
  });

  // ── Phase 5 #1, #13 — drafts stay fully editable ──────────────────────────

  it("#1/#13 a draft report remains editable through the ordinary PATCH", async () => {
    const id = await newDraft();
    const res = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ body: "EDITED DRAFT BODY", impression: "EDITED DRAFT IMPRESSION", title: "Edited title" });
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r.body).toBe("EDITED DRAFT BODY");
    expect(r.impression).toBe("EDITED DRAFT IMPRESSION");
    expect(r.title).toBe("Edited title");
  });

  // ── Phase 5 #8, #6 — the server names the signer ──────────────────────────

  it("#8 signing with no signature records the AUTHENTICATED session as the signer", async () => {
    const id = await newDraft();
    const res = await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      // The caller claims to be somebody else entirely.
      .send({ signedByName: "Dr. Not Me At All", signedAt: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);

    const r = await row(id);
    expect(r.signedByName).toBe(SIGNER_NAME);
    expect(r.signedByName).not.toBe("Dr. Not Me At All");
    expect(r.status).toBe("pending_verification");

    // #7 — the signing instant is the server's, not the caller's 2020 claim.
    expect(r.signedAt).toBeTruthy();
    expect(Math.abs(Date.now() - new Date(r.signedAt!).getTime())).toBeLessThan(120_000);

    const audits = await auditRowsFor(id, "legacy_sign");
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toContain(`"rejectedCallerName":"Dr. Not Me At All"`);
    expect(audits[0].newValue).toContain('"identitySource":"session"');
  });

  it("#6 a chosen signature block's own recorded name is the signer, not the body's claim", async () => {
    const id = await newDraft();
    const res = await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ signatureId, signedByName: "Dr. Impostor" });
    expect(res.status).toBe(200);

    const r = await row(id);
    expect(r.signedByName).toBe(SIGNATURE_NAME);
    expect(r.signatureId).toBe(signatureId);
    const audits = await auditRowsFor(id, "legacy_sign");
    expect(audits[0].newValue).toContain('"identitySource":"signature_record"');
    expect(audits[0].newValue).toContain(`"rejectedCallerName":"Dr. Impostor"`);
  });

  it("#6 an unauthenticated caller cannot sign by supplying a name alone", async () => {
    const id = await newDraft();
    const res = await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      // No Authorization header at all.
      .send({ signedByName: "Dr. Anonymous Claim" });
    expect([400, 401]).toContain(res.status);
    const r = await row(id);
    expect(r.signedByName).not.toBe("Dr. Anonymous Claim");
    expect(r.signedAt).toBeNull();
    expect(r.status).toBe("draft");
  });

  // ── Phase 5 #3 — signed content is immutable through the ordinary PATCH ───

  it("#3 a signed report's body cannot be overwritten by the ordinary PATCH", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    expect((await row(id)).status).toBe("pending_verification");

    const res = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ body: "REWRITTEN AFTER SIGNING" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("signed_report_immutable");
    expect(res.body.fields).toEqual(["body"]);

    const r = await row(id);
    expect(r.body).toBe("ORIGINAL SIGNED BODY"); // the bytes did not change
    expect(r.signedByName).toBe(SIGNER_NAME); // nor the attribution

    const audits = await auditRowsFor(id, "signed_mutation_rejected");
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toBe("signed_report_immutable");
  });

  it("#3 the refusal names a correction path this row can actually use", async () => {
    // The message is the only part of this response a human reads: fetchApi's
    // sanitizeApiErrorMessage skips the opaque `signed_report_immutable` token
    // and returns this sentence, and Report Hub puts it straight into a toast.
    // It used to read "Use Amend to create a corrected version, or withdraw the
    // signature first" — but the sign route above produces a legacy-signed row
    // with no structured document, and POST /:id/amend answers 409
    // not_a_signed_structured_report for exactly that. The `already_signed` and
    // `already_verified` refusals further down this file already assert their
    // own messages stay off that route; this one asserted nothing about its
    // message at all, and no other test read it over HTTP.
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});

    const res = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ impression: "REWRITTEN AFTER SIGNING" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("signed_report_immutable");

    const message: string = res.body.message ?? "";
    // Stricter than the siblings' `not.toContain("/:id/amend")`: this message
    // names no route path, so the whole word has to be absent.
    expect(message).not.toMatch(/amend/i);
    expect(message).toContain("withdraw the signature from Report Hub");
    expect(message).toContain("only the signer or an administrator can");
    // Without this clause the message promises a button the withdrawal route
    // itself refuses with `already_verified` — the state the verify test below
    // drives an otherwise identical row into.
    expect(message).toContain("A verified or delivered report cannot be withdrawn.");
  });

  it("#3 every protected field is refused on a signed report, each naming itself", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const before = await row(id);

    for (const [field, value] of [
      ["body", "changed body"],
      ["impression", "changed impression"],
      ["title", "changed title"],
      ["parameters", '[{"name":"x","result":"y"}]'],
    ] as const) {
      const res = await request(app)
        .patch(`/api/patient-reports/${id}`)
        .set("Authorization", `Bearer ${signerToken}`)
        .send({ [field]: value });
      expect(res.status, field).toBe(409);
      expect(res.body.error, field).toBe("signed_report_immutable");
      expect(res.body.fields, field).toEqual([field]);
    }

    const after = await row(id);
    expect(after.body).toBe(before.body);
    expect(after.impression).toBe(before.impression);
    expect(after.title).toBe(before.title);
    expect(after.parameters).toBe(before.parameters);
  });

  it("#3 an admin session is not exempt — immutability is not a permission", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Super Admin ${marker}`,
        email: `admin-${marker}@vitest.invalid`,
        username: `admin-${marker}`,
        role: "super_admin",
        permissions: JSON.stringify([]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    const adminToken = `vitest-token-${randomUUID()}`;
    await db.insert(portalSessionsTable).values({
      token: adminToken,
      scope: "staff",
      subjectId: admin.id,
      subjectName: admin.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    try {
      const res = await request(app)
        .patch(`/api/patient-reports/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ body: "ADMIN REWRITE" });
      expect(res.status).toBe(409);
      expect((await row(id)).body).toBe("ORIGINAL SIGNED BODY");
    } finally {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, adminToken)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, admin.id)).catch(() => {});
    }
  });

  // ── Phase 5 #4 — no alternate route reaches the signed content ────────────

  it("#4 the routes that legitimately write a signed report leave its clinical content alone", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const before = await row(id);

    // Public link + share write tokens/delivery metadata on a signed report by
    // design. They must not be a side door into the signed bytes.
    const link = await request(app)
      .post(`/api/patient-reports/${id}/public-link`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({});
    expect([200, 201, 400, 409]).toContain(link.status);

    const ack = await request(app)
      .post(`/api/patient-reports/${id}/acknowledge-critical`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({});
    expect([200, 409]).toContain(ack.status); // 409 = not flagged critical, which is correct here

    const after = await row(id);
    expect(after.body).toBe(before.body);
    expect(after.impression).toBe(before.impression);
    expect(after.title).toBe(before.title);
    expect(after.parameters).toBe(before.parameters);
    expect(after.signedByName).toBe(before.signedByName);
    expect(after.signedAt?.getTime()).toBe(before.signedAt?.getTime());
  });

  it("#4 re-signing an already-signed report is refused rather than silently re-stamping it", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const first = await row(id);

    const res = await request(app)
      .post(`/api/patient-reports/${id}/sign`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ signedByName: OTHER_NAME });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_signed");
    // A refusal that names a route this row cannot use is a wasted trip and a
    // lost correction. POST /:id/amend answers 409 not_a_signed_structured_report
    // for any row without a signed structured document — which is exactly what
    // reaches this branch.
    expect(res.body.message ?? "").not.toContain("/:id/amend");

    const after = await row(id);
    // The original signing instant and signer survive the attempt untouched.
    expect(after.signedByName).toBe(first.signedByName);
    expect(after.signedAt?.getTime()).toBe(first.signedAt?.getTime());
    const audits = await auditRowsFor(id, "legacy_sign_rejected");
    expect(audits.some((a) => a.reason === "already_signed")).toBe(true);
  });

  // ── Phase 5 #5 — critical state cannot be improperly cleared ──────────────

  it("#5 the critical flag cannot be cleared on a signed report", async () => {
    const id = await newDraft({ isCritical: true, criticalNote: "Informed Dr. Mehta." });
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});

    const res = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ isCritical: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("critical_state_immutable");

    const r = await row(id);
    expect(r.isCritical).toBe(true);
    expect(r.criticalNote).toBe("Informed Dr. Mehta.");
  });

  it("#5 an acknowledgement cannot be erased — not even on a still-unsigned draft", async () => {
    const id = await newDraft({ isCritical: true, criticalNote: "Informed Dr. Mehta." });
    const ack = await request(app)
      .post(`/api/patient-reports/${id}/acknowledge-critical`)
      .set("Authorization", `Bearer ${otherToken}`)
      // The caller names somebody else; the session must win.
      .send({ acknowledgedBy: "Dr. Not The Acknowledger" });
    expect(ack.status).toBe(200);

    const acked = await row(id);
    expect(acked.criticalAcknowledgedBy).toBe(OTHER_NAME);
    expect(acked.criticalAcknowledgedAt).toBeTruthy();
    expect(acked.status).toBe("draft"); // acknowledgement alone does not sign

    // Now try to clear the flag, and separately to blank the note.
    const clearFlag = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ isCritical: false });
    expect(clearFlag.status).toBe(409);
    expect(clearFlag.body.error).toBe("critical_state_immutable");

    const clearNote = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ criticalNote: "" });
    expect(clearNote.status).toBe(409);

    const r = await row(id);
    expect(r.isCritical).toBe(true);
    expect(r.criticalNote).toBe("Informed Dr. Mehta.");
    expect(r.criticalAcknowledgedBy).toBe(OTHER_NAME);

    const audits = await auditRowsFor(id, "critical_acknowledged");
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toContain(OTHER_NAME);
  });

  it("#5 escalating a signed report TO critical is still allowed — the safe direction stays open", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    expect((await row(id)).isCritical).toBe(false);

    const res = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ isCritical: true, criticalNote: "Escalated after review." });
    expect(res.status).toBe(200);

    const r = await row(id);
    expect(r.isCritical).toBe(true);
    expect(r.criticalNote).toBe("Escalated after review.");
    expect(r.body).toBe("ORIGINAL SIGNED BODY"); // content still untouched
    const audits = await auditRowsFor(id, "critical_state_changed");
    expect(audits).toHaveLength(1);
  });

  it("#5 an unauthenticated caller cannot acknowledge a critical result under a typed name", async () => {
    const id = await newDraft({ isCritical: true });
    const res = await request(app)
      .post(`/api/patient-reports/${id}/acknowledge-critical`)
      // No Authorization header at all.
      .send({ acknowledgedBy: "Whoever Typed This" });
    // 401 from requireStaffAuth, which answers before the handler runs — so the
    // handler's own acknowledger_identity_unavailable is unreachable defense in
    // depth here, not the response. Asserting that string instead would pin the
    // test to which of two layers refuses, when the claim is that the typed name
    // never becomes the record. The row state below is that claim.
    expect(res.status).toBe(401);
    const r = await row(id);
    expect(r.criticalAcknowledgedBy).toBeNull();
    expect(r.criticalAcknowledgedAt).toBeNull();
  });

  it("#5 a non-critical report cannot be given a fake acknowledgement record", async () => {
    const id = await newDraft();
    const res = await request(app)
      .post(`/api/patient-reports/${id}/acknowledge-critical`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_a_critical_report");
    expect((await row(id)).criticalAcknowledgedAt).toBeNull();
  });

  // ── Phase 5 #2 — the unsigned workflow is unchanged ───────────────────────

  it("#2 verify still needs a DIFFERENT person, and names the session not the body", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});

    // Same person verifying their own report must still be refused.
    const selfVerify = await request(app)
      .post(`/api/patient-reports/${id}/verify`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ verifiedByName: OTHER_NAME }); // claiming to be the other doctor
    expect(selfVerify.status).toBe(409);
    expect((await row(id)).status).toBe("pending_verification");

    const res = await request(app)
      .post(`/api/patient-reports/${id}/verify`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ verifiedByName: "Dr. Somebody Else Entirely", verifierNotes: "Checked against source." });
    expect(res.status).toBe(200);

    const r = await row(id);
    expect(r.verifiedByName).toBe(OTHER_NAME);
    expect(r.verifiedByName).not.toBe("Dr. Somebody Else Entirely");
    expect(r.status).toBe("verified");
    expect(r.signedByName).toBe(SIGNER_NAME); // signer attribution unchanged
    expect(r.body).toBe("ORIGINAL SIGNED BODY");

    const audits = await auditRowsFor(id, "legacy_verify");
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toContain(`"rejectedCallerName":"Dr. Somebody Else Entirely"`);
  });

  it("#2/#3 a verified report is still immutable, and its critical flag still cannot be cleared", async () => {
    const id = await newDraft({ isCritical: true, criticalNote: "Told the ward." });
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    await request(app).post(`/api/patient-reports/${id}/verify`).set("Authorization", `Bearer ${otherToken}`).send({});
    expect((await row(id)).status).toBe("verified");

    const edit = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ body: "POST-VERIFICATION REWRITE" });
    expect(edit.status).toBe(409);

    const clear = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ isCritical: false });
    expect(clear.status).toBe(409);

    const r = await row(id);
    expect(r.body).toBe("ORIGINAL SIGNED BODY");
    expect(r.isCritical).toBe(true);
  });

  // ── Signature withdrawal: the correction path, and its limits ─────────────

  it("withdrawing a signature returns the report to an editable draft, attributed and audited", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const signed = await row(id);

    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ reason: "Wrong specimen labelled on the report." });
    expect(res.status).toBe(200);

    const r = await row(id);
    expect(r.status).toBe("draft");
    expect(r.signedByName).toBeNull();
    expect(r.signedAt).toBeNull();
    expect(r.signatureId).toBeNull();
    // The content survives — this un-signs, it does not delete or blank.
    expect(r.body).toBe(signed.body);

    // Phase 5 #1 again, but on a row that was signed and then withdrawn.
    const edit = await request(app)
      .patch(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ body: "CORRECTED BODY" });
    expect(edit.status).toBe(200);
    expect((await row(id)).body).toBe("CORRECTED BODY");

    const audits = await auditRowsFor(id, "signature_withdrawn");
    expect(audits).toHaveLength(1);
    // The withdrawn attribution is preserved in the audit row, not lost.
    expect(audits[0].newValue).toContain(SIGNER_NAME);
    expect(audits[0].newValue).toContain("Wrong specimen labelled");
  });

  it("withdrawal requires a reason — an unattributed un-signing is not a correction", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ reason: "   " });
    expect(res.status).toBe(400);
    expect((await row(id)).status).toBe("pending_verification"); // still signed
  });

  it("somebody who is neither the signer nor an admin cannot withdraw the signature", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});

    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ reason: "I would like this unsigned." });
    expect(res.status).toBe(403);

    const r = await row(id);
    expect(r.status).toBe("pending_verification");
    expect(r.signedByName).toBe(SIGNER_NAME);
    const audits = await auditRowsFor(id, "signature_withdrawn");
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toContain('"outcome":"rejected"');
  });

  it("a VERIFIED report's signature cannot be withdrawn, and a legacy one is not sent to amend", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    await request(app).post(`/api/patient-reports/${id}/verify`).set("Authorization", `Bearer ${otherToken}`).send({});

    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ reason: "Too late, but trying." });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_verified");
    // This row was created on the legacy path, so it carries no structured
    // document and POST /:id/amend refuses it. Offering amend here would send
    // staff to an endpoint whose only reply is another 409.
    expect(res.body.message ?? "").not.toContain("/:id/amend");
    expect((await row(id)).status).toBe("verified"); // countersignature intact
  });

  it("an unsigned report has nothing to withdraw", async () => {
    const id = await newDraft();
    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .set("Authorization", `Bearer ${signerToken}`)
      .send({ reason: "Un-sign something that was never signed." });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_signed");
  });

  it("an unauthenticated caller cannot withdraw a signature", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});
    const res = await request(app)
      .post(`/api/patient-reports/${id}/withdraw-signature`)
      .send({ reason: "No session." });
    expect(res.status).toBe(401);
    expect((await row(id)).status).toBe("pending_verification");
  });

  // ── Phase 5 #10, #11, #12 — the signed artifact is still retrievable ──────

  it("#10/#11/#12 the signed artifact is readable and byte-identical after signing", async () => {
    const id = await newDraft();
    await request(app).post(`/api/patient-reports/${id}/sign`).set("Authorization", `Bearer ${signerToken}`).send({});

    const get = await request(app)
      .get(`/api/patient-reports/${id}`)
      .set("Authorization", `Bearer ${signerToken}`);
    expect(get.status).toBe(200);
    expect(get.body.body).toContain("ORIGINAL SIGNED BODY");
    expect(get.body.signedByName).toBe(SIGNER_NAME);
    expect(get.body.signedAt).toBeTruthy();
    expect(get.body.status).toBe("pending_verification");
  });
});
