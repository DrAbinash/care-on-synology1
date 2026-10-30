/**
 * Stage C Phase 6 — the v4 reporting workspace's whole draft payload, saved and
 * read back through the real route on a real Postgres.
 *
 * The workspace's save is not one field, it is eleven: the four narrative boxes,
 * the observation ledger, viewer measurements, canal AP provenance, the spine
 * reporting capture state, the brain vascular acquisition answers, the applied
 * format identity, the linked study, the applied pattern markers, the region
 * transition history and the structured-format values. Every one of them is a
 * thing the radiologist put into the report, so every one of them has to come
 * back on reopen — and a field the route does not declare is a field that is
 * silently dropped before it reaches the database, which no client-side test can
 * see because the client is the one that wrote it.
 *
 * The existing draft tests cannot answer this. `radiology-report-generator.test.ts`
 * runs against a mocked drizzle and asserts on the INSERT call it captured, so a
 * zod schema that strips a key is invisible to it; the A4/A3 cases cover the
 * findings cache, not the workspace envelope. This is the request-level proof:
 * POST what `useDraftPersistence.saveDraft` sends, then read the row and the
 * reload route the same way the browser does.
 *
 * Skip automatically when DATABASE_URL is not exported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  patientsTable,
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const marker = `wsdraft-${randomUUID().slice(0, 8)}`;

describe.skipIf(!dbReady)("v4 workspace draft payload — request-level round trip", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  let patientId = 0;
  let worklistId = 0;

  const saveDraft = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/radiology/report-generator/save-draft")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  /** Exactly what the reload reads: GET /drafts?studyId=… picks the newest row. */
  const reload = () =>
    request(app)
      .get("/api/radiology/report-generator/drafts")
      .query({ studyId: worklistId })
      .set("Authorization", `Bearer ${token}`);

  async function storedRow(): Promise<Record<string, unknown>> {
    const rows = await db
      .select()
      .from(radiologyReportDraftsTable)
      .where(eq(radiologyReportDraftsTable.studyId, worklistId))
      .orderBy(desc(radiologyReportDraftsTable.updatedAt))
      .limit(1);
    return (rows[0] ?? {}) as unknown as Record<string, unknown>;
  }

  /**
   * The payload `useDraftPersistence.saveDraft` builds for one lumbar report: a
   * signed-elsewhere-free study, three Quick Select observations (one box clicked
   * on both sides, so two rows), a hand-typed sentence, the format identity of the
   * standard normal document it started from, and the capture state the spine and
   * brain canvases need to rebuild themselves.
   */
  function workspacePayload(): Record<string, unknown> {
    return {
      studyId: worklistId,
      worklistId,
      patientId,
      clinicalHistory: "Low back pain for 6 months, radicular to the left leg.",
      technique: "MRI of the lumbosacral spine performed on a 1.5T scanner with routine sequences.",
      rawFindings: [
        "Normal lumbar lordosis is maintained.",
        "Grade 1 spondylolisthesis at L4-L5.",
        "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion.",
        "Facet arthropathy at L4-L5, left greater than right.",
      ].join("\n"),
      impression: ["Grade 1 spondylolisthesis at L4-L5 with moderate canal stenosis."],
      recommendation: "Clinical correlation. Surgical referral if neurological deficits develop.",
      observationLedger: {
        kind: "care.observation_ledger.v1",
        version: 1,
        patches: [
          {
            id: "qs-tile-spondylolisthesis",
            observation: { concept: "spondylolisthesis", level: "L4-L5", role: "finding" },
            templates: { findings: "Grade 1 spondylolisthesis at L4-L5.", impression: "Grade 1 spondylolisthesis at L4-L5." },
            lastRendered: { findings: "Grade 1 spondylolisthesis at L4-L5.", impression: "Grade 1 spondylolisthesis at L4-L5." },
            replacedBaseline: { findings: ["No spondylolisthesis is seen."], impression: [] },
            source: "quick-select",
            protected: false,
          },
          {
            id: "qs-tile-foraminal:right",
            observation: { concept: "foraminal_stenosis", level: "L4-L5", laterality: "right", role: "finding" },
            templates: { findings: "Right neural foraminal stenosis at L4-L5.", impression: "" },
            lastRendered: { findings: "Right neural foraminal stenosis at L4-L5.", impression: "" },
            replacedBaseline: { findings: [], impression: [] },
            source: "quick-select",
            protected: false,
          },
          {
            id: "qs-tile-foraminal:left",
            observation: { concept: "foraminal_stenosis", level: "L4-L5", laterality: "left", role: "finding" },
            templates: { findings: "Left neural foraminal stenosis at L4-L5.", impression: "" },
            lastRendered: { findings: "Left neural foraminal stenosis at L4-L5.", impression: "" },
            replacedBaseline: { findings: [], impression: [] },
            source: "quick-select",
            protected: false,
          },
        ],
        fieldProvenance: {
          findings: {
            "grade 1 spondylolisthesis at l4 l5": ["quick-select"],
            "facet arthropathy at l4 l5 left greater than right": ["manual"],
          },
        },
      },
      viewerMeasurements: {
        kind: "care.viewer_measurements.v1",
        version: 1,
        items: [{ id: "m1", observationId: "qs-tile-spondylolisthesis", label: "AP canal", value: 8.2, unit: "mm", level: "L4-L5" }],
      },
      canalApProvenance: {
        "L4-L5": { viewer: true, manual: false, region: "lumbar" },
      },
      spineReporting: {
        lumbarNumbering: { mode: "standard", startingLevel: "L1" },
        sequencesAvailable: ["T1", "T2", "STIR"],
        screening: { lumbar: { selections: [], significance: "normal", recommendationSelected: false } },
        screeningRolesOverridden: true,
        impressionOrderFrozen: true,
      },
      vascularTechnique: { mra: true, mrv: false, manual: { mra: true } },
      reportFormatIdentity: {
        kind: "care.report_format_identity.v1",
        name: "MRI LS Spine — Standard Normal",
        reportTitle: "MRI OF THE LUMBOSACRAL SPINE",
        appliedAt: "2026-10-16T00:00:00.000Z",
        formatId: "fmt-ls-normal",
        formatRevision: "sha256:abc123",
        baselineManifestVersion: 1,
        baselineManifestRevision: "rev-7",
      },
      linkedStudy: null,
      appliedPatterns: [
        { patternId: "canal-stenosis", version: 1, bundleId: "lumbar-degeneration", appliedAt: "2026-10-16T00:00:00.000Z" },
      ],
      regionTransitions: [
        {
          kind: "care.region_transition.v1",
          fromRegion: "whole",
          toRegion: "lumbar",
          retired: ["Whole spine screening limitation."],
          keptAbnormalities: ["Grade 1 spondylolisthesis at L4-L5."],
          manualLinesPreserved: 1,
          decidedBy: "Dr Abinash",
          at: "2026-10-16T00:00:00.000Z",
        },
      ],
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Workspace Draft ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/report-generator"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token: `vitest-wsd-${marker}`,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    token = `vitest-wsd-${marker}`;

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `WSD-${marker}`,
        firstName: "Synthetic",
        lastName: "RoundTrip",
        dateOfBirth: "1965-04-04",
        gender: "M",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const suffix = randomUUID().slice(0, 8);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "Synthetic RoundTrip",
        modality: "MR",
        studyDescription: "MRI LS Spine",
        studyInstanceUID: `1.2.840.wsd.${suffix}`,
        accessionNumber: `ACC-${marker}-${suffix}`,
        patientId,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;
  });

  afterAll(async () => {
    if (worklistId) {
      const drafts = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.studyId, worklistId));
      if (drafts.length) {
        await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, drafts.map((d) => d.id)));
      }
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    }
    if (patientId) await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("R1. one save stores every narrative box byte-for-byte", async () => {
    const sent = workspacePayload();
    const res = await saveDraft(sent);
    expect(res.status, JSON.stringify(res.body ?? {})).toBe(200);

    const row = await storedRow();
    expect(String(row.rawFindings)).toBe(String(sent.rawFindings));
    expect(String(row.clinicalHistory)).toBe(String(sent.clinicalHistory));
    expect(String(row.recommendation)).toBe(String(sent.recommendation));
    // `radiology_report_drafts` has no technique column: save-draft composes the
    // Technique into the findings_sections JSON, and `draftTechniqueRoundTrip.ts`
    // is the reader that puts it back. Asserted here so the workspace reload cannot
    // lose it silently.
    const sections = JSON.parse(String(row.findingsSections ?? "{}")) as Record<string, string>;
    expect(sections.Technique).toBe(String(sent.technique));
    expect(String(row.impression)).toContain("Grade 1 spondylolisthesis at L4-L5 with moderate canal stenosis.");
  });

  it("R2. the observation ledger survives with both sided rows and its provenance", async () => {
    await saveDraft(workspacePayload());
    const row = await storedRow();
    const column = row.structuredJson as Record<string, any>;
    const ledger = column?.careObservationLedger;

    expect(ledger?.kind).toBe("care.observation_ledger.v1");
    const ids = (ledger?.patches ?? []).map((p: any) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["qs-tile-spondylolisthesis", "qs-tile-foraminal:right", "qs-tile-foraminal:left"]),
    );
    const sided = ids.filter((id: string) => id.startsWith("qs-tile-foraminal:"));
    expect(sided).toHaveLength(2);
    expect(ledger.patches.find((p: any) => p.id === "qs-tile-spondylolisthesis").replacedBaseline.findings)
      .toEqual(["No spondylolisthesis is seen."]);
    expect(ledger.fieldProvenance.findings["facet arthropathy at l4 l5 left greater than right"]).toEqual(["manual"]);
  });

  it("R3. the applied format identity survives, so reopen does not re-bootstrap the baseline", async () => {
    await saveDraft(workspacePayload());
    const column = (await storedRow()).structuredJson as Record<string, any>;
    const identity = column?.careReportFormatIdentity;
    expect(identity?.name).toBe("MRI LS Spine — Standard Normal");
    expect(identity?.reportTitle).toBe("MRI OF THE LUMBOSACRAL SPINE");
    expect(identity?.baselineManifestRevision).toBe("rev-7");
  });

  it("R4. measurements, canal provenance, vascular answers, patterns and transitions all land", async () => {
    await saveDraft(workspacePayload());
    const column = (await storedRow()).structuredJson as Record<string, any>;
    expect(column.careViewerMeasurements.items[0].value).toBe(8.2);
    expect(column.careCanalApProvenance["L4-L5"]).toMatchObject({ viewer: true });
    expect(column.careVascularTechnique).toMatchObject({ mra: true, mrv: false });
    expect(column.careAppliedPatterns).toEqual([
      { patternId: "canal-stenosis", version: 1, bundleId: "lumbar-degeneration", appliedAt: "2026-10-16T00:00:00.000Z" },
    ]);
    expect(Array.isArray(column.careRegionTransitions)).toBe(true);
    expect(column.careRegionTransitions.length).toBe(1);
  });

  it("R5. the reload route hands back the same envelope the save wrote", async () => {
    await saveDraft(workspacePayload());
    const res = await reload();
    expect(res.status).toBe(200);
    const drafts = res.body.drafts ?? res.body.data ?? [];
    expect(drafts.length).toBeGreaterThan(0);
    const column = drafts[0].structuredJson as Record<string, any>;
    expect(column.careObservationLedger.patches).toHaveLength(3);
    expect(column.careReportFormatIdentity.name).toBe("MRI LS Spine — Standard Normal");
    expect(String(drafts[0].rawFindings ?? drafts[0].findings)).toContain("Grade 1 spondylolisthesis at L4-L5.");
  });

  it("R6. the spine reporting capture state survives — numbering, sequences, screening and a frozen Impression order", async () => {
    // `impressionOrderFrozen` is the radiologist's own arrangement of the
    // Impression. Spec §37: once it is hand-ordered, the priority sorter must stop
    // touching the report. If this state does not survive the save, a reopen lets
    // the engine re-shuffle lines the radiologist deliberately arranged — the
    // system altering clinical text the author wrote, which is the one thing the
    // workspace may not do.
    await saveDraft(workspacePayload());
    const column = (await storedRow()).structuredJson as Record<string, any>;
    const spine = column?.spineReporting;
    expect(spine, "spineReporting was sent by every save and never reached the stored column").toBeTruthy();
    expect(spine?.impressionOrderFrozen).toBe(true);
    expect(spine?.lumbarNumbering).toMatchObject({ mode: "standard" });
    expect(spine?.sequencesAvailable).toEqual(["T1", "T2", "STIR"]);
    // Whose roles these are travels with the roles. The workspace re-derives the
    // billing proposal every time the study opens, so a reopen that loses this flag
    // hands the regions back to billing and undoes a role chosen at the scanner.
    expect(spine?.screeningRolesOverridden).toBe(true);
  });

  it("R7. a save that carries no spine state keeps the stored one instead of clearing it", async () => {
    const first = await saveDraft(workspacePayload());
    expect(first.status, JSON.stringify(first.body ?? {})).toBe(200);
    const draftId = (first.body as { draft?: { id?: number } }).draft?.id;
    expect(draftId, "the save response must carry the draft id the client reuses").toBeTruthy();

    // Exactly what the workspace does on its next autosave: the same draft row,
    // the same envelope keys except the one under test.
    const second = workspacePayload();
    delete second.spineReporting;
    second.id = draftId;
    second.rawFindings = `${String(second.rawFindings)}\nRepeat visit, symptoms worse.`;
    await saveDraft(second);

    const rowAfter = await storedRow();
    expect(Number(rowAfter.id), "saving with an id must update the row, not fork a second draft")
      .toBe(draftId);

    const column = rowAfter.structuredJson as Record<string, any>;
    expect(column.careObservationLedger.patches).toHaveLength(3);
    expect(column?.spineReporting?.impressionOrderFrozen).toBe(true);
    expect(String(rowAfter.rawFindings)).toContain("Repeat visit, symptoms worse.");
  });
});
