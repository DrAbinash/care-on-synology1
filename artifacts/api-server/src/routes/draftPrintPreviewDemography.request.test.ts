/**
 * Item 7 — a Demography-card correction must print on the draft preview.
 *
 * What the audit measured on `main` (2026-11-13), all of it in one route,
 * `GET /api/radiology/report-generator/drafts/:id/print-preview`:
 *
 *   • the card has EIGHT editable fields, and the route folded TWO of them
 *     (STUDY, DOB) from the draft's envelope;
 *   • the other six — patient name, age, sex, UHID, study date, referring
 *     doctor — were printed straight from the live `radiology_worklist` row;
 *   • the signing event folds all eight (`patient-reports.ts` calls
 *     `applyDemographyOverridesToIdentity` inside the sign transaction).
 *
 * So a radiologist who corrected the name, the age or the referrer on the card
 * approved a preview that showed the OLD values, signed it, and the document the
 * patient received showed the NEW ones. The two surfaces disagreed about who the
 * patient was, and the preview was the surface he read.
 *
 * These tests drive the real route over a real Postgres and read the printed
 * identity cells, not the source text. Every patient name, UHID and accession
 * here is synthetic and carries this run's random marker, so nothing in a
 * rendered document traces to a clinic row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { applyDemographyOverridesToIdentity } from "../lib/reportStudyIdentity";
import {
  CARE_DEMOGRAPHY_OVERRIDES_KIND,
  DEMOGRAPHY_OVERRIDE_FIELDS,
  type CareDemographyOverrides,
} from "../lib/structuredJsonColumn";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

/** The worklist row every scenario starts from. These are the values the
 *  preview used to print no matter what the radiologist corrected. */
const LIVE = {
  patientName: "Vitest Live",
  age: "41 Y",
  sex: "M",
  studyDate: "2026-10-16",
  referringDoctor: "Dr Live",
  studyDescription: "MRI BRAIN",
  modality: "MR",
};

/**
 * The printed identity cells, read from the letter-pad demographics table
 * (`reportPresentation.letterpadPatientBlockHtml`): one `<td>` per cell, the
 * label in a `<strong>`, the value after it — and for NAME the value is itself
 * bold. Reading cells rather than the whole page is deliberate: `html.toContain
 * ("…")` over a rendered report is satisfied by the footer, the watermark, the
 * clinical body or the report heading, none of which is the identity row under
 * test.
 */
function identityCells(html: string): Record<string, string> {
  const table = /<table class="letterpad-demo">([\s\S]*?)<\/table>/.exec(html)?.[1] ?? "";
  const cells: Record<string, string> = {};
  for (const m of table.matchAll(/<strong>([A-Z][A-Z./ ]*):<\/strong>(?:\s*<strong>)?([^<]*)/g)) {
    const label = m[1].trim();
    const value = m[2].trim();
    if (value && !cells[label]) cells[label] = value;
  }
  return cells;
}

/** The printed report heading — the BILLED examination, which no demography
 *  correction rewrites. Both template shapes draw it in `.study-title-bar`. */
function reportHeading(html: string): string {
  return (/<div class="study-title-bar">([^<]*)</i.exec(html)?.[1] ?? "").trim();
}

/** Does this cell print this token? Case-insensitive, because the route
 *  reformats the referrer's display form before printing it. */
function printsToken(cell: string | undefined, token: string): boolean {
  return (cell ?? "").toLowerCase().includes(token.toLowerCase());
}

