/**
 * Can a narrow role read or change clinical radiology data?
 * — request level, real HTTP, real Postgres, production tree 5eb20a58.
 *
 * Scope note (this is ONE private diagnostic centre): the owner deliberately
 * holds admin + doctor, and manager/accountant/billing/receptionist carry the
 * front-desk lists in `routes/users.ts` DEFAULT_PERMISSIONS. None of that is a
 * finding. What WOULD be a finding is a pharmacist / cashier / receptionist /
 * nurse reaching radiology clinical data or radiology row writes, because the
 * module gate `requireStaffPermission("/radiology")` is what is supposed to
 * stop exactly that.
 *
 * Every claim below is an executed HTTP call. No assertion in this file reads
 * a source file.
 *
 * Four suspected holes, each encoded as the expectation the clinic would want,
 * so the file is RED today where the hole is real and GREEN where it is not:
 *
 *   1. `/api/internal/**` catch-all — `internal-radiology.ts:434` applies
 *      `router.use(requireStaffOrInternalAuth)` to all 23 routes and the staff
 *      branch consults no permission and no role. `GET
 *      /api/internal/patients/:patientId/contact` hands back name, mobile and
 *      email. Control: the same patient through the gated
 *      `GET /api/patients/:id` for a session that holds no `/patients`.
 *      DISPOSITION: fixed — that door now requires the `/patients` module for a
 *      staff session (the internal-key branch is untouched), and check 1 asserts
 *      PARITY with the gated door instead of a blanket refusal, because this
 *      clinic's shipped cashier list does hold `/patients`.
 *   2. `POST /api/internal/radiology/report-status` — a narrow role flipping a
 *      worklist row's status. Asserted on the ROW afterwards, not the body.
 *      `REPORT_IN_PROGRESS` is used on purpose: the REPORT_FINAL door has real
 *      compliance gates, the plain status write has none.
 *   3. Routers mounted WITHOUT the module gate — `routes/index.ts:1063-1068`
 *      puts `/radiology-lesions`, `/radiology-spine`, `/radiology-brain`,
 *      `/radiology-tumor` on bare `requireStaffAuth`, while `/radiology`
 *      (index.ts:896) carries `requireStaffPermission("/radiology")`. Reads on
 *      all four, plus the two lesion writes that exist (`PATCH /:id`; there is
 *      no DELETE route on that router, so the DELETE probe measures what is
 *      actually mounted).
 *   4. `?staffToken=` — `middleware/requireStaffAuth.ts:90-91` accepts the
 *      credential from the query string. Proved with NO Authorization header.
 *      The internal router is included because it reads the header only, which
 *      narrows the exposure: say so with a measurement, not a guess. DISPOSITION:
 *      measured and reported, not switched off — three shipped reporting
 *      surfaces depend on it and the leak is the proxy's access log, which is a
 *      baked nginx rebuild. See check 4 for the full reasoning.
 *
 * Recorded so the report is not one-sided (these PASS): `aiReporting.ts`
 * `canConfigure` on `POST /settings` and on `GET /audit-log`, and
 * `radiology-ops.ts` `requireAdminRole` — the latter also proven on a session
 * that DOES hold `/radiology`, so the 403 is attributable to the admin gate and
 * not to the mount. `GET /api/ai-reporting/settings` is check 6: its file header
 * claims `canConfigure`, its body checks session-existence only, and gating it
 * outright would take the AI model picker away from the workspace — so the
 * provider endpoint address is withheld from sessions that do not configure AI
 * and everything the reporting surface needs is proven to survive.
 *
 * PHI policy: no fixture value is interpolated into any assertion message. The
 * helpers describe key names, string lengths and array counts only. All fixture
 * people/phones/emails are synthetic and marker-scoped (`randomUUID()`), and
 * `afterAll` deletes only rows this file created.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts).
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
  patientsTable,
  testsTable,
  ordersTable,
  orderTestsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  radiologyAuditLogTable,
  radiologyLesionsTable,
  radiologyTumorFollowupsTable,
  aiProviderSettingsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

/**
 * Shape, never content. A failing assertion prints this string, so it must be
 * safe to paste into a report: field names + lengths + list counts.
 */
