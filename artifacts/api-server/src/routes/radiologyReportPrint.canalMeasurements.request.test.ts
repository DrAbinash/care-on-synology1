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
    extraRows: { rows: Level[]; under: "billed" | "worklist-row" } = { rows: [], under: "billed" },
    /** The draft's `structured_json` envelope, exactly as save-draft stores it. The
     *  Reporting Workspace grid writes the canonical canal record HERE, not into
     *  `spinal_measurements` — pass it to exercise the store the radiologist sees. */
    draftEnvelope?: unknown,
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
        ...(draftEnvelope !== undefined ? { structuredJson: draftEnvelope } : {}),
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

  // ── The store the radiologist can reach must be the one that prints ──────────
  // Audit 2026-10-17 §6, measured in Chromium on one study in one minute: the grid under
  // Reporting Tools → Structure showed L4-L5 = 8.5 mm while the printed table was built
  // from `spinal_measurements`, which that grid never writes (its only SPA writer is the
  // box buried under the AI tab → Measure stage). Every case above seeds
  // `spinal_measurements` DIRECTLY, so entry was tested, print was tested, and the join
  // between them was tested by nobody — because it did not exist. These cases drive the
  // same route through the draft envelope, which is what the workspace actually writes.
  const canalRec = (level: string, over: Record<string, unknown> = {}) => ({
    level,
    measurementId: "CANAL_AP",
    unit: "mm",
    region: level.startsWith("L") ? "lumbar" : level.startsWith("C") ? "cervical" : "dorsal",
    viewerValue: null,
    reportValue: null,
    manualOverride: false,
    annotationId: null,
    viewerMeasurementRowId: null,
    studyInstanceUID: null,
    seriesInstanceUID: null,
    sopInstanceUID: null,
    frameNumber: null,
    viewerName: null,
    capturedAt: null,
    verifiedAt: null,
    staleReason: null,
    aliasConflict: null,
    ...over,
  });
  const envelope = (records: Record<string, unknown>) => ({ careCanalApProvenance: records });

  /** The printed table, read as pairs. Asserting `html.toContain("8.5")` over a whole
   *  rendered page is not evidence — a CSS value or an accession can carry the digits —
   *  and `indexOf("L4-L5")` matches the section title before it matches the column, so
   *  both were measured against the cells themselves. */
  const canalCells = (html: string): Array<{ level: string; value: string }> | null => {
    const table = html.match(/CANAL AP DIAMETER[\s\S]*?<\/table>/i)?.[0];
    if (!table) return null;
    const heads = [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).slice(1);
    const values = [...table.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]).slice(1);
    return heads.map((level, i) => ({ level, value: values[i] ?? "" }));
  };

  it("prints the number typed into the workspace grid when the study has no spinal_measurements row", async () => {
    const html = await scenario([], "billed", undefined, envelope({
      "L4-L5": canalRec("L4-L5", { reportValue: 8.5, manualOverride: true }),
      "L5-S1": canalRec("L5-S1", { reportValue: 9.1, manualOverride: true }),
    }));
    const cells = canalCells(html);
    expect(cells, "the grid's numbers must reach the printed table").not.toBeNull();
    expect(cells).toContainEqual({ level: "L4-L5", value: "8.5" });
    expect(cells).toContainEqual({ level: "L5-S1", value: "9.1" });
    expect(cells!.find((c) => c.level === "L1-L2")!.value).toBe("—"); // unmeasured stays unmeasured
  });

  it("prints the radiologist's override, not the caliper reading stored beside it", async () => {
    // One record, two numbers: 7.2 from the viewer, 8.5 typed over it. The record's own
    // rule answers 8.5, and the other store also held 7.2 — a fold that preferred the
    // row would sign a measurement the radiologist had explicitly replaced.
    const html = await scenario(
      [{ vertebraLevel: "L4-L5", canalAP: "7.2" }],
      "billed",
      undefined,
      envelope({ "L4-L5": canalRec("L4-L5", { viewerValue: 7.2, reportValue: 8.5, manualOverride: true }) }),
    );
    const cells = canalCells(html)!;
    expect(cells.find((c) => c.level === "L4-L5")!.value).toBe("8.5");
    expect(html.slice(html.search(/CANAL AP DIAMETER/i), html.search(/<\/table>/i) + 9)).not.toContain("7.2");
  });

  it("still prints levels that exist only in the measurement table", async () => {
    // The legacy generator page and the AI-tab box write spinal_measurements directly,
    // and drafts older than the canonical record hold nothing in their envelope. If
    // those stopped printing it would be a second defect, not a fix.
    const html = await scenario(
      [{ vertebraLevel: "L3-L4", canalAP: "15.2" }],
      "billed",
      undefined,
      envelope({ "L4-L5": canalRec("L4-L5", { reportValue: 8.5, manualOverride: true }) }),
    );
    const cells = canalCells(html)!;
    expect(cells).toContainEqual({ level: "L3-L4", value: "15.2" });
    expect(cells).toContainEqual({ level: "L4-L5", value: "8.5" });
  });

  it("prints nothing for a level the record declines, even when the table holds a value for it", async () => {
    // "L4-5" and "L4-L5" are one disc spelled two ways with two numbers. Choosing
    // between them is a clinical decision, so the record refuses and the grid shows the
    // cell empty. Printing the older row would put a number on paper that the
    // radiologist was told not to trust.
    const html = await scenario(
      [{ vertebraLevel: "L4-L5", canalAP: "7.2" }],
      "billed",
      undefined,
      envelope({
        "L4-5": canalRec("L4-5", { reportValue: 8.5, manualOverride: true }),
        "L4-L5": canalRec("L4-L5", { reportValue: 9.4, manualOverride: true }),
      }),
    );
    expect(canalCells(html), "a declined level must not print the other store's row").toBeNull();
    expect(html).not.toMatch(/CANAL AP DIAMETER/);
  });

  it("prints a transitional level the fixed vocabulary cannot express", async () => {
    // Sacralisation of L5 offers the row L5-T, the record stores it, the grid saves and
    // restores it — and every print path iterated the fixed five, so the measurement
    // appeared on no paper at all. Not a mis-assignment: a silent omission, the same
    // class of defect the numbering question was raised for.
    const html = await scenario([], "billed", undefined, envelope({
      "L4-L5": canalRec("L4-L5", { reportValue: 10.2, manualOverride: true }),
      "L5-T": canalRec("L5-T", { reportValue: 8.4, manualOverride: true }),
    }));
    const cells = canalCells(html)!;
    expect(cells).toContainEqual({ level: "L5-T", value: "8.4" });
    const order = cells.map((c) => c.level);
    expect(order.indexOf("L4-L5")).toBeLessThan(order.indexOf("L5-T"));
  });
});