describe.skipIf(!dbReady)("demography corrections on the draft print preview — request level", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const worklistIds: number[] = [];
  const draftIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const marker = `demog-${randomUUID().slice(0, 8)}`;
    token = `demog-token-${randomUUID()}`;
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
   * One study exactly as the product leaves it: a worklist row carrying the live
   * registration values, and a draft whose `structured_json` carries the card's
   * corrections in the envelope the workspace writes. No patient-master row is
   * created, so UHID and DOB have no live source — which is what makes "the
   * correction supplied the row" distinguishable from "it was there anyway".
   */
  async function render(
    build?: (tag: string) => Record<string, string>,
  ): Promise<{ html: string; cells: Record<string, string>; tag: string; live: Record<string, string> }> {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const live = {
      ...LIVE,
      patientName: `${LIVE.patientName} ${tag}`,
      referringDoctor: `${LIVE.referringDoctor} ${tag}`,
    };
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: live.patientName,
        age: live.age,
        sex: live.sex,
        modality: live.modality,
        studyDescription: live.studyDescription,
        studyDate: live.studyDate,
        accessionNumber: `ACC-${tag}`,
        referringDoctor: live.referringDoctor,
        patientMatchStatus: "MATCHED",
        matchScore: "GREEN",
        matchDecision: "PENDING",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistIds.push(wl.id);

    const overrides = build ? build(tag) : undefined;
    const envelope = overrides
      ? {
          careDemographyOverrides: {
            kind: CARE_DEMOGRAPHY_OVERRIDES_KIND,
            ...overrides,
          },
        }
      : undefined;

    const [draft] = await db
      .insert(radiologyReportDraftsTable)
      .values({
        status: "DRAFT",
        worklistId: wl.id,
        studyId: wl.id,
        patientId: null,
        modality: live.modality,
        studyName: live.studyDescription,
        rawFindings: "Vitest findings.",
        impression: "[]",
        ...(envelope === undefined ? {} : { structuredJson: envelope }),
      })
      .returning();
    draftIds.push(draft.id);

    const res = await request(app)
      .get(`/api/radiology/report-generator/drafts/${draft.id}/print-preview`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, "print-preview must render").toBe(200);
    const cells = identityCells(res.text);
    // A reader that found nothing makes every `cells.X` assertion pass vacuously,
    // so the block itself is asserted before any cell is.
    expect(Object.keys(cells).length, "the identity block must render cells").toBeGreaterThan(1);
    return { html: res.text, cells, tag, live };
  }

  // ── 1. The six fields the route used to print from live rows ───────────────
  describe("1. a correction reaches the cell the radiologist approved", () => {
    it("names the corrected patient, not the registration name", async () => {
      const { cells, live, tag } = await render((t) => ({ patientName: `Vitest Corrected ${t}` }));
      expect(cells.NAME).toBe(`Vitest Corrected ${tag}`);
      expect(cells.NAME).not.toBe(live.patientName);
    });

    it("prints the corrected age beside the corrected sex", async () => {
      const { cells } = await render(() => ({ age: "9 Yrs", sex: "F" }));
      expect(cells["AGE/SEX"]).toBe("9 Yrs / F");
    });

    it("supplies a UHID the study never had", async () => {
      const { cells, tag } = await render((t) => ({ uhid: `UH-${t}` }));
      expect(cells.UHID).toBe(`UH-${tag}`);
    });

    it("prints the corrected examination date in the clinic's own date form", async () => {
      const { cells } = await render(() => ({ studyDate: "2026-10-17" }));
      expect(cells.DATE).toBe("17/10/2026");
    });

    it("names the corrected referring doctor", async () => {
      const { cells, tag } = await render((t) => ({ referringDoctor: `Dr Corrected ${t}` }));
      expect(cells["REFD. BY"]).toContain(`Dr Corrected ${tag}`);
    });

    it("folds all eight fields at once", async () => {
      const { cells, tag } = await render((t) => ({
        patientName: `All Eight ${t}`,
        age: "52 Yrs",
        sex: "F",
        uhid: `UH-${t}`,
        studyDate: "2026-10-17",
        referringDoctor: `Dr Eight ${t}`,
        studyDescription: "MRI BRAIN WITH CONTRAST",
        dateOfBirth: "1974-03-02",
      }));
      expect(cells.NAME).toBe(`All Eight ${tag}`);
      expect(cells["AGE/SEX"]).toBe("52 Yrs / F");
      expect(cells.UHID).toBe(`UH-${tag}`);
      expect(cells.DATE).toBe("17/10/2026");
      expect(cells["REFD. BY"]).toContain(`Dr Eight ${tag}`);
      expect(cells.STUDY).toBe("MRI BRAIN WITH CONTRAST");
      expect(cells.DOB).toBe("02/03/1974");
    });
  });

  // ── 2. The live values must not survive the correction ─────────────────────
  describe("2. the value he corrected does not stay on the page", () => {
    it("drops the registration name, age and referrer", async () => {
      const { html, cells, tag, live } = await render((t) => ({
        patientName: `Replaced ${t}`,
        age: "33 Yrs",
        sex: "F",
        referringDoctor: "Dr Replaced",
      }));
      expect(cells.NAME).toBe(`Replaced ${tag}`);
      expect(cells["AGE/SEX"]).toBe("33 Yrs / F");
      expect(cells["REFD. BY"]).toContain("Dr Replaced");
      // Asserted on the CELLS, not the page: `reconcileAccessionVsReferringDoctor`
      // rewrites the referrer's display form (its DICOM component separator and
      // title-casing), so the live tag prints in a different case than this run
      // generated it. Comparing case-insensitively is the honest form; a
      // case-sensitive sweep would pass whether or not the fold ran.
      expect(printsToken(cells["REFD. BY"], tag)).toBe(false);
      expect(printsToken(cells["AGE/SEX"], "41 Yrs")).toBe(false);
      expect(printsToken(cells["AGE/SEX"], "33 Yrs")).toBe(true);
      expect(html).not.toContain(live.patientName);
      expect(reportHeading(html)).toBe("MRI BRAIN");
    });

    it("does not print the booked date beside a corrected one", async () => {
      const { cells } = await render(() => ({ studyDate: "2026-10-17" }));
      expect(cells.DATE).toBe("17/10/2026");
      expect(cells.DATE).not.toContain("16/10/2026");
    });
  });

  // ── 3. Controls: what must not change ──────────────────────────────────────
  describe("3. controls — no correction, no change", () => {
    it("a draft with no envelope prints the live registration values", async () => {
      const { cells } = await render();
      // The worklist's documented "41 Y" is rendered by the route's own age
      // formatter as "41 Yrs" — unchanged by this fix, pinned so it stays so.
      expect(cells["AGE/SEX"]).toBe("41 Yrs / M");
      expect(cells.DATE).toBe("16/10/2026");
      expect(cells.NAME).toContain(LIVE.patientName);
      expect(cells["REFD. BY"]).toContain("Dr");
      expect(cells.STUDY).toBe("MRI BRAIN");
      expect(cells.DOB).toBeUndefined();
      expect(cells.UHID).toBeUndefined();
    });

    it("a draft whose envelope carries only blanks prints exactly the same cells", async () => {
      // `sanitizeCareDemographyOverrides` stores nothing for an all-blank card,
      // so the fold receives null and must hand the live identity back.
      const { cells } = await render(() => ({ patientName: "   ", age: "", sex: "  " }));
      expect(cells["AGE/SEX"]).toBe("41 Yrs / M");
      expect(cells.NAME).toContain(LIVE.patientName);
      expect(cells.DATE).toBe("16/10/2026");
    });

    it("a correction of one field leaves the other six live", async () => {
      const { cells, tag, live } = await render(() => ({ age: "9 Yrs" }));
      expect(cells["AGE/SEX"]).toBe("9 Yrs / M");
      expect(cells.DATE).toBe("16/10/2026");
      expect(cells.NAME).toBe(live.patientName);
      expect(printsToken(cells["REFD. BY"], tag)).toBe(true);
      expect(cells.STUDY).toBe("MRI BRAIN");
      expect(cells.UHID).toBeUndefined();
    });

    it("trims the correction rather than printing the padding", async () => {
      const { cells, tag } = await render((t) => ({ patientName: `  Spaced ${t}  ` }));
      expect(cells.NAME).toBe(`Spaced ${tag}`);
    });

    it("prints a study date the system cannot read as the radiologist wrote it", async () => {
      // Never silently back to the booked day: a correction the parser refuses
      // still has to appear, or the page claims the examination happened on a
      // date he explicitly replaced.
      const { cells } = await render(() => ({ studyDate: "Oct-2026-review" }));
      expect(cells.DATE).toBe("Oct-2026-review");
    });

    it("prints an age correction verbatim, the way the signed document prints it", async () => {
      // The signing fold stores the typed string with no re-normalisation
      // (`identity.ageAtExamination` is printed as-is), so the preview may not
      // apply a plausibility refusal the signed sheet does not apply.
      const { cells } = await render(() => ({ age: "unknown at registration" }));
      expect(cells["AGE/SEX"]).toBe(`unknown at registration / ${LIVE.sex}`);
    });

    it("keeps the booked examination as the page heading when the description is corrected", async () => {
      // The fold moves the examination name into the letterpad STUDY row, not into
      // the title bar. The signed document is the same way — `patient_reports.title`
      // comes from the booked test (`${test.name} — Report`), never from the
      // correction — so a corrected description must not retitle the page either.
      const { html, cells } = await render(() => ({ studyDescription: "MRI BRAIN WITH CONTRAST" }));
      expect(cells.STUDY).toBe("MRI BRAIN WITH CONTRAST");
      expect(reportHeading(html)).toBe("MRI BRAIN");
    });
  });

  // ── 4. One rule, not two ───────────────────────────────────────────────────
  describe("4. the preview prints what the signing event would freeze", () => {
    it("the folded identity and the rendered cells agree for every field the card edits", async () => {
      const { cells, tag, live } = await render((t) => ({
        patientName: `Agree ${t}`,
        age: "44 Yrs",
        sex: "F",
        uhid: `UH-${t}`,
        studyDate: "2026-10-17",
        referringDoctor: "Dr Agree",
        studyDescription: "MRI BRAIN WITH CONTRAST",
        dateOfBirth: "1982-05-09",
      }));
      const overrides = {
        kind: CARE_DEMOGRAPHY_OVERRIDES_KIND,
        patientName: `Agree ${tag}`,
        age: "44 Yrs",
        sex: "F",
        uhid: `UH-${tag}`,
        studyDate: "2026-10-17",
        referringDoctor: "Dr Agree",
        studyDescription: "MRI BRAIN WITH CONTRAST",
        dateOfBirth: "1982-05-09",
      } as CareDemographyOverrides;
      // The same helper the sign transaction calls, over the same live values.
      const frozen = applyDemographyOverridesToIdentity(
        {
          capturedAt: "2026-11-13T00:00:00.000Z",
          patientName: live.patientName,
          uhid: "",
          sex: live.sex,
          ageAtExamination: live.age,
          dateOfBirth: null,
          study: {
            accessionNumber: "",
            studyDate: live.studyDate,
            modality: live.modality,
            studyDescription: live.studyDescription,
            referringDoctor: live.referringDoctor,
            studyInstanceUid: "",
            documentedAge: live.age,
            sex: live.sex,
          },
        },
        overrides,
      );
      expect(cells.NAME).toBe(frozen.patientName);
      expect(cells["AGE/SEX"]).toBe(`${frozen.ageAtExamination} / ${frozen.sex}`);
      expect(cells.UHID).toBe(frozen.uhid);
      // `startsWith`, not equality: this route enriches the referrer with the
      // degree from the doctors master, and another suite's doctor row could
      // match. The fold's own output is what is pinned.
      expect(cells["REFD. BY"].startsWith(frozen.study.referringDoctor)).toBe(true);
      expect(cells.STUDY).toBe(frozen.study.studyDescription);
      expect(cells.DATE).toBe("17/10/2026");
      expect(cells.DOB).toBe("09/05/1982");
      expect(DEMOGRAPHY_OVERRIDE_FIELDS).toHaveLength(8);
    });
  });
});

