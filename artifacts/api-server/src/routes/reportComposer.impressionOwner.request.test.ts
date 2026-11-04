/**
 * P0-1 / P1-3 — the radiologist's ownership of the Conclusion survives the REAL
 * persistence path: POST /api/radiology/report-generator/save-draft, the
 * `radiology_report_drafts.structured_json` column, and
 * GET /api/radiology/report-generator/drafts on a real PostgreSQL.
 *
 * WHY THIS IS ASKED OF THE SERVER AND NOT OF THE STORE
 * --------------------------------------------------------------------------------
 * The defect this keys off was measured on a real patient MRI Brain on 2026-11-04:
 * an accepted 149-character AI Conclusion came back from Save + Reopen at 504
 * characters with two dictated Findings sentences appended underneath, and the
 * production row's `updated_at` had moved AFTER the reload — the open itself wrote
 * it. A store-level test can prove the client asks for the ownership to be saved;
 * only the route can prove the answer is still in the database when the study is
 * reopened, because a field the request schema strips never reaches the column and
 * no client-side assertion can see it. `radiologyWorkspaceDraftRoundTrip.test.ts`
 * exists for exactly that reason; this is the same argument for one new key.
 *
 * The key travels inside the observation-ledger envelope (`careObservationLedger`),
 * which the route declares as `observationLedger: z.unknown().optional()` and the
 * column composer stores verbatim — the same reason `impressionBasis` travels there
 * (`lib/impressionBasisPersistence.test.ts`). So this test is also the proof that no
 * migration and no new column were needed: the value below is read out of the
 * existing column, byte-for-byte as the client wrote it.
 *
 * CONTROL DIRECTION: written for the SAFE behaviour — the ownership must be in the
 * stored JSON and must come back on the reload. If the route ever whitelists the
 * ledger keys instead of passing the envelope through, this fails at the column read
 * and the reopened report starts overwriting a Conclusion the radiologist claimed.
 *
 * A second assertion pins the negative: a save whose envelope carries no
 * `impressionOwner` must store none, so a draft written before this field existed
 * (or a Conclusion nobody claimed) is not retroactively owned.
 *
 * Skipped without DATABASE_URL (see testSupport/apiTestApp.ts). Every fixture row is
 * synthetic and marker-scoped, deleted by id in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable,
  portalSessionsTable,
  radiologyReportDraftsTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();
const marker = `impowner-${randomUUID().slice(0, 8)}`;

/** The Conclusion the model produced and the radiologist accepted (trial job 13). */
const ACCEPTED_IMPRESSION = [
  "Generalized cerebral atrophy.",
  "Chronic small vessel ischemic white matter changes - Fazekas grade II.",
].join("\n");

const FINDINGS = [
  "Generalized cerebral volume loss with prominence of cortical sulci, ventricular system and basal cisterns, consistent with age-related cerebral atrophy.",
  "Multiple patchy and early confluent T2/FLAIR hyperintensities in bilateral periventricular and deep cerebral white matter, suggestive of chronic small-vessel ischemic changes - Fazekas grade II.",
  "No diffusion restriction on DWI/ADC to suggest acute infarction.",
  "No intracranial hemorrhage, mass effect or midline shift.",
].join("\n");

