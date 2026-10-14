/**
 * Signed-report identity and metadata integrity, proven against real rows.
 *
 * `reportStudyIdentity.request.test.ts` answers one question — which ACCESSION a
 * printed report may name. This file answers the rest of the identity block, and
 * it was written before the correction, so every test marked RED below fails on
 * the code as it stands and names the defect it reproduces.
 *
 * The durable builder under test is `buildReportArtifact`
 * (routes/patient-reports.ts), which serves Report Hub print and PDF, the public
 * and WhatsApp share, email delivery and the PACS archive. It is the copy of a
 * report that leaves the building, so an identity error here is a clinical one.
 *
 * What it does today, and why that is wrong:
 *
 *   • it left-joins the LIVE `patients` table, so a signed report re-renders with
 *     whatever the patient master says NOW — editing a registration silently
 *     rewrites an already-signed document (Test G);
 *   • it derives age from `Date.now()`, so reprinting a 2025 examination in 2027
 *     prints a different age (Test A), and a registration carrying the
 *     `1900-01-01` sentinel DOB prints as 126 years old (Test H);
 *   • its only date row is the report's own `createdAt`, and
 *     `reportPresentation.rowByLabel` reads that row back under the labels
 *     "study date" OR "date" — so the examination date on a signed report is the
 *     day the report was written (Test B);
 *   • it emits no referring-physician row at all, so a referrer recorded on the
 *     study vanishes from the signed document (Test C);
 *   • the draft builder the radiologist actually reviewed
 *     (routes/radiology-report-generator.ts) DOES emit `UHID`, `Study Date`,
 *     `Referring Doctor` and `Modality`. The preview and the signed artifact
 *     therefore disagree about who and when — and because all five delivery
 *     surfaces share this one renderer, they all disagree the same way (Test I).
 *
 * DATABASE_ONLY: skipped without DATABASE_URL, like every `*.request.test.ts`.
 * Every patient, study, worklist row and report is synthetic and carries the run
 * marker, so any value that reaches a printed document traces back to a row this
 * file created. Nothing here reads or writes a clinic row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  diagnosticReferralEventsTable,
  diagnosticReferralsTable,
  externalResultLinksTable,
  integrationOutboxTable,
  ordersTable,
  orderTestsTable,
  patientReportsTable,
  patientsTable,
  portalSessionsTable,
  radiologyReportPresentationFreezeTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  signaturesTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8).toUpperCase();

/** Marker-unique: any printed value traces back to exactly one fixture row. */
const mark = (tag: string) => `PB-${RUN}-${tag}`;

// ── The examination, stated as facts rather than computed from the code under
// test. A test that re-derived its own expectation from the implementation would
// agree with whatever the implementation did.
const EXAM_DOB = "1980-01-10";
/** DICOM shape, as the PACS writes it into `radiology_worklist.study_date`. */
const EXAM_DATE_DICOM = "20250110";
/** The day of the examination, in the one form every block agrees on. */
const EXAM_DATE_ISO = "2025-01-10";
/** The day the report was written — two days after the scan, and a different day. */
const REPORT_DATE_ISO = "2025-01-12";
/**
 * 1980-01-10 → 2025-01-10 is exactly 45 years: the birthday falls ON the
 * examination date, so the patient is 45 at examination, not 44.
 */
const EXAM_AGE_YEARS = 45;
/** Two days after the examination — the report was written later than the scan. */
const REPORT_WRITTEN_AT = new Date("2025-01-12T09:00:00+05:30");
const REPORT_SIGNED_AT = new Date("2025-01-12T11:30:00+05:30");
/** The name the patient had when the report was signed. */
const NAME_AT_SIGNING = "Alphawoman";
const NAME_AFTER_MASTER_EDIT = "RenamedAfterSigning";
const REFERRER = "Dr Synthetic Mehta";

type Fixture = {
  testId: number;
  patientA: number;
  patientB: number;
  patientSparse: number;
  uhidA: string;
  uhidB: string;
  /** The billed study's accession. */
  accessionA: string;
  accessionB: string;
  /** The worklist row's accession — the one `loadReportAccessionForReport` prefers. */
  accessionWlA: string;
  studyUidA: string;
  studyA: number;
  worklistA: number;
  worklistB: number;
  worklistSparse: number;
  /** The CARE order both HOPE-candidate reports name, so the referral matches. */
  careOrderId: number;
  referralId: number;
  referralUuid: string;
  reports: {
    /** Patient A's own signed report on A's own study — the happy path. */
    signedA: number;
    /** Patient B's report whose study_id names A's worklist row: the collision. */
    collisionB: number;
    /** A's report with no study reference at all. */
    noStudy: number;
    /** Sentinel DOB, no referrer, blank accession, no study date. */
    sparse: number;
  };
  /**
   * A report taken to signed through the REAL HTTP routes (`POST
   * /api/patient-reports` then `POST /:id/sign`), so the signing event itself is
   * what captured the identity.
   *
   * The four rows above are inserted directly with `status: "verified"`, which is
   * how a pre-freeze historical report looks: they exercise LIVE resolution, and
   * that is exactly what Tests A, B, C, H and I need to measure. Immutability
   * (Test G) needs the other half — a report the sign route actually froze — and
   * seeding the freeze row by hand would only prove the writer agrees with
   * itself. Its own worklist row and its own id space, so it cannot become a
   * candidate in Test J's collision.
   */
  routeSigned: {
    reportId: number;
    worklistId: number;
    signerName: string;
    /** Rows the HTTP routes created, so teardown can remove them. */
    userId: number;
    signatureId: number;
    orderId: number;
  };
};

let f: Fixture;

