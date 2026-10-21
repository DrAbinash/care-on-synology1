/**
 * Request-level: GET /api/radiology/pacs-worklist — payload shape and date bounds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  portalSessionsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientsTable,
  testsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { compactStudyDateDay, worklistDateConditions } from "../lib/pacs/worklistDateFilter";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("pacs-worklist list payload — request level", () => {
  let app: Express;
  const marker = `pacslist-${randomUUID().slice(0, 8)}`;
  const token = `vitest-token-${randomUUID()}`;
  let userId = 0;
  let worklistId = 0;
  let patientId = 0;
  const uhid = `UH-PL-${randomUUID().slice(0, 8).toUpperCase()}`;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Pacs List ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/orders", "/patients", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: uhid,
        firstName: `List ${marker}`,
        lastName: "Probe",
        dateOfBirth: "1974-03-02",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientId: patient.id,
        patientName: `List Probe ${marker}`,
        modality: "MR",
        status: "STUDY_RECEIVED",
        studyDescription: `perf-wiring ${marker}`,
        studyDate: "20260904",
        accessionNumber: `ACC-PL-${marker}`,
        studyInstanceUID: `1.2.840.perf.${marker}`,
        dicomMetadata: JSON.stringify({ PatientAge: "045Y", huge: "x".repeat(2000) }),
        aiDraftJson: JSON.stringify({ findings: "blob should not ship on list", impression: "x" }),
        aiDraftStatus: "NONE",
      })
      .returning();
    worklistId = wl.id;
  });

  afterAll(async () => {
    if (worklistId) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    }
    if (token) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    }
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    if (patientId) {
      await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    }
  });

  it("list rows omit dicomMetadata and aiDraftJson", async () => {
    const res = await request(app)
      .get("/api/radiology/pacs-worklist")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === worklistId);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("dicomMetadata");
    expect(row).not.toHaveProperty("aiDraftJson");
    expect(row).toHaveProperty("modality", "MR");
    expect(row).toHaveProperty("patientName");
  });

  it("per-study ai-draft detail still returns draft content", async () => {
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist/${worklistId}/ai-draft`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("draft");
  });

  it("per-study detail returns dicomMetadata + demographics, not aiDraftJson", async () => {
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist/${worklistId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("id", worklistId);
    expect(res.body).toHaveProperty("dicomMetadata");
    expect(res.body).toHaveProperty("patientName");
    expect(res.body).toHaveProperty("age");
    expect(res.body).toHaveProperty("sex");
    expect(res.body).not.toHaveProperty("aiDraftJson");
    expect(String(res.body.dicomMetadata)).toContain("PatientAge");
  });

  it("the per-study detail read carries the patients-master UHID, not just the key", async () => {
    // The workspace prints the UHID from the canonical demography. Its queue row
    // is keyed on the active filter and is null for a study the filter excludes,
    // so the by-id read is the only source that survives — without `uhid` here
    // the report fell back to `patientId`, a Postgres sequence value, and
    // printed "UHID: 47" on a signed sheet.
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist/${worklistId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("uhid", uhid);
    expect(res.body.patientId).toBe(patientId);
    expect(String(res.body.uhid)).not.toBe(String(patientId));

    const list = await request(app)
      .get(`/api/radiology/pacs-worklist`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const row = (list.body as Array<{ id: number; uhid?: string | null }>).find(
      (r) => r.id === worklistId,
    );
    expect(row?.uhid).toBe(uhid);
  });

  it("the per-study detail read carries the billed test name (study context survives the queue filter)", async () => {
    // The queue row is null for any study the reading-queue FILTER excludes
    // (CT under the default MR preset, deep links, a filter change
    // mid-report), so the by-id read is the only source of study CONTEXT —
    // modality, studyDescription, testName — that survives. Without testName
    // here the region-resolution / Quick Select layer lost the billed-test
    // hint and answered to the DICOM description alone (Radiology Highway
    // Audit, Patient B/C finding).
    const [test] = await db
      .insert(testsTable)
      .values({
        code: `CT-DETAIL-${marker}`,
        name: `Detail Probe CT ${marker}`,
        category: "Radiology",
        price: "100.00",
        duration: "10 min",
      })
      .returning();
    const [study] = await db
      .insert(radiologyStudiesTable)
      .values({
        accessionNumber: `ACC-DETAIL-${marker}`,
        patientId,
        testId: test.id,
        modality: "CT",
      })
      .returning();
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientId,
        patientName: `Detail Probe ${marker}`,
        modality: "CT",
        status: "STUDY_RECEIVED",
        studyDescription: "CT BRAIN PLAIN",
        studyDate: "20260904",
        accessionNumber: `ACC-DETAIL-${marker}`,
        studyInstanceUID: `1.2.840.detail.${marker}`,
        studyId: study.id,
      })
      .returning();
    try {
      const res = await request(app)
        .get(`/api/radiology/pacs-worklist/${wl.id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveProperty("testId", test.id);
      expect(res.body).toHaveProperty("testName", `Detail Probe CT ${marker}`);
      expect(res.body).toHaveProperty("billedTestName", `Detail Probe CT ${marker}`);
      expect(res.body).toHaveProperty("modality", "CT");
      expect(res.body).toHaveProperty("studyDescription", "CT BRAIN PLAIN");
    } finally {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, wl.id));
      await db.delete(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, study.id));
      await db.delete(testsTable).where(eq(testsTable.id, test.id));
    }
  });

  it("list USG aggregates are present and numeric for seeded rows", async () => {
    const res = await request(app)
      .get("/api/radiology/pacs-worklist")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === worklistId);
    expect(row).toBeTruthy();
    expect(typeof row!.usgMeasurementCount).toBe("number");
    expect(typeof row!.usgKeyImageCount).toBe("number");
    expect(row).toHaveProperty("usgReportStatus");
  });
});

/**
 * Date bounds on the reading queue.
 *
 * `radiology_worklist.study_date` is TEXT and holds two shapes at once: the DICOM
 * compact day from modality intake and the ISO day from CARE's own stamping. The
 * filter used to convert the requested bound to compact and compare the raw
 * column, which dropped every ISO row — and not just on the equality: `-` sorts
 * before `0`, so all compact rows compare greater than all ISO rows and a range
 * over the mixed column partitions by FORMAT, not by date. The symptom is a
 * Reading Queue that shows an empty "Today" with no error anywhere.
 *
 * mriStudyWarmer.ts's own `inDayWindow` already did this correctly (strip, take
 * eight digits, compare both sides); these two query sites were the outliers.
 *
 * The days are computed once and used for BOTH the inserted rows and the query,
 * so nothing here depends on the difference between UTC and IST — the assertions
 * are about which rows a given window returns, not about what today is.
 */
