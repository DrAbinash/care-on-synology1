/**
 * The Demography card's corrections on the printed draft preview.
 *
 * The card writes eight fields into the draft's `careDemographyOverrides`
 * envelope, and the sign-time fold (`applyDemographyOverridesToIdentity`) takes
 * all eight — so a corrected identity is what gets signed. The DRAFT preview read
 * only two of them (STUDY and DOB, P1-1/P2-5), which was invisible on one template
 * style and wrong on every other one: the browser's `patchLetterpadDemographyHtml`
 * rebuilds the letter-pad block from the client's canonical demography and returns
 * any other block untouched, while `renderReportDocument` draws the identity in
 * four styles (letter-pad, stacked, grid, table). A NAME, AGE/SEX, UHID, STUDY DATE
 * or REFERRING DOCTOR correction therefore printed on the letter-pad preview and
 * nowhere else — not on the server page, so not on a clinic-letterhead template,
 * not in the server PDF, and not on the shared link — and then the report the
 * radiologist signed carried the correction. One draft, two patients.
 *
 * These tests drive the real route over a real Postgres and read the identity
 * block off the rendered page.
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
import { formatReportDateShort } from "../lib/reportPresentation";
import { CARE_DEMOGRAPHY_OVERRIDES_KIND } from "../lib/structuredJsonColumn";

const dbReady = hasDatabaseUrl();

/** The printed identity block as text: from the patient section to the study-title
 *  bar that follows it. Asserting against this rather than the whole page matters —
 *  a page carries the print stylesheet, the body and the key-image markup, and
 *  `not.toContain("40 Yrs")` over all of that can pass for an unrelated reason. */