async function seed(app: Express): Promise<Fixture> {
  const [test] = await db
    .insert(testsTable)
    .values({
      code: mark("TEST"),
      name: `MRI BRAIN (PLAIN) ${RUN}`,
      category: "Radiology",
      price: "3000",
      duration: "30",
      department: "MRI",
    })
    .returning();

  const patient = async (tag: string, firstName: string, over: Record<string, unknown> = {}) => {
    const [row] = await db
      .insert(patientsTable)
      .values({
        patientId: mark(`UHID-${tag}`),
        firstName,
        lastName: `SYNTHETIC ${RUN}`,
        dateOfBirth: EXAM_DOB,
        gender: "female",
        phone: "9000000000",
        ...over,
      })
      .returning();
    return row;
  };

  const pA = await patient("A", NAME_AT_SIGNING);
  const pB = await patient("B", "Bravowoman", { dateOfBirth: "1990-05-05", gender: "male" });
  // The registration shape that produces a fabricated age: no documented age, and
  // the `1900-01-01` sentinel the ERP writes when a DOB was never collected.
  const pSparse = await patient("S", "Sparsewoman", { dateOfBirth: "1900-01-01" });

  const study = async (patientId: number, tag: string, over: Record<string, unknown> = {}) => {
    const [row] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: mark(`ACC-${tag}`),
        patientId,
        testId: test!.id,
        modality: "MR",
        department: "MRI",
        studyDescription: `MRI BRAIN ${RUN}`,
        studyDate: "2025-01-10",
        referringDoctor: tag === "A" ? REFERRER : null,
        status: "scheduled",
        ...over,
      })
      .returning();
    return row.id;
  };

  const worklist = async (opts: {
    patientId: number | null;
    tag: string;
    studyId: number | null;
    accession?: string | null;
    studyDate?: string | null;
    referringDoctor?: string | null;
    age?: string | null;
  }) => {
    const [row] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `SYNTHETIC ${RUN}`,
        patientId: opts.patientId ?? undefined,
        dicomPatientId: opts.patientId != null ? mark(`DICOM-${opts.tag}`) : null,
        patientMatchStatus: opts.patientId ? "MATCHED" : "UNMATCHED",
        studyId: opts.studyId ?? undefined,
        modality: "MR",
        studyDescription: `MRI BRAIN ${RUN}`,
        studyDate: opts.studyDate === undefined ? EXAM_DATE_DICOM : opts.studyDate,
        accessionNumber:
          opts.accession === undefined ? mark(`ACC-WL-${opts.tag}`) : opts.accession,
        studyInstanceUID: `1.2.826.0.1.${RUN}.${opts.tag}`,
        referringDoctor:
          opts.referringDoctor === undefined ? (opts.tag === "A" ? REFERRER : null) : opts.referringDoctor,
        age: opts.age === undefined ? "45" : opts.age,
        sex: "F",
        status: "REPORT_FINAL",
      })
      .returning();
    return row.id;
  };

  const studyA = await study(pA.id, "A");
  await study(pB.id, "B", { studyDate: "2025-02-20" });
  const worklistA = await worklist({ patientId: pA.id, tag: "A", studyId: studyA });
  // B's own study date is deliberately a DIFFERENT day from A's, so "A's date must
  // not appear on B's report" is a real tripwire rather than a value both share.
  const worklistB = await worklist({ patientId: pB.id, tag: "B", studyId: null, studyDate: "20250220" });
  const worklistSparse = await worklist({
    patientId: pSparse.id,
    tag: "S",
    studyId: null,
    accession: "   ",
    studyDate: null,
    referringDoctor: null,
    // No age was ever captured for this examination either: nothing reliable
    // exists to print, which is the whole of Test H.
    age: null,
  });

  const report = async (opts: {
    patientId: number;
    studyId: number | null;
    tag: string;
    createdAt?: Date;
    orderId?: number | null;
  }) => {
    const [row] = await db
      .insert(patientReportsTable)
      .values({
        reportNumber: mark(`RPT-${opts.tag}`),
        type: "radiology",
        patientId: opts.patientId,
        testId: test!.id,
        studyId: opts.studyId,
        orderId: opts.orderId ?? null,
        title: `MRI BRAIN (PLAIN) ${RUN}`,
        body: `<p>FINDINGS: synthetic findings ${mark(opts.tag)}, no clinical content.</p>`,
        impression: "Synthetic impression.",
        status: "verified",
        signedByName: "Dr Synthetic Rao",
        signedAt: REPORT_SIGNED_AT,
        verifiedByName: "Dr Synthetic Rao",
        verifiedAt: REPORT_SIGNED_AT,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      })
      .returning();
    return row.id;
  };

  // Both candidates for worklist row A carry the SAME CARE order, so whichever
  // one the HOPE resolver picks, the referral lookup succeeds and the returned
  // `reportId` names the report it actually chose. That is the only variable in
  // Test J: the referral is patient A's, so a `reportId` that is B's report IS
  // the cross-patient association, measured rather than inferred.
  //
  // The order has to be a real row: `diagnostic_referrals.care_order_id` carries a
  // foreign key onto `orders`, so an invented id makes the seed itself fail.
  const [order] = await db
    .insert(ordersTable)
    .values({ orderNumber: mark("ORDER"), patientId: pA.id, status: "completed" })
    .returning();
  const careOrderId = order!.id;

  const reports = {
    signedA: await report({ patientId: pA.id, studyId: worklistA, tag: "SIGNED-A", createdAt: REPORT_WRITTEN_AT, orderId: careOrderId }),
    // Created AFTER signedA, so it has the higher id — and the HOPE resolver's
    // `orderBy(desc(id))` picks it for a worklist row that is not B's.
    collisionB: await report({ patientId: pB.id, studyId: worklistA, tag: "COLLISION-B", createdAt: REPORT_WRITTEN_AT, orderId: careOrderId }),
    noStudy: await report({ patientId: pA.id, studyId: null, tag: "NOSTUDY", createdAt: REPORT_WRITTEN_AT }),
    sparse: await report({ patientId: pSparse.id, studyId: worklistSparse, tag: "SPARSE", createdAt: REPORT_WRITTEN_AT }),
  };

  const [referral] = await db
    .insert(diagnosticReferralsTable)
    .values({
      referralUuid: mark("REF"),
      sourceOrg: "HOPE",
      sourcePatientId: mark("HOPE-UHID"),
      carePatientId: pA.id,
      careOrderId,
      status: "ACCEPTED",
      patientName: `${NAME_AT_SIGNING} SYNTHETIC ${RUN}`,
    })
    .returning();

  // ── The report the SIGN ROUTE froze ────────────────────────────────────────
  // Created and signed over HTTP, so `freezeSignedReportPresentation` ran for
  // real and the identity on the page afterwards is the one captured at the
  // signing instant rather than the one re-read from the live patient master.
  const signerName = `Dr Synthetic Signer ${RUN}`;
  const token = `vitest-token-${randomUUID()}`;
  const [signer] = await db
    .insert(usersTable)
    .values({
      name: signerName,
      email: `signer-${RUN}@vitest.invalid`,
      username: `signer-${RUN}`,
      // "radiologist" is not in SIGN_DENY_ROLES, so the route's role gate passes.
      role: "radiologist",
      permissions: JSON.stringify(["/reports", "/reports:sign", "/radiology"]),
      pin: "0000",
      isActive: true,
    })
    .returning();
  await db.insert(portalSessionsTable).values({
    token,
    scope: "staff",
    subjectId: signer.id,
    subjectName: signer.name,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const [signature] = await db
    .insert(signaturesTable)
    .values({
      name: signerName,
      role: "Radiologist",
      qualification: "MD (Radio-Diagnosis)",
      registrationNo: mark("REG"),
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      isActive: true,
    })
    .returning();

  const [routeOrder] = await db
    .insert(ordersTable)
    .values({ orderNumber: mark("ORDER-G"), patientId: pA.id, status: "completed" })
    .returning();
  await db
    .insert(orderTestsTable)
    .values({ orderId: routeOrder!.id, testId: test!.id, price: "3000" })
    .returning();

  // GREEN/APPROVED so the match gate at POST /api/patient-reports lets the
  // creation through, and STUDY_RECEIVED because the create route binds the row.
  // Its own accession and StudyInstanceUID keep it out of every other test's
  // candidate set — in particular out of Test J's collision on worklistA.
  const [routeWorklist] = await db
    .insert(radiologyWorklistTable)
    .values({
      patientName: `${NAME_AT_SIGNING} SYNTHETIC ${RUN}`,
      patientId: pA.id,
      dicomPatientId: mark("DICOM-G"),
      patientMatchStatus: "MATCHED",
      modality: "MR",
      studyDescription: `MRI BRAIN ${RUN}`,
      studyDate: EXAM_DATE_DICOM,
      accessionNumber: mark("ACC-WL-G"),
      studyInstanceUID: `1.2.826.0.1.${RUN}.G`,
      referringDoctor: REFERRER,
      age: String(EXAM_AGE_YEARS),
      sex: "F",
      matchScore: "GREEN",
      matchDecision: "APPROVED",
      status: "STUDY_RECEIVED",
    })
    .returning();

  const auth = { Authorization: `Bearer ${token}` };
  const created = await request(app)
    .post("/api/patient-reports")
    .set(auth)
    .send({
      type: "radiology",
      patientId: pA.id,
      testId: test!.id,
      studyId: routeWorklist!.id,
      worklistId: routeWorklist!.id,
      title: `MRI BRAIN (PLAIN) ${RUN}`,
      body: `<p>FINDINGS: synthetic findings ${mark("ROUTE-G")}, no clinical content.</p>`,
      impression: "Synthetic impression.",
    });
  expect([200, 201], `create: ${created.status} ${created.text}`).toContain(created.status);
  const routeReportId = created.body.id as number;

  const signed = await request(app)
    .post(`/api/patient-reports/${routeReportId}/sign`)
    .set(auth)
    .send({ signatureId: signature!.id });
  expect([200, 201], `sign: ${signed.status} ${signed.text}`).toContain(signed.status);

  const routeSigned = {
    reportId: routeReportId,
    worklistId: routeWorklist!.id,
    signerName,
    userId: signer.id,
    signatureId: signature!.id,
    orderId: routeOrder!.id,
  };

  return {
    testId: test!.id,
    patientA: pA.id,
    patientB: pB.id,
    patientSparse: pSparse.id,
    uhidA: pA.patientId,
    uhidB: pB.patientId,
    accessionA: mark("ACC-A"),
    accessionB: mark("ACC-B"),
    accessionWlA: mark("ACC-WL-A"),
    studyUidA: `1.2.826.0.1.${RUN}.A`,
    studyA,
    worklistA,
    worklistB,
    worklistSparse,
    careOrderId,
    referralId: referral!.id,
    referralUuid: referral!.referralUuid,
    reports,
    routeSigned,
  };
}

async function teardown(x: Fixture) {
  const reportIds = [...Object.values(x.reports), x.routeSigned.reportId];
  const orderIds = [x.careOrderId, x.routeSigned.orderId];
  // `order_tests` goes before `orders`: a surviving line item holds the order's
  // foreign key, and every delete here is swallowed, so the leak would be silent.
  await db.delete(orderTestsTable).where(inArray(orderTestsTable.orderId, orderIds)).catch(() => {});
  // Everything the HOPE emit writes is keyed on this fixture's referral, so it is
  // removed first: the events and links carry a not-null referral id.
  await db.delete(diagnosticReferralEventsTable).where(eq(diagnosticReferralEventsTable.referralId, x.referralId)).catch(() => {});
  await db.delete(externalResultLinksTable).where(eq(externalResultLinksTable.referralId, x.referralId)).catch(() => {});
  await db.delete(integrationOutboxTable).where(eq(integrationOutboxTable.correlationId, x.referralUuid)).catch(() => {});
  await db.delete(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, x.referralId)).catch(() => {});
  // The order can only go once the referral that points at it is gone.
  await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds)).catch(() => {});
  await db.delete(patientReportsTable).where(inArray(patientReportsTable.id, reportIds)).catch(() => {});
  await db.delete(patientReportsTable).where(eq(patientReportsTable.testId, x.testId)).catch(() => {});
  await db.delete(radiologyReportPresentationFreezeTable).where(inArray(radiologyReportPresentationFreezeTable.reportId, reportIds)).catch(() => {});
  await db.delete(signaturesTable).where(eq(signaturesTable.id, x.routeSigned.signatureId)).catch(() => {});
  await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, x.routeSigned.userId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, x.routeSigned.userId)).catch(() => {});
  for (const tag of ["A", "B", "S", "G"]) {
    await db
      .delete(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, `1.2.826.0.1.${RUN}.${tag}`))
      .catch(() => {});
  }
  for (const tag of ["A", "B"]) {
    await db
      .delete(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, mark(`ACC-${tag}`)))
      .catch(() => {});
  }
  await db.delete(testsTable).where(eq(testsTable.id, x.testId)).catch(() => {});
  for (const tag of ["A", "B", "S"]) {
    await db.delete(patientsTable).where(eq(patientsTable.patientId, mark(`UHID-${tag}`))).catch(() => {});
  }
}

