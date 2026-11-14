/**
 * One heading case across the server-rendered body.
 *
 * The clinic chooses a heading case once (Presentation settings) and it rides the
 * preview URL as `headingCase`. Technique, the findings sections and Impression are
 * formatted with it (`fmtServerHeading`), and the route's own comment records why:
 * "the client's live print body case-formats every heading (default all_caps), so a
 * direct preview render no longer disagrees with the document it previews."
 *
 * Two headings were left out of that fold: `Clinical History` and `Recommendation`
 * are template literals. Under the value the app actually sends — `all_caps` — the
 * page therefore prints CLINICAL HISTORY among TECHNIQUE/FINDINGS/IMPRESSION, i.e.
 * two of five headings in a case nobody configured. `care-premium` hides it with
 * `text-transform: uppercase` on the section-heading slot; `care-classic`
 * (reportPresentation.ts:281) has no transform, so there the markup case IS the
 * printed case, and any custom clinic-letterhead template without a transform
 * behaves the same way.
 *
 * These tests read the heading inventory off the real route over a real Postgres,
 * on the template that has no CSS transform to lean on.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
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
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

describe.skipIf(!dbReady)("section heading case on the draft print preview", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const marker = `hcase-${randomUUID().slice(0, 8)}`;
    token = `hcase-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Heading Tester ${marker}`,
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
    for (const id of draftIds) await db.delete(radiologyReportDraftsTable).where(eq(radiologyReportDraftsTable.id, id));
    for (const id of worklistIds) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  /**
   * The rendered heading inventory, in document order. Asserting the whole list
   * rather than `html.toContain("CLINICAL HISTORY")` matters twice over: a heading
   * that vanished would pass a containment test, and only the full list shows that
   * one document carries one case.
   */
  const headings = (html: string) =>
    [...html.matchAll(/<div class="section-heading">([^<]*)<\/div>/g)].map((m) => m[1]);

  async function render(
    query: string,
    sections: Record<string, string> = {
      Technique: "Axial T1, T2 and FLAIR sequences were acquired.",
      Brain: "No acute haemorrhage. Age-appropriate sulcal prominence.",
    },
  ) {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Heading ${tag}`,
        age: "61 Y",
        sex: "F",
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
        studyDate: "2026-10-16",
        accessionNumber: `Acc${tag}`,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
        studyId: null,
      })
      .returning();
    worklistIds.push(wl.id);

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        worklistId: wl.id,
        studyId: wl.id,
        patientId: null,
        modality: "MR",
        studyName: "MRI BRAIN PLAIN",
        clinicalHistory: "Headache for three months.",
        rawFindings: "Raw findings sentence that sections replace.",
        findingsSections: JSON.stringify(sections),
        impression: JSON.stringify(["No acute intracranial abnormality."]),
        recommendation: "Clinical correlation advised.",
      })
      .returning();
    draftIds.push(draft.id);

    const res = await request(app)
      .get(`/api/radiology/report-generator/drafts/${draft.id}/print-preview?template=care-classic${query}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, "print-preview must render").toBe(200);
    return { html: res.text as string, list: headings(res.text as string) };
  }

  it("prints every heading in the case the clinic asked for (all_caps)", async () => {
    const { list } = await render("&headingCase=all_caps");
    expect(list, "the body must render its headings").not.toHaveLength(0);
    expect(list).toEqual([
      "CLINICAL HISTORY",
      "TECHNIQUE",
      "BRAIN",
      "IMPRESSION",
      "RECOMMENDATION",
    ]);
  });

  it("prints every heading in the other configured case (title_case)", async () => {
    const { list } = await render("&headingCase=title_case");
    expect(list).toEqual([
      "Clinical History",
      "Technique",
      "Brain",
      "Impression",
      "Recommendation",
    ]);
  });

  it("still defaults to title_case when the caller sends no preference", async () => {
    // parseHeadingCase answers title_case for anything unrecognised. The all_caps
    // case above cannot catch a fix that simply upper-cased every heading, so this
    // one pins the other half of the same rule.
    const { list } = await render("");
    expect(list).toEqual([
      "Clinical History",
      "Technique",
      "Brain",
      "Impression",
      "Recommendation",
    ]);
  });

  it("folds the raw-findings heading too, whichever shape the draft is in", async () => {
    // No sections → the route renders the single Findings heading from
    // `raw_findings`. It was already case-formatted; the two that were not are the
    // rows around it, so the assertion is the whole list, not one label.
    const { list } = await render("&headingCase=all_caps", {});
    expect(list).toEqual([
      "CLINICAL HISTORY",
      "FINDINGS",
      "IMPRESSION",
      "RECOMMENDATION",
    ]);
  });

  it("case-formats headings without touching the clinical text under them", async () => {
    const { html } = await render("&headingCase=all_caps");
    expect(html).toContain("Axial T1, T2 and FLAIR sequences were acquired.");
    expect(html).toContain("No acute haemorrhage. Age-appropriate sulcal prominence.");
    expect(html).toContain("Headache for three months.");
    expect(html).toContain("Clinical correlation advised.");
    expect(html).toContain("No acute intracranial abnormality.");
  });
});