describe.skipIf(!dbReady)("pacs-worklist date bounds — request level", () => {
  let app: Express;
  const marker = `pacsdate-${randomUUID().slice(0, 8)}`;
  const token = `vitest-date-token-${randomUUID()}`;
  let userId = 0;
  const rowIds: number[] = [];

  const istDay = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  };
  const TODAY = istDay(0);
  const YESTERDAY = istDay(1);
  const OLDER = istDay(30);
  const toCompact = (iso: string) => iso.replace(/-/g, "");

  /** name → study_date, both shapes on purpose. */
  const SEED: Array<{ name: string; studyDate: string | null }> = [
    { name: "iso-today", studyDate: TODAY },
    { name: "compact-today", studyDate: toCompact(TODAY) },
    { name: "iso-yesterday", studyDate: YESTERDAY },
    { name: "compact-yesterday", studyDate: toCompact(YESTERDAY) },
    { name: "iso-older", studyDate: OLDER },
    { name: "timestamp-today", studyDate: `${TODAY}T09:30:00` },
    { name: "no-date", studyDate: null },
  ];

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Pacs Date ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/orders", "/patients", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    const inserted = await db
      .insert(radiologyWorklistTable)
      .values(SEED.map((s) => ({
        patientName: `Date Probe ${s.name} ${marker}`,
        modality: "MR",
        status: "STUDY_RECEIVED",
        studyDate: s.studyDate,
        accessionNumber: `ACC-DT-${s.name}-${marker}`,
        studyInstanceUID: `1.2.840.date.${s.name}.${marker}`,
      })))
      .returning({ id: radiologyWorklistTable.id, patientName: radiologyWorklistTable.patientName });
    for (const r of inserted) rowIds.push(r.id);
  });

  afterAll(async () => {
    for (const id of rowIds) {
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    }
    if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  /** Every seeded row the queue returns for a window, keyed by its probe name. */
  async function visible(opts: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<string[]> {
    const q = new URLSearchParams({ search: marker });
    if (opts.dateFrom) q.set("dateFrom", opts.dateFrom);
    if (opts.dateTo) q.set("dateTo", opts.dateTo);
    const res = await request(app)
      .get(`/api/radiology/pacs-worklist?${q.toString()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (res.body as Array<{ patientName: string }>)
      .map((r) => /Date Probe (\S+)/.exec(r.patientName)?.[1])
      .filter((n): n is string => Boolean(n))
      .sort();
  }

  it("a Today window returns the ISO row AND the compact row", async () => {
    expect(await visible({ dateFrom: TODAY, dateTo: TODAY }))
      .toEqual(["compact-today", "iso-today", "timestamp-today"]);
  });

  it("a Yesterday window is not format-blind either", async () => {
    expect(await visible({ dateFrom: YESTERDAY, dateTo: YESTERDAY }))
      .toEqual(["compact-yesterday", "iso-yesterday"]);
  });

  it("Today + Yesterday spans both days in both shapes", async () => {
    expect(await visible({ dateFrom: YESTERDAY, dateTo: TODAY })).toEqual([
      "compact-today",
      "compact-yesterday",
      "iso-today",
      "iso-yesterday",
      "timestamp-today",
    ]);
  });

  it("an older window reaches studies the recent ones exclude", async () => {
    const window = await visible({ dateFrom: OLDER, dateTo: YESTERDAY });
    expect(window).toContain("iso-older");
    expect(window).not.toContain("iso-today");
    expect(window).not.toContain("compact-today");
  });

  it("the bounds are inclusive at both ends", async () => {
    // OLDER..TODAY must hold the first day, the last day and the day between.
    expect(await visible({ dateFrom: OLDER, dateTo: TODAY })).toEqual([
      "compact-today",
      "compact-yesterday",
      "iso-older",
      "iso-today",
      "iso-yesterday",
      "timestamp-today",
    ]);
  });

  it("an open lower bound keeps everything from that day forward", async () => {
    expect(await visible({ dateFrom: YESTERDAY })).toEqual([
      "compact-today",
      "compact-yesterday",
      "iso-today",
      "iso-yesterday",
      "timestamp-today",
    ]);
  });

  it("a single-day ?date= match works for either shape", async () => {
    // The enterprise worklist route takes one ?date=; run its condition here
    // against the same rows, since pacs-worklist only exposes a range.
    const run = async (day: string) => {
      const rows = await db
        .select({ patientName: radiologyWorklistTable.patientName })
        .from(radiologyWorklistTable)
        .where(and(
          like(radiologyWorklistTable.patientName, `%${marker}%`),
          ...worklistDateConditions(radiologyWorklistTable.studyDate, { exact: day }),
        ));
      return rows
        .map((r) => /Date Probe (\S+)/.exec(r.patientName)?.[1])
        .filter((n): n is string => Boolean(n))
        .sort();
    };
    expect(await run(TODAY)).toEqual(["compact-today", "iso-today", "timestamp-today"]);
    expect(await run(YESTERDAY)).toEqual(["compact-yesterday", "iso-yesterday"]);
    expect(await run(OLDER)).toEqual(["iso-older"]);
  });

  it("a row with no study date is excluded from any dated window", async () => {
    expect(await visible({ dateFrom: OLDER, dateTo: TODAY })).not.toContain("no-date");
  });

  it("an unparseable bound refuses rows instead of silently widening the queue", async () => {
    expect(await visible({ dateFrom: "not-a-date", dateTo: TODAY })).toEqual([]);
  });

  it("no bound at all still shows every shape", async () => {
    expect(await visible({})).toEqual([
      "compact-today",
      "compact-yesterday",
      "iso-older",
      "iso-today",
      "iso-yesterday",
      "no-date",
      "timestamp-today",
    ]);
  });

  it("compactStudyDateDay accepts every shape the column holds", () => {
    expect(compactStudyDateDay("2026-10-11")).toBe("20261011");
    expect(compactStudyDateDay("20261011")).toBe("20261011");
    expect(compactStudyDateDay("2026/10/11")).toBe("20261011");
    expect(compactStudyDateDay("2026-10-11T09:30:00Z")).toBe("20261011");
    expect(compactStudyDateDay("  2026-10-11  ")).toBe("20261011");
    expect(compactStudyDateDay("2026-1")).toBeNull();
    expect(compactStudyDateDay("")).toBeNull();
    expect(compactStudyDateDay(null)).toBeNull();
    expect(compactStudyDateDay(undefined)).toBeNull();
  });
});