type ArtifactOpts = {
  surface?: string;
  versionMode?: "specific" | "latest" | "root";
  copyType?: "standard" | "patient";
  autoPrint?: boolean;
};

async function artifactHtml(reportId: number, opts: ArtifactOpts = {}): Promise<string> {
  const { buildReportArtifact } = await import("../routes/patient-reports");
  const artifact = await buildReportArtifact(reportId, {
    surface: opts.surface ?? "pdf",
    versionMode: opts.versionMode ?? "specific",
    ...(opts.copyType ? { copyType: opts.copyType } : {}),
    ...(opts.autoPrint ? { autoPrint: true } : {}),
  });
  expect(artifact, `the durable builder must still render this report (surface ${opts.surface ?? "pdf"})`).not.toBeNull();
  return artifact!.html;
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * Only the demography block, so an assertion about the identity header cannot be
 * satisfied by the same string appearing in the footer, the signature line or the
 * clinical body. Falls back to the whole document when a template renders neither
 * of the two known blocks — in which case the assertion is weaker, not wrong.
 *
 * Depth-walked rather than regex-sliced: the stacked block nests one `div` per
 * line, so a non-greedy `<div…>[\s\S]*?</div>` stops at the patient-name div and
 * silently reports that the block printed nothing but the name.
 */
function demographyBlock(html: string): string {
  const tableStart = /<table[^>]*class="[^"]*(?:letterpad-demo|patient-table)[^"]*"/i.exec(html);
  if (tableStart) {
    const end = html.indexOf("</table>", tableStart.index);
    if (end > 0) return html.slice(tableStart.index, end + 8);
  }
  const divStart = /<div[^>]*class="[^"]*patient-stacked[^"]*"/i.exec(html);
  if (divStart) {
    let depth = 0;
    const tag = /<div\b|<\/div>/gi;
    tag.lastIndex = divStart.index;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(html)) !== null) {
      depth += m[0].toLowerCase() === "<div" ? 1 : -1;
      if (depth === 0) return html.slice(divStart.index, m.index + m[0].length);
    }
  }
  return html;
}

