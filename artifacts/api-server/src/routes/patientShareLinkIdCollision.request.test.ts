/**
 * One patient's report must never be handed to another patient. — request level.
 *
 * `patient_reports.study_id` and `radiology_studies.id` are different numbers for
 * the same word. Workspace finalize stores the WORKLIST ROW id there
 * (`radiologyIdentity.ts`: "Always the worklist row id — store this on
 * patient_reports.study_id"), while the public patient viewer resolves that number
 * against `radiology_studies.id`. The two sequences are independent, so the
 * resolution either misses or returns a study belonging to somebody else.
 *
 * Production census, measured read-only on 2026-11-01 in the owner's shell: 7
 * reports sit on a number that resolves in BOTH sequences, 3 of them naming a
 * different patient on the two sides (the other 4 have a worklist row with no
 * patient at all). All 7 are drafts that were never signed, and a follow-up query
 * found ZERO reports in a deliverable status (verified/delivered/
 * pending_verification) pointing at another patient's study — so the door was
 * unlocked but never walked through. The public PDF route independently refuses
 * expired tokens and non-final reports, which is why no historical link is live.
 *
 * Two surfaces are pinned here, because fixing only the minter leaves the links
 * that already exist readable:
 *
 *   1. the auto-send-on-verify minter must not mint a patient viewer link over a
 *      study number whose row is not the report patient's own study;
 *   2. the viewer must not mix identities when a link already in the database
 *      resolves to another patient's study — no other patient's accession, and no
 *      report download for a page whose study belongs to someone else.
 *
 * Nothing is sent: `shadow_mode` is on, so the outbox suppresses the message and
 * no provider is contacted. The settings row is restored afterwards.
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
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientReportsTable,
  radiologyShareLinksTable,
  whatsappSettingsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("patient share link id-space — request level", () => {
  let app: Express;
  const marker = `shareid-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  const today = new Date().toISOString().slice(0, 10);

  const cleanup = { reportIds: [] as number[], worklistIds: [] as number[], studyIds: [] as number[], patientIds: [] as number[], testIds: [] as number[], sessionTokens: [token], shareTokens: [] as string[] };

  let patientA = 0; // the patient being reported on — the link's intended recipient
  let patientB = 0; // somebody else, whose billed study occupies A's row number
  let testA = 0;
  let testB = 0;
  let worklistA = 0; // radiology_worklist.id; finalize stores THIS on the report
  let honestStudyId = 0; // radiology_studies.id of A's own billed study
  let reportId = 0;
  let previousWa: Record<string, unknown> | null = null;

  const bAccession = `ACC-B-${marker}`;
  const aAccession = `ACC-A-${marker}`;

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. ShareProbe ${marker}`,
        email: `share-${marker}@vitest.invalid`,
        username: `share-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
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

    const [a] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker}-A`,
        firstName: `Alpha${marker}`,
        lastName: "Probe",
        dateOfBirth: "1980-01-01",
        gender: "female",
        phone: "9000000001",
      })
      .returning();
    const [b] = await db
      .insert(patientsTable)
      .values({
        patientId: `${marker}-B`,
        firstName: `Bravo${marker}`,
        lastName: "Probe",
        dateOfBirth: "1980-01-01",
        gender: "male",
        phone: "9000000002",
      })
      .returning();
    patientA = a.id;
    patientB = b.id;
    cleanup.patientIds.push(a.id, b.id);

    const [ta] = await db
      .insert(testsTable)
      .values({ name: `MRI Brain ${marker}`, code: `MBR${marker.slice(-5)}`, price: "5000", category: "Radiology", department: "MRI", duration: "1 day", isActive: true })
      .returning();
    const [tb] = await db
      .insert(testsTable)
      .values({ name: `USG Whole Abdomen ${marker}`, code: `UWA${marker.slice(-5)}`, price: "2000", category: "Radiology", department: "USG", duration: "1 day", isActive: true })
      .returning();
    testA = ta.id;
    testB = tb.id;
    cleanup.testIds.push(ta.id, tb.id);

    // A's study, honestly linked — this is the row the report is REALLY about.
    const [honest] = await db
      .insert(radiologyStudiesTable)
      .values({ modality: "MR", department: "MRI", studyDescription: "MRI Brain", studyDate: today, status: "acquired", patientId: patientA, testId: testA, accessionNumber: aAccession, studyInstanceUID: `1.2.840.shareid.${marker}.a` })
      .returning();
    cleanup.studyIds.push(honest.id);
    honestStudyId = honest.id;

    // A's reading-queue row. Its id is what finalize writes onto the report.
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "REPORT_FINAL",
        patientName: `Alpha ${marker}`,
        patientId: patientA,
        studyId: honest.id,
        accessionNumber: aAccession,
        studyInstanceUID: `1.2.840.shareid.${marker}.a`,
      } as never)
      .returning();
    worklistA = wl.id;
    cleanup.worklistIds.push(wl.id);

    // The collision: patient B owns a BILLED STUDY whose id equals A's worklist
    // row id. Same number, different patient, different exam.
    const taken = await db
      .select({ id: radiologyStudiesTable.id })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, worklistA));
    if (taken.length === 0) {
      const [bStudy] = await db
        .insert(radiologyStudiesTable)
        .values({
          id: worklistA,
          modality: "US",
          department: "USG",
          studyDescription: "USG Whole Abdomen",
          studyDate: today,
          status: "acquired",
          patientId: patientB,
          testId: testB,
          accessionNumber: bAccession,
          studyInstanceUID: `1.2.840.shareid.${marker}.b`,
        } as never)
        .returning();
      cleanup.studyIds.push(bStudy.id);
    }

    // A's signed report, carrying the worklist row id exactly as finalize writes it.
    const [rep] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}`,
        type: "radiology",
        patientId: patientA,
        testId: testA,
        studyId: worklistA,
        title: "MRI Brain",
        body: `<p>Findings for ${marker}.</p>`,
        impression: "No acute intracranial abnormality.",
        status: "signed",
        signedAt: new Date(),
        verifiedByName: `Dr. ShareProbe ${marker}`,
      })
      .returning();
    reportId = rep.id;
    cleanup.reportIds.push(rep.id);

    // Turn on the auto-send path that mints the link, with shadow mode so no
    // message can leave this machine.
    const [existingWa] = await db.select().from(whatsappSettingsTable).limit(1);
    previousWa = (existingWa ?? null) as Record<string, unknown> | null;
    if (existingWa) {
      await db
        .update(whatsappSettingsTable)
        .set({ enabled: true, autoSendOnVerify: true, includeViewerLink: true, shadowMode: true })
        .where(eq(whatsappSettingsTable.id, existingWa.id));
    } else {
      await db
        .insert(whatsappSettingsTable)
        .values({ enabled: true, autoSendOnVerify: true, includeViewerLink: true, shadowMode: true });
    }
  });

  afterAll(async () => {
    // Restore the settings row so no other suite inherits an "on" WhatsApp.
    if (previousWa) {
      const w = previousWa as Record<string, unknown>;
      await db
        .update(whatsappSettingsTable)
        .set({
          enabled: Boolean(w.enabled),
          autoSendOnVerify: Boolean(w.autoSendOnVerify),
          includeViewerLink: w.includeViewerLink === undefined ? true : Boolean(w.includeViewerLink),
          shadowMode: w.shadowMode === undefined ? true : Boolean(w.shadowMode),
        })
        .where(eq(whatsappSettingsTable.id, Number((w as { id?: number }).id ?? 0)));
    } else {
      await db.delete(whatsappSettingsTable);
    }

    await db.delete(radiologyShareLinksTable).where(eq(radiologyShareLinksTable.studyId, worklistA));
    await db.delete(radiologyShareLinksTable).where(eq(radiologyShareLinksTable.studyId, honestStudyId));
    for (const id of cleanup.reportIds) await db.delete(patientReportsTable).where(eq(patientReportsTable.id, id));
    for (const id of cleanup.worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    for (const id of cleanup.studyIds) await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
    for (const id of cleanup.testIds) await db.delete(testsTable).where(eq(testsTable.id, id));
    for (const id of cleanup.patientIds) await db.delete(patientsTable).where(eq(patientsTable.id, id));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
  });

  const patientLinks = () =>
    db
      .select()
      .from(radiologyShareLinksTable)
      .where(eq(radiologyShareLinksTable.studyId, worklistA));

  it("does not mint a patient viewer link over a study number the report's own patient does not own", async () => {
    const res = await request(app)
      .post(`/api/patient-reports/${reportId}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ verifierNotes: `countersigned ${marker}` });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The report row resolved by that number belongs to patient B, so no
    // patient-audience link may point at it.
    const links = await patientLinks();
    expect(
      links.filter((l) => l.audience === "patient"),
      "a patient share link was minted for a study owned by another patient",
    ).toHaveLength(0);
  });

  it("never shows another patient's identity on an existing patient share link", async () => {
    // Simulate the links already in the live database: minted before this guard.
    const shareToken = `vitest-share-${randomUUID()}`;
    await db.insert(radiologyShareLinksTable).values({
      token: shareToken,
      studyId: worklistA,
      audience: "patient",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await request(app).get(`/api/teleradiology/share/${shareToken}`);
    // A link whose study and report disagree on the patient is refused outright:
    // naming either patient on the page would be a lie, and the download would
    // cross the boundary.
    expect(res.status, "a mismatched patient link must be refused, not rendered").toBe(410);
    const html = res.text;

    expect(html, "the viewer revealed another patient's accession").not.toContain(bAccession);
    expect(html).not.toContain(aAccession);
    expect(html).not.toContain(`Bravo${marker}`);
    expect(html).not.toContain(`Alpha${marker}`);
    // … and a page whose study belongs to somebody else must not hand out a
    // report download at all.
    expect(html, "the viewer offered a report PDF across a patient boundary").not.toContain("/api/p/r/");
  });

  // OWNER CONDITION (decision 2) — the guard must not cost a patient access they
  // were entitled to. Both identity paths are driven here: the legacy path, where
  // the column already holds the billed study, and the workspace path, where it
  // holds a worklist ROW id that has to be followed through that row's own binding
  // to reach the study whose images the patient is owed.
  it("still mints and serves a legitimate patient viewer link on both identity paths", async () => {
    // Path 1 — legacy: the report is keyed directly on A's own billed study.
    const [legacyReport] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-L`,
        type: "radiology",
        patientId: patientA,
        testId: testA,
        studyId: honestStudyId,
        title: "MRI Brain",
        body: `<p>Findings for ${marker} legacy.</p>`,
        impression: "No acute intracranial abnormality.",
        status: "signed",
        signedAt: new Date(),
        verifiedByName: `Dr. ShareProbe ${marker}`,
      })
      .returning();
    cleanup.reportIds.push(legacyReport.id);

    const legacyVerify = await request(app)
      .post(`/api/patient-reports/${legacyReport.id}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ verifierNotes: `legacy path ${marker}` });
    expect(legacyVerify.status, JSON.stringify(legacyVerify.body)).toBe(200);

    const legacyLinks = await db
      .select()
      .from(radiologyShareLinksTable)
      .where(and(eq(radiologyShareLinksTable.studyId, honestStudyId), eq(radiologyShareLinksTable.audience, "patient")));
    expect(legacyLinks, "a report keyed on its own study must still get a viewer link").toHaveLength(1);

    // Path 2 — workspace: a second reading-queue row for the SAME honest study,
    // and a report keyed on the row id exactly as finalize writes it.
    const [wl2] = await db
      .insert(radiologyWorklistTable)
      .values({
        modality: "MR",
        studyDescription: "MRI Brain",
        studyDate: today,
        matchScore: "GREEN",
        matchDecision: "APPROVED",
        status: "REPORT_FINAL",
        patientName: `Alpha ${marker}`,
        patientId: patientA,
        studyId: honestStudyId,
        accessionNumber: aAccession,
        studyInstanceUID: `1.2.840.shareid.${marker}.a2`,
      } as never)
      .returning();
    cleanup.worklistIds.push(wl2.id);

    const [workspaceReport] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: `RPT-${marker}-W`,
        type: "radiology",
        patientId: patientA,
        testId: testA,
        studyId: wl2.id,
        title: "MRI Brain",
        body: `<p>Findings for ${marker} workspace.</p>`,
        impression: "No acute intracranial abnormality.",
        status: "signed",
        signedAt: new Date(),
        verifiedByName: `Dr. ShareProbe ${marker}`,
      })
      .returning();
    cleanup.reportIds.push(workspaceReport.id);

    const workspaceVerify = await request(app)
      .post(`/api/patient-reports/${workspaceReport.id}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ verifierNotes: `workspace path ${marker}` });
    expect(workspaceVerify.status, JSON.stringify(workspaceVerify.body)).toBe(200);

    // Resolved through the worklist row's own binding, not through the raw number
    // — which is the difference between "the patient gets their images" and "a
    // page headed with somebody else's exam".
    const overRowId = await db
      .select()
      .from(radiologyShareLinksTable)
      .where(and(eq(radiologyShareLinksTable.studyId, wl2.id), eq(radiologyShareLinksTable.audience, "patient")));
    expect(overRowId, "no patient link may be minted over an unresolved worklist row id").toHaveLength(0);

    const resolved = await db
      .select()
      .from(radiologyShareLinksTable)
      .where(and(eq(radiologyShareLinksTable.studyId, honestStudyId), eq(radiologyShareLinksTable.audience, "patient")));
    expect(resolved.length, "the workspace path must still get a viewer link over the bound study").toBeGreaterThan(0);

    // …and that link really serves the patient their own report.
    const page = await request(app).get(`/api/teleradiology/share/${resolved[0].token}`);
    expect(page.status, "a legitimate patient link must not be refused").toBe(200);
    expect(page.text).toContain(`Alpha${marker}`);
    expect(page.text, "the viewer leaked another patient onto a legitimate link").not.toContain(`Bravo${marker}`);
    expect(page.text).not.toContain(bAccession);
    expect(page.text, "a legitimate link must still hand out the report").toContain("/api/p/r/");
  }, 120_000);
});
