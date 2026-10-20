/**
 * PP-5B — the draft print-preview names no signer.
 *
 * This route is what the workspace's Print-like-final opens in the browser and
 * what the Word export is built from when no report row exists yet. It used to
 * look up the clinic's active signature blocks, prefer one whose NAME matched a
 * regular expression, and print it under the label "Signed:" with its uploaded
 * handwriting — and when no block was active at all it printed a hard-coded
 * doctor's name. Either way the page claimed an authorization that had not
 * happened, on a document that also carried a DRAFT stamp saying it had not.
 *
 * Two things could produce that, and both are asserted against here: the block
 * lookup in the route, and the letter-pad's own fallback, which substitutes the
 * layout chrome's configured radiologist whenever the renderer is handed no
 * signature block. The second is why `signatures: []` alone was not enough.
 *
 * Every assertion is HTTP status plus the served document. Skipped without
 * DATABASE_URL (see testSupport/apiTestApp.ts); in CI it runs against
 * postgres:16.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  usersTable,
  portalSessionsTable,
  radiologyWorklistTable,
  radiologyReportDraftsTable,
  signaturesTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("draft print-preview carries no signer — request level", () => {
  let app: Express;
  const marker = `previewsign-${randomUUID().slice(0, 8)}`;
  const token = `previewsign-token-${randomUUID()}`;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];
  const signatureIds: number[] = [];
  let userId = 0;

  /** The name the old code preferred by a regular expression on it. */
  const NAMED_BLOCK = `Dr. Sugandha Priyadarshini ${marker}`;
  /** A second active block, so "pick the first active row" has an answer too. */
  const SECOND_BLOCK = `Dr. Second Active ${marker}`;
  /** The letter-pad chrome's configured radiologist, which fills an empty slot. */
  const CHROME_NAME = "Dr. Sugandha Priyadarshini";
  const FINDINGS_SENTINEL = `NO ACUTE ABNORMALITY ${marker}`;

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Preview Signer ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
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
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });

    for (const [name, active] of [[NAMED_BLOCK, true], [SECOND_BLOCK, true], [`Dr. Retired ${marker}`, false]] as const) {
      const [sig] = await db
        .insert(signaturesTable)
        .values({
          name,
          role: "Radiologist",
          qualification: "MD (Radiodiagnosis)",
          registrationNo: `REG-${marker}`,
          imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          isActive: active,
        })
        .returning();
      signatureIds.push(sig.id);
    }

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Preview ${marker}`,
        age: "41 Y",
        sex: "M",
        modality: "MR",
        studyDescription: "MRI BRAIN",
        studyDate: "2026-10-20",
        accessionNumber: `ACC-${marker}`,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "REPORT_IN_PROGRESS",
      })
      .returning();
    worklistIds.push(wl.id);

    // A draft exactly as save-draft leaves it: `study_id` holding the worklist
    // ROW id, which is what this route reads the draft back by.
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        worklistId: wl.id,
        studyId: wl.id,
        patientId: null,
        modality: "MR",
        studyName: "MRI BRAIN",
        rawFindings: FINDINGS_SENTINEL,
        impression: "[]",
      })
      .returning();
    draftIds.push(draft.id);
  });

  afterAll(async () => {
    for (const id of draftIds) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id));
    for (const id of worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    for (const id of signatureIds) await db.delete(signaturesTable).where(eq(signaturesTable.id, id));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  function preview(query = "") {
    return request(app)
      .get(`/api/radiology/report-generator/drafts/${draftIds[0]}/print-preview${query}`)
      .set("Authorization", `Bearer ${token}`);
  }

  it("the draft preview serves the draft, and names nobody", async () => {
    const res = await preview();
    expect(res.status, res.text).toBe(200);
    // Positive control: the document really rendered its own content, so the
    // absence below is not an empty page or an error response.
    expect(res.text).toContain(FINDINGS_SENTINEL);

    expect(res.text).not.toContain(NAMED_BLOCK);
    expect(res.text).not.toContain(SECOND_BLOCK);
    expect(res.text).not.toContain(CHROME_NAME);
    expect(res.text).not.toContain("Signed:");
    expect(res.text).toContain("NOT SIGNED");
    // No handwriting on a document nobody has signed.
    expect(res.text).not.toContain("alt=\"signature\"");
  });

  it("print-like-final is labelled a preview and stays unsigned", async () => {
    const res = await preview("?likeFinal=true");
    expect(res.status, res.text).toBe(200);
    expect(res.text).toContain(FINDINGS_SENTINEL);
    expect(res.text).toContain("PREVIEW — NOT SIGNED");
    expect(res.text).not.toContain(NAMED_BLOCK);
    expect(res.text).not.toContain(CHROME_NAME);
    expect(res.text).not.toContain("Signed:");
  });
});