/** The value the demography block prints in its age slot, or "" when it prints none. */
function printedAge(html: string): string {
  const block = visibleText(demographyBlock(html));
  const m = /age\s*\/?\s*sex\s*:?\s*([0-9]{1,3})/i.exec(block);
  return m ? m[1]! : "";
}

/**
 * Every DAY the demography block prints, paired with the label that introduced it.
 *
 * Read as label→value, not as a flat date search, because the correction has to
 * keep BOTH days on the document: the examination date and the report date are
 * different fields, and the brief forbids silently substituting one for the
 * other. A "which days appear" check could only be satisfied by deleting the
 * report date, which is not the fix — so the assertion is about which label a
 * day sits under.
 *
 * The label is the text between the previous pair's colon and this value's own
 * colon. That holds for all three header shapes, which flat text cannot tell
 * apart: the letter pad prints `<strong>DATE:</strong> 12/01/2025`, the stacked
 * block prints `Date: 12/01/2025`.
 */
const DATE_TOKEN =
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b|\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{4})(\d{2})(\d{2})\b/g;

function demographyLabelledDays(html: string): { label: string; day: string }[] {
  const block = visibleText(demographyBlock(html));
  const out: { label: string; day: string }[] = [];
  DATE_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_TOKEN.exec(block)) !== null) {
    const day = m[1]
      ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
      : m[4]
        ? `${m[4]}-${m[5]!.padStart(2, "0")}-${m[6]!.padStart(2, "0")}`
        : `${m[7]}-${m[8]}-${m[9]}`;
    // The label sits between the previous pair's colon and this value's own.
    const before = block.slice(Math.max(0, m.index - 40), m.index);
    const end = before.lastIndexOf(":");
    const start = before.lastIndexOf(":", end - 1);
    out.push({ label: before.slice(start + 1, end).trim(), day });
  }
  return out;
}

/**
 * Which date a printed label claims to be. Word-based rather than an exact match
 * because the label run picked up from flat text carries whatever preceded it —
 * the stacked block prints `Age/Sex: 45 / F   Date: 12/01/2025`, so the text
 * between the two colons is `45 / F Date`.
 */