describe.skipIf(!dbReady)("impressionOwner — request-level persistence through save-draft", () => {
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
   * The envelope `serializeObservationLedger` writes for a study whose Conclusion the
   * radiologist adopted (or emptied): one accepted-AI ledger row, the per-sentence
   * provenance tagged `ai-draft` — NOT `manual`, which is the whole reason provenance
   * could not protect it — and the field-level `impressionOwner` mark.
   */
  function ledgerEnvelope(opts: { withOwner: boolean }): Record<string, unknown> {
    return {
      kind: "care.observation_ledger.v1",
      version: 1,
      patches: [
        {
          id: "qs-brain-atrophy",
          observation: { concept: "cerebral_atrophy", role: "finding", source: "quick-select" },
          templates: { findings: FINDINGS.split("\n")[0], impression: ACCEPTED_IMPRESSION.split("\n")[0] },
          lastRendered: { findings: FINDINGS.split("\n")[0], impression: ACCEPTED_IMPRESSION.split("\n")[0] },
          replacedBaseline: { findings: [], impression: [] },
          source: "quick-select",
          protected: false,
        },
      ],
      fieldProvenance: {
        impression: {
          "generalized cerebral atrophy": ["ai-draft"],
          "chronic small vessel ischemic white matter changes fazekas grade ii": ["ai-draft"],
        },
      },
      impressionBasis: {
        findingsSignature: `len:${FINDINGS.length}`,
        impressionFingerprint: "generalized cerebral atrophy",
        recordedBy: "findings-write",
      },
      ...(opts.withOwner ? { impressionOwner: "radiologist" } : {}),
    };
  }

  function workspacePayload(opts: { withOwner: boolean }): Record<string, unknown> {
    return {
      studyId: worklistId,
      worklistId,
      patientId,
      modality: "MRI",
      studyName: "MRI Brain",
      clinicalHistory: "Progressive memory difficulty over two years. Synthetic case.",
      technique: "MRI of the brain performed on a 1.5T scanner without contrast.",
      rawFindings: FINDINGS,
      // The accepted wording, as the radiologist left it — the 149-character case.
      impression: ACCEPTED_IMPRESSION.split("\n"),
      recommendation: "",
      observationLedger: ledgerEnvelope(opts),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();

    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Dr. ImpressionOwner ${marker}`,
        email: `${marker}@vitest.invalid`,
        username: marker,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology", "/report-generator", "/reports"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    token = `vitest-${marker}`;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: user.id,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `INT-${marker}`,
        firstName: "Synthetic",
        lastName: `OwnerProbe ${marker}`,
        dateOfBirth: "1958-07-21",
        gender: "F",
        phone: "0000000000",
      })
      .returning();
    patientId = patient.id;

    const suffix = randomUUID().slice(0, 8);
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Synthetic OwnerProbe ${marker}`,
        modality: "MR",
        studyDescription: "MRI Brain",
        studyInstanceUID: `1.2.840.impowner.${marker}.${suffix}`,
        accessionNumber: `ACC-${marker}-${suffix}`,
        patientId,
        studyId: null,
        patientMatchStatus: "MATCHED",
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;
  }, 90_000);

  afterAll(async () => {
    if (worklistId) {
      const drafts = await db
        .select({ id: radiologyReportDraftsTable.id })
        .from(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.studyId, worklistId));
      if (drafts.length) {
        await db
          .delete(radiologyReportDraftsTable)
          .where(inArray(radiologyReportDraftsTable.id, drafts.map((d) => d.id)))
          .catch(() => {});
      }
      await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId)).catch(() => {});
    }
    if (patientId) {
      await db
        .delete(radiologyReportDraftsTable)
        .where(eq(radiologyReportDraftsTable.patientId, patientId))
        .catch(() => {});
      await db.delete(patientsTable).where(eq(patientsTable.id, patientId)).catch(() => {});
    }
    if (userId) {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.subjectId, userId)).catch(() => {});
      await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    }
  }, 90_000);

  it("IO1: the ownership mark is stored in structured_json and handed back by the draft reload", async () => {
    const saved = await saveDraft(workspacePayload({ withOwner: true }));
    expect(saved.status, saved.text).toBe(200);
    const draftId = (saved.body as { draft?: { id?: number } }).draft?.id;
    expect(draftId, "save-draft returned no draft id").toBeTruthy();

    // ── The database value, read from the column the clinic actually stores ───────
    const row = await storedRow();
    const column = row.structuredJson as Record<string, any>;
    const ledger = column?.careObservationLedger;
    expect(ledger, "the observation ledger never reached the stored column").toBeTruthy();
    expect(ledger.kind).toBe("care.observation_ledger.v1");

    console.info(
      `[IO1] stored careObservationLedger keys=${JSON.stringify(Object.keys(ledger))}`
      + ` impressionOwner=${JSON.stringify(ledger.impressionOwner)}`
      + ` impressionBasis=${JSON.stringify(ledger.impressionBasis?.recordedBy ?? null)}`
      + ` draftId=${draftId}`,
    );

    // THE LOAD-BEARING ASSERTION: the field-level ownership is in the row. Provenance
    // alone cannot express it — the stored tags are `ai-draft`, not `manual`, and a
    // deliberately emptied Conclusion stores no tags at all — so a save that lost this
    // key restores a report the silent pass is free to rewrite on reopen.
    expect(
      ledger.impressionOwner,
      `impressionOwner was stripped before the column; ledger keys stored=${JSON.stringify(Object.keys(ledger))}`,
    ).toBe("radiologist");

    // The wording the mark protects is itself byte-for-byte intact in the row.
    expect(String(row.impression)).toContain("Generalized cerebral atrophy.");
    expect(String(row.impression)).toContain("Chronic small vessel ischemic white matter changes");

    // ── The reload leg: GET /drafts?studyId=… hands the same envelope back ────────
    const res = await reload();
    expect(res.status).toBe(200);
    const drafts = res.body.drafts ?? res.body.data ?? [];
    expect(drafts.length).toBeGreaterThan(0);
    const reloadedLedger = (drafts[0].structuredJson as Record<string, any>)?.careObservationLedger;
    console.info(
      `[IO1 reload] GET /drafts?studyId=${worklistId} returned`
      + ` impressionOwner=${JSON.stringify(reloadedLedger?.impressionOwner ?? null)}`,
    );
    expect(
      reloadedLedger?.impressionOwner,
      `the reload returned a ledger without the ownership mark: keys=${JSON.stringify(Object.keys(reloadedLedger ?? {}))}`,
    ).toBe("radiologist");

    // ── Control: a save that claims nothing stores nothing ───────────────────────
    // Without this, the test could not tell "the route persists the key" from "the
    // route writes the key", and every report in the clinic would come back owned —
    // which would silence the derived Impression on studies nobody ever touched.
    const unowned = await saveDraft(workspacePayload({ withOwner: false }));
    expect(unowned.status, unowned.text).toBe(200);
    const unownedColumn = (await storedRow()).structuredJson as Record<string, any>;
    const unownedLedger = unownedColumn?.careObservationLedger;
    console.info(
      `[IO1 control] unowned save stored impressionOwner=${JSON.stringify(unownedLedger?.impressionOwner ?? null)}`
      + ` (absent = the behaviour that shipped)`,
    );
    expect(unownedLedger?.impressionOwner).toBeUndefined();
  }, 90_000);
});