// ── 5. The contract pins — these run without a database too ──────────────────
describe("the preview route folds with the signing helper, not a second rule", () => {
  const route = readFileSync(new URL("./radiology-report-generator.ts", import.meta.url), "utf8");
  const at = route.indexOf('"/drafts/:id/print-preview"');
  // The handler runs to several hundred lines, so the block is cut at the NEXT
  // route registration rather than an arbitrary length — and the cut is asserted,
  // because an empty slice makes every `toContain` below pass vacuously.
  const next = route.indexOf("radiologyReportGeneratorRouter.", at + 10);
  const block = at < 0 ? "" : route.slice(at, next > at ? next : at + 40000);

  it("the block the pins below read is the print-preview handler, not an empty slice", () => {
    expect(at).toBeGreaterThan(-1);
    expect(block.length).toBeGreaterThan(8000);
    expect(block).toContain("const model: ReportDocumentModel");
    expect(block).toContain("patientRows: ([");
  });

  it("folds the identity through the shared helper", () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toContain("applyDemographyOverridesToIdentity(");
    expect(block).toContain("demographyOverrides,");
  });

  it("holds no hand-rolled precedence for the six fields it used to print live", () => {
    for (const field of ["patientName", "age", "sex", "uhid", "studyDate", "referringDoctor"]) {
      expect(block, `demographyOverrides?.${field} must not be re-implemented`).not.toContain(
        `demographyOverrides?.${field}?.`,
      );
    }
  });

  it("folds BEFORE the degree enrichment, so a corrected referrer is treated like a live one", () => {
    const fold = block.indexOf("applyDemographyOverridesToIdentity(");
    const enrich = block.indexOf("enrichReferringDoctorWithDegree(");
    expect(fold).toBeGreaterThan(-1);
    expect(enrich).toBeGreaterThan(fold);
    expect(block.slice(enrich, enrich + 200)).toContain("previewIdentity.study.referringDoctor");
  });

  it("keeps the booked examination as the heading: the title never reads the correction", () => {
    const title = block.slice(block.indexOf("const studyTitle"), block.indexOf("const reportingScopeNote"));
    expect(title.length).toBeGreaterThan(20);
    expect(title).not.toContain("demographyOverrides");
  });
});