function dateLabelKind(label: string): "examination" | "report" | "bare" | null {
  const l = label.toLowerCase();
  if (/report|sign|finali[sz]|creat|verif|writ|print|generat|amend/.test(l)) return "report";
  if (/examination|study|exam|scan|procedure|perform/.test(l)) return "examination";
  return /\bdates?\b/.test(l) ? "bare" : null;
}

const datedPairs = (html: string) =>
  demographyLabelledDays(html)
    .map((p) => ({ ...p, kind: dateLabelKind(p.label) }))
    .filter((p) => p.kind !== null);

/** The day printed in the block's examination-date slot, or "" when it prints none. */
function examinationDay(html: string): string {
  const pairs = datedPairs(html);
  return (
    pairs.find((p) => p.kind === "examination")?.day ??
    pairs.find((p) => p.kind === "bare")?.day ??
    ""
  );
}

/** The report day printed under a label that does not say it is the report day. */
function unqualifiedReportDay(html: string): string {
  const pairs = datedPairs(html);
  if (pairs.some((p) => p.kind === "examination")) return "";
  return pairs.find((p) => p.kind === "bare" && p.day === REPORT_DATE_ISO)?.day ?? "";
}

/** The age the current wall clock would derive from the fixture DOB. */
function ageFromClockToday(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
  return y;
}

/**
 * The identity values one rendering actually carries, normalized so two surfaces
 * can be compared without comparing their layouts.
 *
 * A field the surface does not print comes back as "". That is deliberate: Phase 5
 * permits presentation differences (the patient copy and the staff copy are not
 * the same document) and forbids VALUE differences, so "absent" must never be
 * scored as a disagreement while "different" always is.
 */
type IdentityFacts = {
  patientName: string;
  age: string;
  uhid: string;
  accession: string;
  examinationDay: string;
  referrer: string;
};

function identityFacts(html: string, x: { uhid: string; accessions: string[]; referrer: string; name: string }): IdentityFacts {
  const block = visibleText(demographyBlock(html));
  const whole = visibleText(html);
  return {
    patientName: block.includes(x.name) ? x.name : "",
    age: printedAge(html),
    uhid: whole.includes(x.uhid) ? x.uhid : "",
    accession: x.accessions.find((a) => whole.includes(a)) ?? "",
    examinationDay: examinationDay(html),
    referrer: whole.includes(x.referrer) ? x.referrer : "",
  };
}

const IDENTITY_KEYS: (keyof IdentityFacts)[] = [
  "patientName",
  "age",
  "uhid",
  "accession",
  "examinationDay",
  "referrer",
];

/** Two renderings of one report may omit different fields; they may not disagree. */
function expectIdentityAgreement(label: string, a: IdentityFacts, b: IdentityFacts) {
  for (const key of IDENTITY_KEYS) {
    if (!a[key] || !b[key]) continue;
    expect(b[key], `${label} — ${key} differs between two renderings of the SAME signed report`).toBe(a[key]);
  }
}