function shape(body: unknown): string {
  if (body === null || body === undefined) return "no-body";
  if (typeof body !== "object") return `type=${typeof body}`;
  if (Array.isArray(body)) return `array(${body.length})`;
  const parts = Object.entries(body as Record<string, unknown>).map(([k, v]) => {
    if (typeof v === "string") return `${k}:str(${v.length})`;
    if (Array.isArray(v)) {
      const first = v[0];
      const inner =
        first && typeof first === "object"
          ? `[${Object.keys(first as Record<string, unknown>).join(",")}]`
          : "";
      return `${k}:arr(${v.length})${inner}`;
    }
    if (v && typeof v === "object") return `${k}:obj`;
    return `${k}:${v === null ? "null" : typeof v}`;
  });
  return `{${parts.join(", ")}}`;
}

/** Non-sensitive booleans about PHI fields, for the failure line. */
function phiPresence(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const isFilled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  return [
    `name=${isFilled(b.name)}`,
    `mobile=${isFilled(b.mobile)}`,
    `email=${isFilled(b.email)}`,
    `sex=${isFilled(b.sex)}`,
    `age=${isFilled(b.age)}`,
    `dbId=${typeof b.dbId}`,
  ].join(" ");
}

describe.skipIf(!dbReady)("radiology staff access scope — request level", () => {
  let app: Express;
  const marker = `sc-${randomUUID().slice(0, 8)}`;

  // Three narrow sessions, so every 403 can be attributed to a specific gate.
  const cashierToken = `vitest-cashier-${randomUUID()}`;
  const noPatientsToken = `vitest-desk-${randomUUID()}`;
  const radiologyToken = `vitest-typist-${randomUUID()}`;
  // The comparison for check 6: the SAME row read by an account that configures AI.
  const adminToken = `vitest-admin-${randomUUID()}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const today = new Date().toISOString().slice(0, 10);

  let cashierId = 0;
  let noPatientsId = 0;
  let radiologyUserId = 0;
  let adminId = 0;
  let patientId = 0;
  let testId = 0;
  let orderId = 0;
  let studyId = 0;
  let worklistId = 0;
  let lesionId = 0;
  let tumorId = 0;

  /** synthetic, marker-scoped, never interpolated into a message */
  const SYNTH_PHONE = "9000000001";
  const SYNTH_EMAIL = `phi-probe-${marker}@vitest.invalid`;
  /** A LAN address that must never reach a session that does not configure AI. */
  const SYNTH_ENDPOINT = `http://127.0.0.1:40999/${marker}`;
  let providerRowPrior: Record<string, unknown> | null | undefined;

  async function readWorklist(id: number) {
    const [wl] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    return wl;
  }
  async function readLesion(id: number) {
    const [l] = await db.select().from(radiologyLesionsTable).where(eq(radiologyLesionsTable.id, id));
    return l;
  }

  beforeAll(async () => {
    app = await createTestApp();

    // 1. cashier: the repo's shipped new-staff list (users.ts ~77) verbatim.
    //    No `/radiology`, no `/reports`, no `/reports:sign`.
    const [cashier] = await db
      .insert(usersTable)
      .values({
        name: `Cashier Probe ${marker}`,
        email: `cashier-${marker}@vitest.invalid`,
        username: `cashier-${marker}`,
        role: "cashier",
        permissions: JSON.stringify(["/", "/patients", "/orders", "/billing", "/register"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    cashierId = cashier.id;

    // 2. the same narrow role with NO `/patients` — the control that separates
    //    "the internal gate is missing" from "this role already had the module".
    const [desk] = await db
      .insert(usersTable)
      .values({
        name: `Desk Probe ${marker}`,
        email: `desk-${marker}@vitest.invalid`,
        username: `desk-${marker}`,
        role: "cashier",
        permissions: JSON.stringify(["/", "/billing", "/payments", "/register"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    noPatientsId = desk.id;

    // 3. holds `/radiology` but is not admin: isolates `requireAdminRole` from
    //    the mount-level module gate in check 5.
    const [typist] = await db
      .insert(usersTable)
      .values({
        name: `Typist Probe ${marker}`,
        email: `typist-${marker}@vitest.invalid`,
        username: `typist-${marker}`,
        role: "typist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    radiologyUserId = typist.id;

    // 4. an admin session for check 6, so the AI-address redaction is proven on
    //    BOTH sides of the gate rather than by the absence of a value.
    const [admin] = await db
      .insert(usersTable)
      .values({
        name: `Admin Probe ${marker}`,
        email: `admin-${marker}@vitest.invalid`,
        username: `admin-${marker}`,
        role: "admin",
        permissions: JSON.stringify(["/", "/radiology", "/patients"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    adminId = admin.id;

    for (const [token, u] of [
      [cashierToken, cashier],
      [noPatientsToken, desk],
      [radiologyToken, typist],
      [adminToken, admin],
    ] as const) {
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: u.id,
        subjectName: u.name,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
    }

    // A provider endpoint address is seeded so check 6 measures a REAL value on
    // both sides of the gate. Restored or removed in afterAll.
    const [priorProvider] = await db
      .select()
      .from(aiProviderSettingsTable)
      .where(eq(aiProviderSettingsTable.provider, "ollama"))
      .limit(1);
    providerRowPrior = priorProvider ?? null;
    if (priorProvider) {
      await db
        .update(aiProviderSettingsTable)
        .set({ endpointUrl: SYNTH_ENDPOINT, isEnabled: true })
        .where(eq(aiProviderSettingsTable.provider, "ollama"));
    } else {
      await db
        .insert(aiProviderSettingsTable)
        .values({ provider: "ollama", endpointUrl: SYNTH_ENDPOINT, isEnabled: true });
    }

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker.toUpperCase()}`,
        firstName: "Probe",
        lastName: marker,
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: SYNTH_PHONE,
        email: SYNTH_EMAIL,
      })
      .returning();
    patientId = patient.id;

    const [t] = await db
      .insert(testsTable)
      .values({
        name: `MRI Brain ${marker}`,
        code: `MRI${marker.slice(-4).toUpperCase()}`,
        price: "5000",
        category: "Radiology",
        department: "MRI",
        duration: "1 day",
        isActive: true,
      })
      .returning();
    testId = t.id;

    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `ORD-${marker}`, patientId, status: "pending" })
      .returning();
    orderId = order.id;
    await db.insert(orderTestsTable).values({ orderId, testId, price: "5000" });

    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        modality: "MR",
        department: "MRI",
        studyDescription: "MRI Brain",
        studyDate: today,
        status: "acquired",
        accessionNumber: `ACC-${marker}`,
        patientId,
        testId,
        orderId,
      })
      .returning();
    studyId = study.id;

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "STUDY_RECEIVED",
        patientName: `Probe ${marker}`,
        patientId,
        studyId,
        accessionNumber: `ACC-WL-${marker}`,
        studyInstanceUID: `1.2.840.scope.${marker}`,
      })
      .returning();
    worklistId = wl.id;

    // Real clinical rows, so a 200 is provably DATA and not an empty list.
    const [lesion] = await db
      .insert(radiologyLesionsTable)
      .values({
        patientId,
        lesionLabel: `lesion-${marker}`,
        location: "right frontal lobe",
        organ: "brain",
        modality: "MR",
        bodyPart: "head",
        status: "active",
        notes: `marker:${marker}`,
        firstStudyId: studyId,
      })
      .returning();
    lesionId = lesion.id;

    const [tumor] = await db
      .insert(radiologyTumorFollowupsTable)
      .values({
        patientId,
        tumorLabel: `tumor-${marker}`,
        tumorLocation: "right frontal",
        histologyType: "GBM",
        modality: "MR",
        sizeMmAxis1: "24.00",
        isBaseline: true,
        studyId,
      })
      .returning();
    tumorId = tumor.id;
  }, 90_000);

  afterAll(async () => {
    // The seeded provider endpoint goes first: it is the one row here that other
    // suites could read.
    if (providerRowPrior === null) {
      await db
        .delete(aiProviderSettingsTable)
        .where(eq(aiProviderSettingsTable.provider, "ollama"))
        .catch(() => {});
    } else if (providerRowPrior) {
      await db
        .update(aiProviderSettingsTable)
        .set(providerRowPrior as never)
        .where(eq(aiProviderSettingsTable.provider, "ollama"))
        .catch(() => {});
    }
    await db
      .delete(radiologyAuditLogTable)
      .where(eq(radiologyAuditLogTable.worklistId, worklistId))
      .catch(() => {});
    for (const id of [lesionId, tumorId]) {
      if (!id) continue;
      await db.delete(radiologyLesionsTable).where(eq(radiologyLesionsTable.id, id)).catch(() => {});
      await db.delete(radiologyTumorFollowupsTable).where(eq(radiologyTumorFollowupsTable.id, id)).catch(() => {});
    }
    if (worklistId) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    if (studyId) await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).catch(() => {});
    await db
      .delete(auditLogsTable)
      .where(and(eq(auditLogsTable.entityType, "radiology_worklist"), eq(auditLogsTable.entityId, String(worklistId))))
      .catch(() => {});
    if (orderId) {
      await db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)).catch(() => {});
      await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
    }
    if (testId) await db.delete(testsTable).where(eq(testsTable.id, testId)).catch(() => {});
    if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    for (const uid of [cashierId, noPatientsId, radiologyUserId, adminId]) {
      if (uid) await db.delete(usersTable).where(eq(usersTable.id, uid)).catch(() => {});
    }
    // The sessions are the most valuable rows to remove: each one is a live
    // credential into the patient table. Deleted by token, so only rows this
    // file inserted can be touched.
    for (const token of [cashierToken, noPatientsToken, radiologyToken, adminToken]) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token)).catch(() => {});
    }
  }, 60_000);

  // ── 1 ───────────────────────────────────────────────────────────────────────
  it("check 1 — the /api/internal contact door now grants exactly what the /patients module grants", async () => {
    // THE PROBE AND THE STANDARD, side by side, per session. The internal
    // automation door used to consult no permission at all, so a session with no
    // `/patients` read name/mobile/email back from it while the gated
    // `GET /api/patients/:id` refused the same session 403. The invariant that
    // matters is PARITY: the two doors agree for the same account, so nothing is
    // reachable through automation that the module does not already allow.
    const deskGated = await request(app).get(`/api/patients/${patientId}`).set(bearer(noPatientsToken));
    expect(deskGated.status, `gated /api/patients for a no-/patients session: ${deskGated.status}`).toBe(403);

    const deskInternal = await request(app)
      .get(`/api/internal/patients/${patientId}/contact`)
      .set(bearer(noPatientsToken));
    expect(
      deskInternal.status,
      `internal contact door for the same session: ${deskInternal.status} ${phiPresence(deskInternal.body)}`,
    ).toBe(403);
    expect(deskInternal.body.mobile, "a refusal must carry no PHI").toBeUndefined();
    expect(deskInternal.body.email, "a refusal must carry no PHI").toBeUndefined();

    // The cashier legitimately holds `/patients` in this clinic's own shipped list,
    // so both doors answer for it — measured, so this file does not claim a hole
    // where the permission model says access.
    const cashierGated = await request(app).get(`/api/patients/${patientId}`).set(bearer(cashierToken));
    const cashierInternal = await request(app)
      .get(`/api/internal/patients/${patientId}/contact`)
      .set(bearer(cashierToken));
    expect(
      cashierInternal.status,
      `internal door ${cashierInternal.status} vs gated door ${cashierGated.status}: ${phiPresence(cashierInternal.body)}`,
    ).toBe(cashierGated.status);
  });

  // ── 2 ───────────────────────────────────────────────────────────────────────
  it("check 2 — a cashier must not flip a radiology worklist row's status", async () => {
    const before = await readWorklist(worklistId);
    expect(before.status, "fixture precondition").toBe("STUDY_RECEIVED");

    const flip = await request(app)
      .post("/api/internal/radiology/report-status")
      .set(bearer(cashierToken))
      .send({ worklistId, status: "REPORT_IN_PROGRESS", actor: "vitest-narrow-role" });

    const after = await readWorklist(worklistId);
    const rowState = `http=${flip.status} body=${shape(flip.body)} row.status=${after.status}`;

    expect(flip.status, `report-status write by a cashier: ${rowState}`).toBe(403);
    expect(after.status, `worklist row after the attempt: ${rowState}`).toBe("STUDY_RECEIVED");
  });

  // ── 3 ───────────────────────────────────────────────────────────────────────
  it("check 3a — /api/radiology itself does gate the narrow role (mount comparison)", async () => {
    const gated = await request(app).get("/api/radiology/worklist").set(bearer(cashierToken));
    expect(gated.status, `mounted WITH requireStaffPermission("/radiology"): ${gated.status}`).toBe(403);
  });

  it("check 3b — the four un-gated radiology routers answer the narrow role", async () => {
    const lesions = await request(app).get(`/api/radiology-lesions?patientId=${patientId}`).set(bearer(cashierToken));
    const spine = await request(app).get(`/api/radiology-spine/sessions?patientId=${patientId}`).set(bearer(cashierToken));
    const brain = await request(app).get(`/api/radiology-brain/trends?patientId=${patientId}`).set(bearer(cashierToken));
    const tumor = await request(app).get(`/api/radiology-tumor/timeline?patientId=${patientId}`).set(bearer(cashierToken));

    const seen = `lesions=${lesions.status}${shape(lesions.body)} spine=${spine.status}${shape(spine.body)} `
      + `brain=${brain.status}${shape(brain.body)} tumor=${tumor.status}${shape(tumor.body)}`;

    expect(lesions.status, `GET /api/radiology-lesions: ${seen}`).toBe(403);
    expect(spine.status, `GET /api/radiology-spine/sessions: ${seen}`).toBe(403);
    expect(brain.status, `GET /api/radiology-brain/trends: ${seen}`).toBe(403);
    expect(tumor.status, `GET /api/radiology-tumor/timeline: ${seen}`).toBe(403);
  });

  it("check 3c — and the narrow role can write and delete lesion records", async () => {
    const patch = await request(app)
      .patch(`/api/radiology-lesions/${lesionId}`)
      .set(bearer(cashierToken))
      .send({ status: "resolved", isResolved: true, notes: `marker:${marker}-tampered` });
    const afterPatch = await readLesion(lesionId);

    const deleteAttempt = await request(app)
      .delete(`/api/radiology-lesions/${lesionId}`)
      .set(bearer(cashierToken));
    const afterDelete = await readLesion(lesionId);

    const state = `patch=${patch.status}${shape(patch.body)} row.status=${afterPatch?.status ?? "gone"} `
      + `delete=${deleteAttempt.status} rowStillThere=${afterDelete ? "yes" : "no"}`;

    expect(patch.status, `PATCH /api/radiology-lesions/:id: ${state}`).toBe(403);
    expect(afterPatch?.status, `lesion row after the PATCH: ${state}`).toBe("active");
    // Whether a DELETE route is mounted at all is a measurement, not a guess.
    expect([403, 404].includes(deleteAttempt.status), `DELETE /api/radiology-lesions/:id: ${state}`).toBe(true);
    expect(deleteAttempt.status, `DELETE /api/radiology-lesions/:id: ${state}`).not.toBe(200);
  });

  // ── 4 ───────────────────────────────────────────────────────────────────────
  it("check 4 — a session credential carried in the URL query DOES authenticate: measured, and left to the owner", async () => {
    // Baseline: with no credential at all the same route is 401.
    const anonymous = await request(app).get(`/api/patients/${patientId}`);
    expect(anonymous.status, `no credential: ${anonymous.status}`).toBe(401);

    // The internal router reads the Authorization HEADER only, so a query
    // credential does not open the PHI door there — measured rather than assumed,
    // and it is the reason checks 1 and 2 could be closed by a module gate.
    const internalViaQuery = await request(app).get(
      `/api/internal/patients/${patientId}/contact?staffToken=${encodeURIComponent(cashierToken)}`,
    );
    expect(internalViaQuery.status, `internal router + query credential: ${internalViaQuery.status}`).toBe(401);

    // MEASURED FACT, not an approved behaviour: on the module-gated router a query
    // credential authenticates and the patient row comes back.
    const gatedViaQuery = await request(app).get(
      `/api/patients/${patientId}?staffToken=${encodeURIComponent(cashierToken)}`,
    );
    expect(gatedViaQuery.status, `query-parameter credential, no header: ${gatedViaQuery.status}${shape(gatedViaQuery.body)}`)
      .toBe(200);

    // Why this is reported instead of switched off — three shipped surfaces hand
    // the token in the query because the browser cannot attach a header there:
    //   · the worklist SSE stream        (pages/RadiologyWorklist.tsx `EventSource`)
    //   · the DICOMweb image bridge      (lib/browserDicomWeb.ts)
    //   · expense attachment thumbnails  (components/expenses/ExpenseAttachmentsPanel.tsx)
    // and the key-image prefix already declines it (lib/radiologyKeyImageStatic.ts),
    // which is the precedent for narrowing it further. What actually leaks is the
    // token's presence in the web proxy's access log, and `nginx.conf` is baked
    // into the web image — that is an infrastructure rebuild, outside this
    // directive's "do not modify Synology or infrastructure" limit. Recorded as a
    // remaining risk with the remedy named, not silently carried.
  });

  it("check 6 — AI provider configuration: the reporting surface keeps working, the internal address is withheld", async () => {
    // The file's own header claims `GET /settings` requires `canConfigure`; the
    // body checked only that a session exists. Gating it outright would take the
    // model picker away from the workspace (`useWorkspaceClinicalUi` and
    // `DicomViewer` both read it), so the fix withholds the field that is nobody's
    // business but the configurator's — where the clinic's patient data goes.
    const asCashier = await request(app).get("/api/ai-reporting/settings").set(bearer(cashierToken));
    const asAdmin = await request(app).get("/api/ai-reporting/settings").set(bearer(adminToken));
    expect(asCashier.status, `GET /settings (cashier): ${asCashier.status}${shape(asCashier.body)}`).toBe(200);
    expect(asAdmin.status, `GET /settings (admin): ${asAdmin.status}`).toBe(200);

    const provider = (res: typeof asCashier) =>
      ((res.body as { providers?: Record<string, Record<string, unknown>> })?.providers?.ollama ?? {});

    // Decisive on both sides of the gate: the seeded address is a real value.
    expect(provider(asAdmin).endpointUrl, "the account that configures AI still sees the endpoint").toBe(SYNTH_ENDPOINT);
    expect(provider(asCashier).hasEndpointUrl, "the narrow session still learns an endpoint is configured").toBe(true);
    expect(provider(asCashier).endpointUrl, "…but not the internal address itself").toBeNull();

    // No credential material crosses the wire in either response (`hasApiKey` is a
    // boolean; this pins that the redaction did not trade one field for another).
    expect(JSON.stringify(asCashier.body)).not.toMatch(/"apiKey"\s*:\s*"/);
    expect(JSON.stringify(asAdmin.body)).not.toMatch(/"apiKey"\s*:\s*"/);

    // And the composer's own inputs are untouched for the narrow session — the
    // reason this route is redacted rather than gated.
    for (const key of ["isEnabled", "defaultModel", "execution", "displayName", "supportsVision"]) {
      expect(provider(asCashier), `provider payload keeps ${key} for the reporting surface`).toHaveProperty(key);
    }
  });

  // ── 5 ───────────────────────────────────────────────────────────────────────
  it("check 5 — already guarded: the AI-reporting write gate and radiology-ops admin gate hold", async () => {
    // aiReporting is mounted on BARE requireStaffAuth (index.ts:1037), so a 403
    // here can only have come from the in-handler `canConfigure`.
    const settingsWrite = await request(app)
      .post("/api/ai-reporting/settings")
      .set(bearer(cashierToken))
      .send({ global: { enabled: false } });
    expect(settingsWrite.status, `POST /api/ai-reporting/settings: ${settingsWrite.status}`).toBe(403);
    const auditLog = await request(app).get("/api/ai-reporting/audit-log").set(bearer(cashierToken));
    expect(auditLog.status, `GET /api/ai-reporting/audit-log: ${auditLog.status}`).toBe(403);

    // radiology-ops: with `/radiology` held, the mount passes and only
    // `requireAdminRole` can answer — proving the admin gate itself works.
    const opsAsRadiologyStaff = await request(app).get("/api/radiology-ops/consistency").set(bearer(radiologyToken));
    expect(opsAsRadiologyStaff.status, `ops/consistency for a /radiology typist: ${opsAsRadiologyStaff.status}`).toBe(403);
    expect(
      JSON.stringify(opsAsRadiologyStaff.body).includes("Admin access required"),
      `ops refusal is the admin gate, not the module gate`,
    ).toBe(true);

    // And the narrow role is refused at the mount.
    const opsAsCashier = await request(app).get("/api/radiology-ops/consistency").set(bearer(cashierToken));
    expect(opsAsCashier.status, `ops/consistency for a cashier: ${opsAsCashier.status}`).toBe(403);
  });
});

