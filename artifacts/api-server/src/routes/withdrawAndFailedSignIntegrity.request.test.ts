/**
 * Two signing-integrity suspicions, executed against real HTTP + real Postgres.
 *
 * SUSPICION 1 — withdrawal followed by re-finalize creates a SECOND report row
 * for one study.  `POST /api/patient-reports/:id/withdraw-signature`
 * (patient-reports.ts:3274) sets the row back to `status:"draft"` and clears
 * `radiology_worklist.reportId` (:3385-3396).  The create path recognises an
 * existing report ONLY through `bound.worklist.reportId` (:2366), and
 * `patient_reports` has no unique index on `study_id` (lib/db/src/schema/
 * patientReports.ts:84-92 — only `report_number` and `public_token` are
 * unique).  So after a withdrawal the same study can be finalized again and
 * gets a fresh row while the withdrawn row stays in the table.
 *
 * SUSPICION 2 (RE-SCOPED — see the block above the sign-refusal cases) — a failed
 * signature leg leaves the study marked final over an unsigned row.  Measured
 * here: `POST /api/internal/radiology/report-status` accepts a REPORT_FINAL flip
 * while `patient_reports.status` is still `draft` and `signed_at IS NULL`, for
 * every refusal the sign route produces AND when no sign call is made at all.
 * That door is not the defect: closing a worklist before its report is signed is
 * a legitimate order that four shipped suites depend on.  The defect is the
 * finalize CLIENT sending the flip after its own sign leg failed, and that is
 * fixed and tested in
 * `artifacts/diagnostic-erp/src/lib/finalizeUnsignedStudyStaysOpen.test.ts`.
 *
 * Every assertion below is an executed HTTP call plus a re-read of stored rows.
 * No source-text greps.  Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  patientsTable,
  testsTable,
  ordersTable,
  orderTestsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
  signaturesTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

type ReportRow = typeof patientReportsTable.$inferSelect;
type WorklistRow = typeof radiologyWorklistTable.$inferSelect;

describe.skipIf(!dbReady)("withdrawal re-finalize + failed-sign integrity — request level", () => {
  let app: Express;
  const marker = `wfsign-${randomUUID().slice(0, 8)}`;
  const today = new Date().toISOString().slice(0, 10);

  const SIGNER_NAME = `Dr. Signer ${marker}`;
  const OTHER_NAME = `Dr. Other ${marker}`;

  // Three sessions: the signing radiologist, a typist (SIGN_DENY_ROLES, so the
  // sign route's role gate refuses it), and a second doctor who owns a foreign
  // signature block.
  const signerToken = `vitest-token-${randomUUID()}`;
  const typistToken = `vitest-token-${randomUUID()}`;
  const otherToken = `vitest-token-${randomUUID()}`;
  const auth = { Authorization: `Bearer ${signerToken}` };
  const typistAuth = { Authorization: `Bearer ${typistToken}` };

  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let ownActiveSig = 0;
  let ownInactiveSig = 0;
  let foreignSig = 0;
  const userIds: number[] = [];
  const reportIds: number[] = [];
  const worklistIds: number[] = [];
  const studyIds: number[] = [];
  let seq = 0;

  async function report(id: number): Promise<ReportRow> {
    const [r] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, id));
    if (!r) throw new Error(`report ${id} vanished`);
    return r;
  }
  async function worklist(id: number): Promise<WorklistRow> {
    const [w] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    if (!w) throw new Error(`worklist ${id} vanished`);
    return w;
  }

  /** A billed radiology study with a GREEN/APPROVED worklist row behind it. */
  async function newCase(tag: string) {
    seq += 1;
    const [ot] = await db
      .insert(orderTestsTable)
      .values({ orderId, testId, price: "5000" })
      .returning();
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-${tag}`,
        orderId,
        orderTestId: ot.id,
        patientId,
        testId,
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "scheduled",
      } as never)
      .returning();
    studyIds.push(study.id);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Probe Patient ${tag}`,
        patientId,
        studyId: study.id,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        accessionNumber: `ACC-${tag}`,
        studyInstanceUID: `1.2.840.wfsign.${seq}.${marker}`,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
      } as never)
      .returning();
    worklistIds.push(wl.id);
    return { studyId: study.id, worklistId: wl.id, accessionNumber: wl.accessionNumber, tag };
  }

  /** The workspace create leg. `patient_reports.study_id` holds the WORKLIST ROW id. */
  async function createReport(c: Awaited<ReturnType<typeof newCase>>, title: string, findings: string) {
    const res = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: c.worklistId,
        worklistId: c.worklistId,
        title,
        body: `<p>${findings}</p>`,
        impression: `IMPRESSION ${c.tag}`,
      });
    expect([200, 201], `create ${title}: ${res.status} ${res.text}`).toContain(res.status);
    const id = res.body.id as number;
    reportIds.push(id);
    return { id, idempotent: res.body.idempotent === true, status: res.status };
  }

  async function flipFinal(
    c: { worklistId: number; accessionNumber: string | null },
    reportId: number | null,
  ) {
    const res = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(auth)
      .send({
        worklistId: c.worklistId,
        accessionNumber: c.accessionNumber,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: SIGNER_NAME,
      });
    return res;
  }

  function sign(reportId: number, body: Record<string, unknown>, headers = auth) {
    return request(app).post(`/api/patient-reports/${reportId}/sign`).set(headers).send(body);
  }

  function withdraw(reportId: number) {
    return request(app)
      .post(`/api/patient-reports/${reportId}/withdraw-signature`)
      .set(auth)
      .send({ reason: `Wrong side recorded ${marker}` });
  }

  /** One-line dump of exactly the fields the two suspicions turn on. */
  function stateOf(r: ReportRow, w: WorklistRow) {
    return (
      `worklist#${w.id}.status=${w.status} worklist#${w.id}.reportId=${w.reportId} ` +
      `deliveryStatus=${w.deliveryStatus} || report#${r.id}: status=${r.status} ` +
      `signed_at=${r.signedAt ? r.signedAt.toISOString() : "NULL"} signedByName=${r.signedByName} ` +
      `signatureId=${r.signatureId} report_number=${r.reportNumber} study_id=${r.studyId}`
    );
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [signer] = await db
      .insert(usersTable)
      .values({
        name: SIGNER_NAME,
        email: `wfsign-${marker}@vitest.invalid`,
        username: `wfsign-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(signer.id);
    const [typist] = await db
      .insert(usersTable)
      .values({
        name: `Typist ${marker}`,
        email: `wfsign-typist-${marker}@vitest.invalid`,
        username: `wfsign-typist-${marker}`,
        role: "typist",
        permissions: JSON.stringify(["/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(typist.id);
    const [other] = await db
      .insert(usersTable)
      .values({
        name: OTHER_NAME,
        email: `wfsign-other-${marker}@vitest.invalid`,
        username: `wfsign-other-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userIds.push(other.id);

    for (const [token, u] of [
      [signerToken, signer],
      [typistToken, typist],
      [otherToken, other],
    ] as const) {
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: u.id,
        subjectName: u.name,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
    }

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `WFSIGN-${marker}`,
        firstName: "Probe",
        lastName: `Withdrawal ${marker}`,
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [test] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `MR${marker.slice(-4).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = test.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${marker}`, patientId, status: "pending" })
      .returning();
    orderId = order.id;

    const [sig] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNER_NAME,
        role: "Radiologist",
        qualification: "MD (Radio-diagnosis)",
        registrationNo: `REG-${marker}`,
        userId: signer.id,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    ownActiveSig = sig.id;

    // The block the workspace's SignDialog would have to pick when the only
    // block on file has been deactivated — `authorizeSignatureBlock` refuses it
    // with `signature_not_active` (signedArtifactGuard.ts:208).
    const [inactive] = await db
      .insert(signaturesTable)
      .values({
        name: SIGNER_NAME,
        role: "Radiologist",
        qualification: "MD (Radio-diagnosis)",
        registrationNo: `REG-INACTIVE-${marker}`,
        userId: signer.id,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: false,
      })
      .returning();
    ownInactiveSig = inactive.id;

    const [foreign] = await db
      .insert(signaturesTable)
      .values({
        name: OTHER_NAME,
        role: "Radiologist",
        qualification: "MD (Radio-diagnosis)",
        registrationNo: `REG-FOREIGN-${marker}`,
        userId: other.id,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        isActive: true,
      })
      .returning();
    foreignSig = foreign.id;
  }, 120_000);

  afterAll(async () => {
    for (const id of reportIds) {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.entityId, String(id))).catch(() => {});
    }
    for (const id of worklistIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id)).catch(() => {});
    }
    for (const id of studyIds) {
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id)).catch(() => {});
    }
    await db.delete(patientReportsTable).where(eq(patientReportsTable.patientId, patientId)).catch(() => {});
    await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    for (const s of [ownActiveSig, ownInactiveSig, foreignSig]) {
      await db.delete(signaturesTable).where(eq(signaturesTable.id, s)).catch(() => {});
    }
    for (const t of [signerToken, typistToken, otherToken]) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, t)).catch(() => {});
    }
    for (const u of userIds) {
      await db.delete(usersTable).where(eq(usersTable.id, u)).catch(() => {});
    }
  }, 90_000);

  // ── SUSPICION 1 ────────────────────────────────────────────────────────────
  it("one study keeps exactly ONE live report across withdraw → re-finalize", async () => {
    const c = await newCase(`${marker}-dup`);

    const first = await createReport(c, `MRI Brain ${c.tag}`, `ORIGINAL FINDINGS ${c.tag}`);
    expect(first.idempotent, `first create must actually write: ${JSON.stringify(first)}`).toBe(false);
    expect((await worklist(c.worklistId)).reportId, "create binds the worklist row").toBe(first.id);

    const flipped = await flipFinal(c, first.id);
    expect(flipped.status, `report-status: ${flipped.text}`).toBe(200);

    const signed = await sign(first.id, { signatureId: ownActiveSig });
    expect([200, 201], `sign: ${signed.status} ${signed.text}`).toContain(signed.status);
    const signedRow = await report(first.id);
    expect(signedRow.signedAt, "the fixture must start from a genuinely signed row").not.toBeNull();
    expect(signedRow.status).toBe("pending_verification");

    // Withdraw: row back to draft, worklist pointer cleared.
    const wd = await withdraw(first.id);
    expect(wd.status, `withdraw: ${wd.text}`).toBe(200);
    const withdrawnRow = await report(first.id);
    expect(withdrawnRow.status).toBe("draft");
    expect(withdrawnRow.signedAt).toBeNull();
    const reopened = await worklist(c.worklistId);
    expect(reopened.status).toBe("REPORT_IN_PROGRESS");
    expect(reopened.reportId).toBeNull();

    // Re-finalize the SAME study through the normal create path.
    const again = await createReport(c, `MRI Brain ${c.tag} corrected`, `CORRECTED FINDINGS ${c.tag}`);
    // Writing through the study's existing row must not become the other failure
    // mode: the `idempotent` branch hands back the OLD row and DISCARDS the body
    // this call carried. Here the corrected words are what the row holds, under the
    // report number the study already had.
    expect(again.id, "the re-finalize wrote through the study's existing row instead of adding a second one").toBe(first.id);
    const afterRefinalize = await report(first.id);
    expect(
      String(afterRefinalize.body),
      `the corrected content was discarded — body after re-finalize: ${String(afterRefinalize.body).slice(0, 200)}`,
    ).toContain(`CORRECTED FINDINGS ${c.tag}`);
    expect(String(afterRefinalize.title)).toBe(`MRI Brain ${c.tag} corrected`);
    expect(
      afterRefinalize.reportNumber,
      `report number changed on re-finalize: ${signedRow.reportNumber} → ${afterRefinalize.reportNumber}`,
    ).toBe(signedRow.reportNumber);
    expect(again.idempotent, "content WAS written, so this is not an idempotent hand-back").toBe(false);
    const reflied = await flipFinal(c, again.id);
    expect(reflied.status, `report-status 2: ${reflied.text}`).toBe(200);
    const resigned = await sign(again.id, { signatureId: ownActiveSig });
    expect([200, 201], `re-sign: ${resigned.status} ${resigned.text}`).toContain(resigned.status);

    // Is the withdrawn row still visible to Report Hub? (list route, real rows)
    const hub = await request(app).get(`/api/patient-reports?patientId=${patientId}&limit=200`).set(auth);
    expect(hub.status, hub.text).toBe(200);
    const listedIds: number[] = (hub.body.items ?? []).map((i: { id: number }) => Number(i.id));
    const withdrawnStillListed = listedIds.includes(first.id);

    // Is it still SIGNABLE?  Nothing marks it superseded, so the route has no
    // reason to refuse it.  Executed, not asserted — the row count below is the
    // load-bearing claim.
    const resignWithdrawn = await sign(first.id, { signatureId: ownActiveSig });
    const withdrawnAfter = await report(first.id);

    const allRows = await db.select().from(patientReportsTable).where(eq(patientReportsTable.studyId, c.worklistId));
    const boundTo = (await worklist(c.worklistId)).reportId;
    const liveRows = allRows.filter((r) => r.status !== "superseded");
    const boundRows = liveRows.filter((r) => r.id === boundTo);
    const signedRows = liveRows.filter((r) => r.signedAt !== null);

    const evidence = liveRows.map((r) => ({
      id: r.id,
      status: r.status,
      reportNumber: r.reportNumber,
      signed_at: r.signedAt ? r.signedAt.toISOString() : null,
      signedByName: r.signedByName,
      studyId: r.studyId,
      createdAt: r.createdAt ? new Date(r.createdAt as unknown as Date).toISOString() : null,
    }));
    // eslint-disable-next-line no-console
    console.log(
      `\n[wfsign-1] study(radiology_studies.id)=${c.studyId} worklist row=${c.worklistId} accession=${c.accessionNumber}\n` +
        `[wfsign-1] report rows for this study (${liveRows.length}): ${JSON.stringify(evidence, null, 2)}\n` +
        `[wfsign-1] withdrawn row ${first.id} still in Report Hub's list route: ${withdrawnStillListed}\n` +
        `[wfsign-1] re-signing the withdrawn row answered HTTP ${resignWithdrawn.status} ${resignWithdrawn.text.slice(0, 160)} ` +
        `→ its stored state became status=${withdrawnAfter.status} signed_at=${withdrawnAfter.signedAt ? withdrawnAfter.signedAt.toISOString() : "NULL"}\n`,
    );

    // The load-bearing invariant: one study, one live report.
    expect(
      liveRows.map((r) => `${r.id}/${r.status}/${r.reportNumber}`),
      `study ${c.studyId} (worklist row ${c.worklistId}) must hold exactly one live patient_reports row; observed ${liveRows.length}`,
    ).toHaveLength(1);
    expect(signedRows.length, `signed rows for one study: ${JSON.stringify(evidence)}`).toBeLessThanOrEqual(1);
    expect(boundRows.length, `live rows bound to the worklist pointer: ${JSON.stringify(evidence)}`).toBe(1);
  }, 120_000);

  // ── SUSPICION 2 — RE-SCOPED BY MEASUREMENT ─────────────────────────────────
  // The suspicion was "a failed signature leaves the study marked final", and the
  // server door looked like where to fix it. It is not: POST
  // /api/internal/radiology/report-status legitimately receives a REPORT_FINAL
  // flip for a row that is not signed yet — four shipped suites depend on that
  // order (`finalizeStudyIdAuthority`, `radiologyHardening`, `signedReportWitness`,
  // `signatureWithdrawalReopensStudy` all flip, assert 200, then sign), and the
  // route's own comment says so (internal-radiology.ts:1318, "the row is
  // legitimately unsigned at this instant"). A gate here would refuse those flows
  // rather than the defect.
  //
  // The defect is that the finalize CLIENT sent the flip after ITS OWN sign leg
  // failed or was skipped — the only party that knows that. Corrected in
  // `diagnostic-erp/src/lib/radiologyReportLifecycle.ts`, pinned by
  // `finalizeUnsignedStudyStaysOpen.test.ts` (mutation-verified: restoring the
  // pre-fix condition turns 4 of its 9 tests red and leaves its 2 controls green).
  //
  // What is kept below is the measured vocabulary — the three refusals that are
  // why a signature does not happen — plus a characterisation of what this door
  // leaves behind, so a change to either is visible and deliberate.

  // ── OWNER CONDITION ON THE REUSED ROW (decision 1) ─────────────────────────
  // Reusing the withdrawn row keeps one live report per study, but it also means
  // the corrected text lands ON TOP of the row that carried the signed one. The
  // condition is that the signed version, its signer and its signing time stay
  // recoverable for medico-legal purposes. `audit_logs` is that clinic's only
  // append-only, hash-chained history, so this drives the real sequence and then
  // recovers the signed version from it.
  it("the signed version stays recoverable after the corrected report reuses the row", async () => {
    const c = await newCase(`${marker}-history`);
    const originalFindings = `Right-sided lesion, described in full. ${c.tag}`;
    const first = await createReport(c, `MRI Brain ${c.tag}`, originalFindings);

    const signed = await sign(first.id, { signatureId: ownActiveSig });
    expect(signed.status, `sign: ${signed.text}`).toBe(200);

    const atSigning = await report(first.id);
    const originalBody = atSigning.body as string;
    const originalTitle = atSigning.title as string;
    const originalImpression = atSigning.impression as string;
    const originalSignatureId = atSigning.signatureId;
    expect(originalBody).toContain(originalFindings);
    expect(atSigning.signedByName).toBe(SIGNER_NAME);
    expect(atSigning.signedAt, "a signed row must carry a signing time").not.toBeNull();
    const signedAtIso = atSigning.signedAt!.toISOString();

    const wd = await withdraw(first.id);
    expect(wd.status, `withdraw: ${wd.text}`).toBe(200);

    // Re-finalize the same study — the correction that reuses the row.
    const corrected = await createReport(c, `MRI Brain ${c.tag} corrected`, "Left-sided lesion, corrected.");
    expect(corrected.id, "the corrected report must reuse the withdrawn row").toBe(first.id);

    const afterCorrection = await report(first.id);
    expect(afterCorrection.body).toContain("Left-sided");
    expect(
      afterCorrection.body,
      "the signed text no longer lives on the row — which is exactly why the audit snapshot must",
    ).not.toContain(originalFindings);

    const [trail] = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.entityId, String(first.id)),
          eq(auditLogsTable.action, "signature_withdrawn"),
        ),
      )
      .limit(1);
    expect(trail, "the withdrawal must be recorded in the append-only trail").toBeDefined();
    expect(trail.chainHash, "the row must sit inside the tamper-evident hash chain").not.toBe("");

    // (a) the clinical content, byte-for-byte
    const snapshot = JSON.parse(String(trail.oldValue)) as {
      title: string | null;
      body: string | null;
      impression: string | null;
      parameters: string | null;
    };
    expect(snapshot.body, "the signed Findings must be recoverable").toBe(originalBody);
    expect(snapshot.title).toBe(originalTitle);
    expect(snapshot.impression).toBe(originalImpression);

    // (b) who signed, when, on which block, and who undid it and why
    const evt = JSON.parse(String(trail.newValue)) as {
      withdrawn: { signedByName: string | null; signedAt: string | null; signatureId: number | null };
      signedContentBytes: number;
      signedContentSha256: string;
    };
    expect(evt.withdrawn.signedByName).toBe(SIGNER_NAME);
    expect(String(evt.withdrawn.signedAt)).toBe(signedAtIso);
    expect(evt.withdrawn.signatureId).toBe(originalSignatureId);
    expect(trail.userName).toBe(SIGNER_NAME);
    expect(String(trail.reason)).toContain("Wrong side recorded");

    // (c) the snapshot survived the audit writer's own 64KB slice intact
    expect(evt.signedContentBytes).toBe(Buffer.byteLength(String(trail.oldValue)));
    expect(evt.signedContentSha256).toBe(createHash("sha256").update(String(trail.oldValue)).digest("hex"));
  }, 120_000);

  async function finalisedWithRefusedSign(
    label: string,
    signCall: (reportId: number) => Promise<Awaited<ReturnType<typeof sign>>>,
  ) {
    const c = await newCase(`${marker}-${label}`);
    const created = await createReport(c, `MRI Brain ${c.tag}`, `FINDINGS ${c.tag}`);
    const flipped = await flipFinal(c, created.id);
    expect(flipped.status, `report-status: ${flipped.text}`).toBe(200);

    const refused = await signCall(created.id);
    const row = await report(created.id);
    const wl = await worklist(c.worklistId);
    const refusal = `HTTP ${refused.status} ${String(refused.text).slice(0, 200)}`;
    // eslint-disable-next-line no-console
    console.log(`[wfsign-2:${label}] sign refusal → ${refusal}\n[wfsign-2:${label}] ${stateOf(row, wl)}\n`);
    return { c, reportId: created.id, row, wl, refusal };
  }

  it("sign refused (inactive block): no signature is written, and this door still closes the study by design", async () => {
    const { row, wl, refusal } = await finalisedWithRefusedSign("inactive-block", (id) =>
      sign(id, { signatureId: ownInactiveSig }),
    );
    // The refusal itself is the expected, correct behaviour.
    expect(refusal).toContain("signature_not_active");
    expect(row.signedAt, `the refused row must carry no signature: ${JSON.stringify(refusal)}`).toBeNull();

    // The finding: the study closed anyway. Characterised, not approved — the
    // client gate is where the fix stands.
    expect(
      `${wl.status}|${row.status}|${row.signedAt === null ? "unsigned" : "signed"}`,
      `the pre-sign REPORT_FINAL door changed its behaviour — ${stateOf(row, wl)} | sign attempt: ${refusal}`,
    ).toBe("REPORT_FINAL|draft|unsigned");
  }, 120_000);

  it("sign refused (another doctor's block): no signature is written, and this door still closes the study by design", async () => {
    const { row, wl, refusal } = await finalisedWithRefusedSign("foreign-block", (id) =>
      sign(id, { signatureId: foreignSig }),
    );
    expect(refusal).toContain("signature_not_yours");
    expect(row.signedAt, `the refused row must carry no signature: ${JSON.stringify(refusal)}`).toBeNull();

    expect(
      `${wl.status}|${row.status}|${row.signedAt === null ? "unsigned" : "signed"}`,
      `the pre-sign REPORT_FINAL door changed its behaviour — ${stateOf(row, wl)} | sign attempt: ${refusal}`,
    ).toBe("REPORT_FINAL|draft|unsigned");
  }, 120_000);

  it("sign refused (role_cannot_sign on a typist session): no signature is written", async () => {
    const { row, wl, refusal } = await finalisedWithRefusedSign("role-cannot-sign", (id) =>
      sign(id, { signatureId: ownActiveSig }, typistAuth),
    );
    expect(refusal).toContain("role_cannot_sign");
    expect(row.signedAt, `the refused row must carry no signature: ${JSON.stringify(refusal)}`).toBeNull();

    expect(
      `${wl.status}|${row.status}|${row.signedAt === null ? "unsigned" : "signed"}`,
      `the pre-sign REPORT_FINAL door changed its behaviour — ${stateOf(row, wl)} | sign attempt: ${refusal}`,
    ).toBe("REPORT_FINAL|draft|unsigned");
  }, 120_000);

  it("the sign leg being SKIPPED (no call at all) is the state the finalize client must not flip on", async () => {
    // autoSignReport (radiologyReportLifecycle.ts:320-345) does not even attempt
    // POST /:id/sign when the clinic has no eligible active block, or when more
    // than one is on file — it returns `{signed:false, signError}` and the
    // caller goes on to send the REPORT_FINAL flip regardless. That is this
    // test: create + flip, no sign call.
    const c = await newCase(`${marker}-skipped`);
    const created = await createReport(c, `MRI Brain ${c.tag}`, `FINDINGS ${c.tag}`);
    const flipped = await flipFinal(c, created.id);
    expect(flipped.status, `report-status: ${flipped.text}`).toBe(200);

    const row = await report(created.id);
    const wl = await worklist(c.worklistId);
    // eslint-disable-next-line no-console
    console.log(`[wfsign-2:skipped-sign] ${stateOf(row, wl)}\n`);

    expect(
      `${wl.status}|${row.status}|${row.signedAt === null ? "unsigned" : "signed"}`,
      `the pre-sign REPORT_FINAL door changed its behaviour — ${stateOf(row, wl)} | sign leg: never called`,
    ).toBe("REPORT_FINAL|draft|unsigned");
  }, 120_000);

  it("which refusals could NOT be produced from this route, recorded rather than manufactured", async () => {
    const c = await newCase(`${marker}-nonrefusal`);
    const created = await createReport(c, `MRI Brain ${c.tag}`, `FINDINGS ${c.tag}`);

    // (a) "no signature block passed" is NOT a refusal: the session name signs.
    const noBlock = await sign(created.id, {});
    const afterNoBlock = await report(created.id);
    expect([200, 201], `sign with no signatureId: ${noBlock.status} ${noBlock.text}`).toContain(noBlock.status);
    expect(afterNoBlock.signedByName).toBe(SIGNER_NAME);

    // (b) a nonexistent signature id is a refusal (404) — proven on a fresh row
    // so it does not disturb the row above.
    const c2 = await newCase(`${marker}-404`);
    const created2 = await createReport(c2, `MRI Brain ${c2.tag}`, `FINDINGS ${c2.tag}`);
    const flip2 = await flipFinal(c2, created2.id);
    expect(flip2.status, flip2.text).toBe(200);
    const badBlock = await sign(created2.id, { signatureId: 2147483000 });
    const row2 = await report(created2.id);
    expect(badBlock.status).toBe(404);
    // eslint-disable-next-line no-console
    console.log(
      `[wfsign-2] no-block sign is ACCEPTED (status ${noBlock.status}, signedByName ${afterNoBlock.signedByName}); ` +
        `unknown signatureId refused with HTTP ${badBlock.status} → ${stateOf(row2, await worklist(c2.worklistId))}\n`,
    );

    // (c) the content guard cannot be reached from this sequence: the create leg
    // runs the same assessment first, so an unsignable body never gets a row.
    // Its own fresh worklist row, because a create against an already-bound one
    // short-circuits on `bound.worklist.reportId` before the guard is the point.
    const c3 = await newCase(`${marker}-contentguard`);
    const emptyCreate = await request(app)
      .post("/api/patient-reports")
      .set(auth)
      .send({
        type: "radiology",
        patientId,
        testId,
        studyId: c3.worklistId,
        worklistId: c3.worklistId,
        title: `Empty ${c3.tag}`,
        body: "<p></p>",
        impression: "",
      });
    expect(emptyCreate.status, `empty-body create: ${emptyCreate.status} ${emptyCreate.text}`).toBeGreaterThanOrEqual(400);
    expect(String(emptyCreate.body?.code ?? emptyCreate.text), emptyCreate.text).toContain("report_content");
    const orphan = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.studyId, c3.worklistId));
    expect(orphan, "the refused empty create must have written no row").toHaveLength(0);
  }, 120_000);
});