describe.skipIf(!dbAvailable)("signed-report identity integrity — real rows", () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
    f = await seed(app);
  }, 60_000);

  afterAll(async () => {
    if (f) await teardown(f);
  });

  it("the fixture really is a case where examination age and today's age differ", () => {
    // Without this the age tests could pass by accident: if the clock-derived age
    // equalled the examination age, nothing would be able to detect the drift.
    expect(ageFromClockToday(EXAM_DOB)).not.toBe(EXAM_AGE_YEARS);
    expect(ageFromClockToday(EXAM_DOB)).toBeGreaterThan(EXAM_AGE_YEARS);
  });

  // ── Test A — historical age stability ──────────────────────────────────────
  describe("Test A — a reprint must not age the patient", () => {
    it("RED: prints the age at examination, not the age at render time", async () => {
      const html = await artifactHtml(f.reports.signedA);
      const age = printedAge(html);
      // The defect, stated: today the builder derives age from Date.now(), so this
      // comes back as the clock age and the assertion fails.
      expect(age).toBe(String(EXAM_AGE_YEARS));
      expect(age).not.toBe(String(ageFromClockToday(EXAM_DOB)));
    });
  });

  // ── Test B — examination date vs report date ───────────────────────────────
  describe("Test B — the examination date is not the report date", () => {
    it("RED: names the study date in the demography date slot", async () => {
      const html = await artifactHtml(f.reports.signedA);
      // The study was performed 10 Jan 2025 and the report was written 12 Jan 2025.
      // The builder's only date row is `createdAt`, and rowByLabel reads it back
      // under the labels "study date" OR "date" — so today this is the 12th.
      expect(examinationDay(html)).toBe(EXAM_DATE_ISO);
    });

    it("RED: does not present the report-writing date as the examination date", async () => {
      const html = await artifactHtml(f.reports.signedA);
      // Not "the report day must be absent": Phase 3 lists the report creation
      // date as part of the canonical identity, so it may be printed — but only
      // under a label that says it is the report date. What is forbidden is the
      // unqualified date slot carrying it.
      expect(unqualifiedReportDay(html)).toBe("");
    });

    it("keeps the signing event visible on the document, separately labelled", async () => {
      // Not a substitution in the other direction: the brief requires the signing
      // date to remain displayed as the signing event. This pins that correcting
      // the examination-date slot does not delete it. The expected string is
      // derived from the fixture instant, not typed, so it cannot drift from the
      // renderer's own locale.
      const html = await artifactHtml(f.reports.signedA);
      const text = visibleText(html);
      expect(text).toContain(REPORT_SIGNED_AT.toLocaleString("en-IN"));
      expect(text).toContain("Dr Synthetic Rao");
    });
  });

  // ── Test C / D — referring physician ───────────────────────────────────────
  describe("Tests C and D — the referring physician", () => {
    it("RED: reaches the signed report when the study records one", async () => {
      const html = await artifactHtml(f.reports.signedA);
      // The worklist row AND the billed study both carry REFERRER; the signed
      // builder emits no referring row at all, so nothing prints it.
      expect(visibleText(html)).toContain(REFERRER);
    });

    it("does not invent a referrer when none is recorded", async () => {
      const html = await artifactHtml(f.reports.sparse);
      const block = visibleText(demographyBlock(html)).toLowerCase();
      for (const invented of ["self", "walk-in", "walkin", "n/a", "none", "unknown"]) {
        // Any referrer slot at all must be empty: a label followed by an invented
        // name is worse than no label, because it reads as a recorded fact.
        expect(new RegExp(`ref[^a-z]{0,6}\\s*[:.]?\\s*${invented}`, "i").test(block)).toBe(false);
      }
      // And the referrer recorded on A's study must not leak onto this document.
      expect(visibleText(html)).not.toContain(REFERRER);
    });
  });

  // ── Test E — identifiers ───────────────────────────────────────────────────
  describe("Test E — a clinical identifier, never an internal primary key", () => {
    it("prints the UHID from the patient master", async () => {
      const html = await artifactHtml(f.reports.signedA);
      expect(visibleText(html)).toContain(f.uhidA);
    });

    it("does not print the numeric patient primary key in an identifier slot", async () => {
      const html = await artifactHtml(f.reports.signedA);
      const block = visibleText(demographyBlock(html));
      const pk = String(f.patientA);
      // A Postgres sequence value next to a UHID label reads as an identifier to
      // whoever receives the report, and it identifies nothing outside this
      // database.
      expect(new RegExp(`(uhid|patient\\s*id)[^0-9a-z]{0,6}${pk}\\b`, "i").test(block)).toBe(false);
    });

    it("preserves the accession where the study has one", async () => {
      const html = await artifactHtml(f.reports.signedA);
      const text = visibleText(html);
      // `loadReportAccessionForReport` prefers the worklist row when it provably
      // belongs to this patient, so the worklist accession is the one printed.
      // Both of A's accessions are acceptable; B's never is.
      expect([f.accessionWlA, f.accessionA].some((a) => text.includes(a))).toBe(true);
      expect(text).not.toContain(f.accessionB);
    });
  });

  // ── Test F — two patients stay isolated ────────────────────────────────────
  describe("Test F — identity isolation between two studies of two patients", () => {
    it("B's report names none of A's identity, even though study_id points at A's worklist row", async () => {
      const html = await artifactHtml(f.reports.collisionB);
      const text = visibleText(html);
      expect(text).toContain(f.uhidB);
      for (const foreign of [f.uhidA, f.accessionA, f.accessionWlA, NAME_AT_SIGNING, f.studyUidA, REFERRER, EXAM_DATE_ISO, EXAM_DATE_DICOM]) {
        expect(text, `patient A's "${foreign}" must not appear on patient B's report`).not.toContain(foreign);
      }
      // And B's own clinical body is intact — isolation must not empty the report.
      expect(text).toContain(mark("COLLISION-B"));
    });

    it("A's report names none of B's identity", async () => {
      const html = await artifactHtml(f.reports.signedA);
      const text = visibleText(html);
      for (const foreign of [f.uhidB, f.accessionB, "Bravowoman"]) {
        expect(text).not.toContain(foreign);
      }
      expect(text).toContain(mark("SIGNED-A"));
    });
  });

  // ── Test G — the signed report does not follow the patient master ──────────
  //
  // Run against `routeSigned`: a report the real `POST /api/patient-reports/:id/sign`
  // route signed, so the identity was captured by the same code production runs and
  // stored in the existing presentation-freeze snapshot. The four directly-inserted
  // rows have no freeze row — deliberately, so Tests A/B/C/H/I measure LIVE
  // resolution — and a live-resolved report cannot be expected to ignore the master.
  describe("Test G — editing the master after signing must not rewrite the signed report", () => {
    it("the sign route really froze an identity, so the arms below cannot pass by accident", async () => {
      const [freeze] = await db
        .select({ snapshot: radiologyReportPresentationFreezeTable.snapshot })
        .from(radiologyReportPresentationFreezeTable)
        .where(eq(radiologyReportPresentationFreezeTable.reportId, f.routeSigned.reportId))
        .limit(1);
      const snap = freeze?.snapshot as { identity?: { patientName?: string; ageAtExamination?: string } } | null;
      expect(freeze, "no presentation-freeze row for the route-signed report").toBeTruthy();
      expect(snap?.identity, "the freeze snapshot carries no identity — the sign route did not capture one").toBeTruthy();
      expect(snap?.identity?.patientName).toContain(NAME_AT_SIGNING);
      expect(snap?.identity?.ageAtExamination).toContain(String(EXAM_AGE_YEARS));
    });

    it("RED: a post-signing rename leaves the signed document unchanged", async () => {
      const before = visibleText(await artifactHtml(f.routeSigned.reportId));
      expect(before).toContain(NAME_AT_SIGNING);

      await db
        .update(patientsTable)
        .set({ firstName: NAME_AFTER_MASTER_EDIT })
        .where(eq(patientsTable.id, f.patientA));
      try {
        const after = visibleText(await artifactHtml(f.routeSigned.reportId));
        // The builder left-joins the LIVE patients row, so today the signed
        // document changes under its own signature.
        expect(after).toContain(NAME_AT_SIGNING);
        expect(after).not.toContain(NAME_AFTER_MASTER_EDIT);
      } finally {
        await db
          .update(patientsTable)
          .set({ firstName: NAME_AT_SIGNING })
          .where(eq(patientsTable.id, f.patientA));
      }
    });

    it("RED: a post-signing DOB correction leaves the signed age unchanged", async () => {
      const ageBefore = printedAge(await artifactHtml(f.routeSigned.reportId));
      expect(ageBefore).toBe(String(EXAM_AGE_YEARS));
      await db
        .update(patientsTable)
        .set({ dateOfBirth: "1970-01-10" })
        .where(eq(patientsTable.id, f.patientA));
      try {
        const ageAfter = printedAge(await artifactHtml(f.routeSigned.reportId));
        expect(ageAfter).toBe(ageBefore);
      } finally {
        await db
          .update(patientsTable)
          .set({ dateOfBirth: EXAM_DOB })
          .where(eq(patientsTable.id, f.patientA));
      }
    });

    it("never rewrites the signed clinical body, whatever else changes", async () => {
      // Compared on the visible text, not on a regex over the raw HTML: the
      // template's own stylesheet contains the word "Findings", so a raw slice
      // grabs boilerplate instead of the authored body.
      const clinical = (text: string) =>
        /FINDINGS:[\s\S]*?no clinical content\./.exec(text)?.[0] ?? "";
      const bodyBefore = clinical(visibleText(await artifactHtml(f.routeSigned.reportId)));
      expect(bodyBefore).toContain(mark("ROUTE-G"));
      await db
        .update(patientsTable)
        .set({ firstName: NAME_AFTER_MASTER_EDIT, lastName: "Edited" })
        .where(eq(patientsTable.id, f.patientA));
      try {
        const bodyAfter = clinical(visibleText(await artifactHtml(f.routeSigned.reportId)));
        // The authored findings and impression are the signed artifact; correcting
        // the identity block must not touch a single character of them.
        expect(bodyAfter).toBe(bodyBefore);
      } finally {
        await db
          .update(patientsTable)
          .set({ firstName: NAME_AT_SIGNING, lastName: `SYNTHETIC ${RUN}` })
          .where(eq(patientsTable.id, f.patientA));
      }
    });

    it("DOCUMENTED LIMITATION: a report signed before identity capture keeps its examination facts fixed but re-reads the master's name", async () => {
      // `signedA` is inserted straight into the table with no freeze row, which is
      // what every report signed before this change looks like. Nothing can be
      // reconstructed about what its signer saw, so this arm pins the fallback
      // rather than pretending it is frozen: the STUDY half comes from immutable
      // radiology rows and never moves, while the patient NAME and the DOB-derived
      // age are re-read live. Reports signed from now on take the frozen path above.
      const before = await artifactHtml(f.reports.signedA);
      const dayBefore = examinationDay(before);
      const accBefore = [f.accessionWlA, f.accessionA].find((a) => before.includes(a)) ?? "";
      expect(dayBefore).toBe(EXAM_DATE_ISO);
      expect(accBefore, "the legacy report printed no accession to compare against").toBeTruthy();

      await db
        .update(patientsTable)
        .set({ firstName: NAME_AFTER_MASTER_EDIT, dateOfBirth: "1970-01-10" })
        .where(eq(patientsTable.id, f.patientA));
      try {
        const after = await artifactHtml(f.reports.signedA);
        expect(examinationDay(after)).toBe(dayBefore);
        expect(after).toContain(accBefore);
        expect(visibleText(after)).toContain(NAME_AFTER_MASTER_EDIT);
      } finally {
        await db
          .update(patientsTable)
          .set({ firstName: NAME_AT_SIGNING, dateOfBirth: EXAM_DOB })
          .where(eq(patientsTable.id, f.patientA));
      }
    });
  });

  // ── Test H — sparse historical reports stay readable and honest ────────────
  describe("Test H — a historical report with missing metadata", () => {
    it("still renders", async () => {
      const html = await artifactHtml(f.reports.sparse);
      const text = visibleText(html);
      expect(text).toContain(mark("SPARSE"));
      expect(text).toContain(`MRI BRAIN (PLAIN) ${RUN}`);
    });

    it("RED: does not turn the 1900-01-01 sentinel DOB into a printed age", async () => {
      const html = await artifactHtml(f.reports.sparse);
      const age = printedAge(html);
      // Today the builder's private derivation ignores the sentinel and prints
      // 126y — an age no living patient has, on a signed clinical document.
      expect(age).not.toBe("126");
      expect(age).not.toBe("125");
      expect(age).not.toBe("127");
      expect(age).toBe("");
    });

    it("draws no label for a field it has no value for", async () => {
      const html = await artifactHtml(f.reports.sparse);
      const block = visibleText(demographyBlock(html));
      // An "Accession:" with nothing after it tells a clinician the study has no
      // accession, which this code is not entitled to claim.
      expect(/accession/i.test(block)).toBe(false);
      expect(block).not.toMatch(/undefined/i);
      expect(block).not.toMatch(/\bnull\b/i);
    });

    it("RED: a report with no study reference still renders, and claims no study date", async () => {
      const html = await artifactHtml(f.reports.noStudy);
      const text = visibleText(html);
      expect(text).toContain(mark("NOSTUDY"));
      expect(text).toContain(f.uhidA);
      // The brief: "Do not use current time as a fallback for historical
      // examination time." With no study there is no examination date to print —
      // but the builder's date row is `createdAt`, so it prints the report's own
      // creation day in the slot a clinician reads as the examination day.
      expect(examinationDay(html)).toBe("");
      expect(text).not.toContain(f.accessionA);
      expect(text).not.toContain(f.accessionWlA);
    });
  });

  // ── Test I — one report, every output surface, one identity ────────────────
  describe("Test I — preview, print, PDF, public PDF and email agree", () => {
    /**
     * Every surface `buildReportArtifact` is called with in production
     * (routes/patient-reports.ts:3405 print + print_preview, :3435 pdf, :3483
     * public_pdf, :3606 email), each with the option set its route passes. These
     * are the copies that leave the building: the screen the radiologist signs
     * from, the paper the patient is handed, the PDF WhatsApp carries and the
     * email body.
     *
     * The Word export is not in this list and cannot be: it is built client-side
     * (diagnostic-erp/src/lib/radiologyReportWordExport.ts) from the workspace's
     * own `ReportDemography`, and this is a server request test. It is covered by
     * the fact that every client surface — workspace card, live preview, Word,
     * client PDF, print preview — reads that one model, so what is asserted here
     * is the half that was actually broken: the server artifact versus the
     * records. Word prints a subset (no UHID, no accession), which Phase 5 allows
     * as a presentation difference.
     */
    /**
     * `staff` marks the copies a clinician reads, where every identity field must
     * be present. `public_pdf` is the patient-facing share and is deliberately NOT
     * held to the same row set: Phase 5 permits presentation differences and
     * forbids value differences, and a patient copy that omits the UHID is the
     * former. What is asserted of it is that whatever it prints agrees, and that
     * it still names the patient and the signer.
     */
    const SURFACES: { name: string; staff: boolean; opts: ArtifactOpts }[] = [
      { name: "print_preview", staff: true, opts: { surface: "print_preview", versionMode: "specific", autoPrint: true } },
      { name: "print", staff: true, opts: { surface: "print", versionMode: "specific", autoPrint: true } },
      { name: "pdf", staff: true, opts: { surface: "pdf", versionMode: "specific" } },
      { name: "public_pdf", staff: false, opts: { surface: "public_pdf", versionMode: "specific", copyType: "patient" } },
      { name: "email", staff: true, opts: { surface: "email", versionMode: "specific" } },
    ];

    const factsFor = async (surface: { name: string; opts: ArtifactOpts }) => {
      const html = await artifactHtml(f.reports.signedA, surface.opts);
      return {
        name: surface.name,
        html,
        facts: identityFacts(html, {
          uhid: f.uhidA,
          accessions: [f.accessionWlA, f.accessionA],
          referrer: REFERRER,
          name: NAME_AT_SIGNING,
        }),
      };
    };

    it("RED: every clinical surface prints the identity the records hold", async () => {
      // One assertion list, not one test per surface: the defect is in the shared
      // renderer, so a per-surface test would report the same root cause five
      // times and hide the fact that they all fail together.
      const expected: IdentityFacts = {
        patientName: NAME_AT_SIGNING,
        age: String(EXAM_AGE_YEARS),
        uhid: f.uhidA,
        accession: f.accessionWlA,
        examinationDay: EXAM_DATE_ISO,
        referrer: REFERRER,
      };
      for (const surface of SURFACES.filter((s) => s.staff)) {
        const { facts } = await factsFor(surface);
        for (const key of IDENTITY_KEYS) {
          // `accession` is the one field with two acceptable spellings of the same
          // fact: the worklist row and the billed study each carry one, and
          // `loadReportAccessionForReport` provably prefers the worklist row.
          if (key === "accession") {
            expect(facts.accession, `${surface.name} — accession`).not.toBe("");
            expect([f.accessionWlA, f.accessionA], `${surface.name} — accession`).toContain(facts.accession);
            continue;
          }
          expect(facts[key], `${surface.name} — ${key}`).toBe(expected[key]);
        }
      }
    });

    it("no two surfaces of the same signed report disagree about identity", async () => {
      const rendered: Awaited<ReturnType<typeof factsFor>>[] = [];
      for (const surface of SURFACES) rendered.push(await factsFor(surface));
      const baseline = rendered[0]!;
      for (const other of rendered.slice(1)) {
        expectIdentityAgreement(`${baseline.name} vs ${other.name}`, baseline.facts, other.facts);
      }
      // A surface that printed nothing at all would satisfy the loop above by
      // omitting every field, so pin that every surface at least names the patient.
      for (const { name, facts } of rendered) {
        expect(facts.patientName, `${name} printed no patient name`).not.toBe("");
      }
    });

    it("keeps the signing event on every surface", async () => {
      // Phase 2 Issue 1: "Signing Date = the signing event when separately
      // displayed". Correcting the examination-date slot must not delete it, and
      // no surface may drop the signature that makes the document signed.
      for (const surface of SURFACES) {
        const text = visibleText(await artifactHtml(f.reports.signedA, surface.opts));
        expect(text, `${surface.name} lost the signing instant`).toContain(REPORT_SIGNED_AT.toLocaleString("en-IN"));
        expect(text, `${surface.name} lost the signer`).toContain("Dr Synthetic Rao");
      }
    });
  });

  // ── Test J — the HOPE association ──────────────────────────────────────────
  describe("Test J — the report emitted to HOPE is the intended patient's", () => {
    /**
     * Driven through the public emitter, not a private helper: `dispatchNow:false`
     * keeps the outbox undelivered, so this needs no HOPE connectivity and still
     * returns the report id the emitter actually chose. Both candidate reports
     * carry the same CARE order, so the referral lookup succeeds whichever one is
     * picked and `result.reportId` is the only variable.
     */
    const emitForWorklistA = async () => {
      const { emitReportToHope } = await import("../services/integration/emitReportToHope");
      return emitReportToHope({ worklistId: f.worklistA, dispatchNow: false });
    };

    it("RED: a worklist-id lookup does not emit another patient's report", async () => {
      const result = await emitForWorklistA();
      // Worklist row A belongs to patient A, and A's own signed report names that
      // row in `study_id`. But B's report names the SAME row, was created later,
      // and `resolveReportId` orders by `id DESC` with no patient check — so the
      // emitter picks B's report and pushes it against A's HOPE referral.
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.reportId).toBe(f.reports.signedA);
      expect(result.reportId).not.toBe(f.reports.collisionB);
      expect(result.referralUuid).toBe(f.referralUuid);
    });

    it("an explicit reportId is honoured unchanged", async () => {
      const { emitReportToHope } = await import("../services/integration/emitReportToHope");
      const result = await emitReportToHope({ reportId: f.reports.signedA, dispatchNow: false });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      expect(result.reportId).toBe(f.reports.signedA);
    });
  });
});
