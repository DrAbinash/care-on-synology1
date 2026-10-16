/**
 * The draft print-preview is the surface the clinic prints and the Word export
 * is built from, and it is the only server surface that draws the disc-level
 * canal AP diameter table. Two things stopped it ever drawing:
 *
 *  1. the gate that decides whether a segment has measurements indexed the
 *     per-segment COUNT ARRAY with the largest COUNT (`counts[Math.max(...counts)]`)
 *     instead of asking whether that largest count is above zero. A lumbar
 *     report's counts are `[n,0,0]`, so the gate read `counts[n]` — a dorsal
 *     slot that is always 0 — and the table was dropped for every lumbar study,
 *     however many levels were measured.
 *  2. the table was looked up under `draft.studyId`, which `save-draft` overwrites
 *     with the worklist ROW id, while the reporting workspace writes canal
 *     measurements under `radiology_worklist.study_id` (the billed study id). For
 *     any study linked to a billed test those two keys differ, so the preview was
 *     querying a key no writer ever uses.
 *
 * These tests drive the real route over a real Postgres and assert the rendered
 * table, not the source text.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  usersTable,
  portalSessionsTable,
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  spinalMeasurementsTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

type Level = { vertebraLevel: string; canalAP: string };

describe.skipIf(!dbReady)("canal AP table on the draft print preview", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];
  const createdStudyKeys = new Set<number>();

  beforeAll(async () => {
    app = await createTestApp();
    const marker = `canal-${randomUUID().slice(0, 8)}`;
    token = `canal-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Canal Tester ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "admin",
        permissions: JSON.stringify(["/radiology", "/report-generator", "/reports"]),
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    if (createdStudyKeys.size > 0) {
      await db.delete(spinalMeasurementsTable).where(
        inArray(spinalMeasurementsTable.studyId, [...createdStudyKeys])
      );
    }
    for (const id of draftIds) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id));
    for (const id of worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  /**
   * Builds one study exactly as the product leaves it: a worklist row linked to a
   * billed study, and a draft whose `study_id` holds the WORKLIST ROW id (that is
   * what `save-draft` writes), plus canal rows under a chosen key.
   */
  async function scenario(
    levels: Level[],
    measurementKey: "billed" | "worklist-row",
    extraRows: { rows: Level[]; under: "billed" | "worklist-row" } = { rows: [], under: "billed" }
  ) {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    // Unique per scenario: both candidate keys are read, so a billed id reused
    // across scenarios would let one case's rows overwrite another's values.
    const billedStudyId = 9_800_000 + Math.floor(Math.random() * 90_000);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Canal ${tag}`,
        age: "40 Y",
        sex: "M",
        modality: "MR",
        studyDescription: "MRI LUMBAR SPINE",
        studyDate: "2026-10-16",
        accessionNumber: `ACC-${tag}`,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
        studyId: billedStudyId,
      })
      .returning();
    worklistIds.push(wl.id);

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        worklistId: wl.id,
        // save-draft resolves the worklist and stores ITS row id here.
        studyId: wl.id,
        patientId: null,
        modality: "MR",
        studyName: "MRI LUMBAR SPINE",
        rawFindings: "Disc levels assessed.",
        impression: "[]",
      })
      .returning();
    draftIds.push(draft.id);

    const key = measurementKey === "billed" ? billedStudyId : wl.id;
    createdStudyKeys.add(key);
    const extraKey = extraRows.under === "billed" ? billedStudyId : wl.id;
    createdStudyKeys.add(extraKey);
    const rowsToStore: Array<{ studyId: number } & Level> = [
      ...levels.map((l) => ({ ...l, studyId: key })),
      ...extraRows.rows.map((l) => ({ ...l, studyId: extraKey })),
    ];
    for (const l of rowsToStore) {
      await db.insert(spinalMeasurementsTable).values({
        studyId: l.studyId,
        worklistId: wl.id,
        vertebraLevel: l.vertebraLevel,
        canalAP: l.canalAP,
        measuredBy: "canal suite",
      });
    }

    const res = await request(app)
      .get(`/api/radiology/report-generator/drafts/${draft.id}/print-preview`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, "print-preview must render").toBe(200);
    return res.text as string;
  }

  const apRow = (html: string) => /AP \(mm\)/.test(html);
  const titleOf = (html: string) => (html.match(/(LUMBAR|CERVICAL|DORSAL) CANAL AP DIAMETER[^<]*/) ?? [null])[0];

  it("prints the lumbar table for measurements stored under the billed study id", async () => {
    const html = await scenario(
      [
        { vertebraLevel: "L3-L4", canalAP: "15.2" },
        { vertebraLevel: "L4-L5", canalAP: "6.4" },
        { vertebraLevel: "L5-S1", canalAP: "8.1" },
      ],
      "billed"
    );
    expect(titleOf(html), "the canal AP table heading").toBeTruthy();
    expect(apRow(html)).toBe(true);
    // The measured numbers, not just a heading.
    expect(html).toContain("6.4");
    expect(html).toContain("15.2");
    expect(html).toContain("8.1");
  });

  it("prints the lumbar table when measurements are stored under the worklist row id", async () => {
    // An unlinked study (no billed test) is keyed by the worklist row id by the
    // same client code, and both keys must render.
    const html = await scenario([{ vertebraLevel: "L4-L5", canalAP: "7.9" }], "worklist-row");
    expect(titleOf(html)).toBeTruthy();
    expect(html).toContain("7.9");
  });

  it("prints a dorsal table whenever any level is filled", async () => {
    // counts is [0,0,n] here, so the old gate read counts[n] and closed for every
    // n except 2 — a pure-arithmetic case independent of the key.
    const html = await scenario(
      [
        { vertebraLevel: "D7-D8", canalAP: "11.1" },
        { vertebraLevel: "D8-D9", canalAP: "10.4" },
        { vertebraLevel: "D9-D10", canalAP: "9.8" },
      ],
      "billed"
    );
    expect(titleOf(html)).toMatch(/DORSAL CANAL AP DIAMETER/);
    expect(html).toContain("11.1");
  });

  it("still prints a single-level cervical table", async () => {
    // The one lumbar-shaped case the old gate happened to open; the fix must not
    // regress it.
    const html = await scenario([{ vertebraLevel: "C5-C6", canalAP: "12.6" }], "billed");
    expect(titleOf(html)).toMatch(/CERVICAL CANAL AP DIAMETER/);
    expect(html).toContain("12.6");
  });

  it("prints no canal table when the study has no measurements", async () => {
    const html = await scenario([], "billed");
    expect(titleOf(html)).toBeNull();
    expect(apRow(html)).toBe(false);
  });

  it("keeps the rest of the report intact while adding the table", async () => {
    const html = await scenario([{ vertebraLevel: "L4-L5", canalAP: "6.4" }], "billed");
    expect(html).toContain("MRI LUMBAR SPINE");
    expect(html).toContain("Disc levels assessed.");
    expect(titleOf(html)).toBeTruthy();
  });

  it("prefers the billed study's value when both keys hold the same level", async () => {
    // The two ids name one study, so a disagreement is resolved deterministically
    // toward the key the live reporting rail reads — never by printing whichever
    // row Postgres happened to return first.
    const html = await scenario(
      [{ vertebraLevel: "L4-L5", canalAP: "6.4" }],
      "billed",
      { rows: [{ vertebraLevel: "L4-L5", canalAP: "9.9" }], under: "worklist-row" }
    );
    expect(titleOf(html)).toBeTruthy();
    expect(html).toContain("6.4");
    expect(html).not.toContain("9.9");
  });
});