function identityBlock(html: string): string {
  const start = html.search(/<div class="patient-section/i);
  if (start < 0) return "";
  const after = html.search(/<div class="study-title-bar/i);
  const slice = html.slice(start, after > start ? after : start + 4000);
  return slice.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Case- and punctuation-insensitive containment. The identity block is
 *  `text-transform: uppercase` in CSS but the markup keeps the author's case, and
 *  the referring doctor is run through a display formatter that adds a period and
 *  title-cases the name — both of which are this suite's business as little as the
 *  value it carries. */
const shows = (haystack: string, value: string) =>
  haystack.toLowerCase().replace(/[^a-z0-9]/g, "").includes(value.toLowerCase().replace(/[^a-z0-9]/g, ""));

describe.skipIf(!dbReady)("demography corrections on the draft print preview", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const marker = `demo-${randomUUID().slice(0, 8)}`;
    token = `demo-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Demography Tester ${marker}`,
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
   * One study per case, addressed by a per-case TAG, and the draft's envelope built
   * from that same tag. The tag is what makes an absence assertion mean something:
   * "the worklist name is not on the page" is only evidence when the worklist name
   * could not have been printed by any other row.
   */
  async function preview(overridesFor?: (tag: string) => Record<string, string>) {
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Rawname ${tag}`,
        age: "40 Y",
        sex: "M",
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
        studyDate: "2026-10-16",
        accessionNumber: `Acc${tag}`,
        referringDoctor: `Dr Rawref ${tag}`,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
        studyId: null,
      })
      .returning();
    worklistIds.push(wl.id);

    const demographyOverrides = overridesFor?.(tag);
    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        worklistId: wl.id,
        studyId: wl.id,
        patientId: null,
        modality: "MR",
        studyName: "MRI BRAIN PLAIN",
        rawFindings: `Findings for study ${tag}.`,
        impression: "[]",
        ...(demographyOverrides
          ? {
              structuredJson: {
                careDemographyOverrides: {
                  kind: CARE_DEMOGRAPHY_OVERRIDES_KIND,
                  ...demographyOverrides,
                },
              },
            }
          : {}),
      })
      .returning();
    draftIds.push(draft.id);

    const res = await request(app)
      .get(`/api/radiology/report-generator/drafts/${draft.id}/print-preview`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, "print-preview must render").toBe(200);
    const block = identityBlock(res.text as string);
    expect(block.length, "the rendered page must carry an identity block").toBeGreaterThan(0);
    return { html: res.text as string, block, tag };
  }

  it("prints the worklist identity when the card has never been used", async () => {
    const { block, tag } = await preview();
    // The control. Every case below changes one of these values by correction, so
    // this is what proves the next assertions measure a fold, not an empty page.
    expect(shows(block, `Rawname ${tag}`), block).toBe(true);
    expect(shows(block, "40 Y"), block).toBe(true);
    expect(shows(block, "Dr Rawref"), block).toBe(true);
    expect(shows(block, formatReportDateShort("2026-10-16")), block).toBe(true);
  });

  it("prints every correction the card writes, not only STUDY and DOB", async () => {
    const { block, tag } = await preview((t) => ({
      patientName: `Fixedname ${t}`,
      age: "24 Yrs",
      sex: "F",
      uhid: `UH${t}`,
      studyDate: "2026-05-06",
      referringDoctor: `Dr Fixedref ${t}`,
      studyDescription: "MRI BRAIN WITH CONTRAST",
      dateOfBirth: "1978-04-01",
    }));
    expect(shows(block, `Fixedname ${tag}`), "the corrected name").toBe(true);
    expect(shows(block, `Dr Fixedref ${tag}`), "the corrected referring doctor").toBe(true);
    expect(shows(block, `UH${tag}`), "the corrected UHID — the block printed none before").toBe(true);
    expect(shows(block, "24 Yrs"), "the corrected age").toBe(true);
    expect(/24 Yrs\s*\/\s*F/i.test(block), block).toBe(true);
    expect(shows(block, "MRI BRAIN WITH CONTRAST"), "the corrected study description").toBe(true);
    expect(shows(block, formatReportDateShort("2026-05-06")), "the corrected study date").toBe(true);
    // The uncorrected spellings must be GONE: a block carrying both identities is
    // a report about two patients, which is worse than the omission it replaced.
    expect(shows(block, `Rawname ${tag}`), "the worklist name must not survive a correction").toBe(false);
    expect(shows(block, "40 Y"), "the worklist age must not survive").toBe(false);
    expect(shows(block, "Dr Rawref"), "the worklist referrer must not survive").toBe(false);
    expect(shows(block, formatReportDateShort("2026-10-16")), "the worklist date must not survive").toBe(false);
  });

  it("corrects one half of AGE/SEX without erasing the other", async () => {
    // The card holds AGE and SEX in one printed row, so a sex-only correction is
    // the ordinary case. Folding it by rebuilding the row from the envelope alone
    // would print "F" and lose the forty years nobody edited.
    const { block } = await preview(() => ({ sex: "F" }));
    expect(shows(block, "40 Y"), "the uncorrected age stays").toBe(true);
    // The worklist's `40 Y` reaches the page as `40 Yrs` (`formatDocumentedStudyAge`
    // normalises the unit), so the pair is matched on the age's stem.
    expect(/40 Yrs?\s*\/\s*F/i.test(block), block).toBe(true);
    expect(/40 Yrs?\s*\/\s*M/i.test(block), "the worklist sex is replaced, not appended").toBe(false);
  });

  it("a blank correction is not a correction", async () => {
    // Clearing a field on the card leaves an empty string. It must neither print an
    // empty identity row nor delete the value the registration holds.
    const { block, tag } = await preview(() => ({ patientName: "   ", age: "" }));
    expect(shows(block, `Rawname ${tag}`), block).toBe(true);
    expect(shows(block, "40 Y"), block).toBe(true);
  });

  it("keeps the clinical body and the report title beside the corrected identity", async () => {
    // The corrections are presentation-scoped: nothing here may touch what was
    // reported. A fold that rebuilt the model instead of the rows would show up as
    // a lost sentence or a renamed examination.
    const { html, tag } = await preview((t) => ({ patientName: `Fixedname ${t}` }));
    expect(shows(html, `Findings for study ${tag}`)).toBe(true);
    expect(shows(html, "MRI BRAIN PLAIN")).toBe(true);
  });
});
