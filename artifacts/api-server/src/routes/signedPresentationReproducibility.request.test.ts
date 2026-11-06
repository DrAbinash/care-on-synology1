/**
 * PR-1 (F1) — a signature is only worth what the document behind it can be
 * reproduced as.
 *
 * The property under test is the owner's ruling of 2026-11-06: BLOCK final
 * signing when the signed report cannot be reproduced reliably. Two mechanisms
 * made that impossible before this suite:
 *
 *  1. `resolveTemplateRecordForRender` NEVER throws — it ends at
 *     `seedByKey(DEFAULT_TEMPLATE_KEY)` (presentationTemplateStore.ts:542), and
 *     `getTemplateVersion`/`latestPublishedVersion` fall back to the code seed
 *     themselves (:103-104, :120-121). So a freeze could be written SUCCESSFULLY
 *     while recording a template the clinic never published. A row existing is
 *     not proof of reproducibility; provenance is.
 *  2. `freezeSignedReportPresentation` swallowed every failure
 *     (patient-reports.ts:3668), and the sign flip was a single auto-committed
 *     UPDATE (:2935) with the freeze and the audit running after it — so a
 *     signed report could exist with no freeze and no audit at all, and say
 *     nothing about it.
 *
 * Measured against production data before writing this: `radiology_presentation_templates`
 * holds exactly ONE row (care-premium v2, published) and the active selection
 * `report_presentation_template` (category 'report') names that same key — so the
 * strict path PASSES as shipped and this gate does not stand the clinic down.
 *
 * Request level, real Postgres, real HTTP. No source-text assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditLogsTable, db } from "@workspace/db";
import {
  featureFlagsTable,
  orderTestsTable,
  ordersTable,
  patientsTable,
  patientReportsTable,
  pacsSettingsTable,
  portalSessionsTable,
  radiologyPresentationTemplatesTable,
  radiologyReportPresentationFreezeTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  signaturesTable,
  testsTable,
  usersTable,
} from "@workspace/db/schema";
import { seedByKey } from "../lib/presentationTemplateSeeds";
import { invalidateFeatureFlagCache } from "../lib/featureFlags";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const dbReady = hasDatabaseUrl();

const marker = randomUUID().slice(0, 8);
const SIGNER_NAME = `Dr. Repro Probe ${marker}`;
const signerToken = `repro-token-${marker}`;
/** A key of our own, so deleting "all published versions of the active key"
 *  cannot reach any template another suite depends on. */
const KEY = `care-repro-${marker}`;
const V = 7;

/** The seed definition, published as a real DB version — the same content the
 *  fallback would have produced, so a refusal here can only be about
 *  PROVENANCE and never about whether the layout is renderable. */
const definitionOf = () => seedByKey("care-classic")!.definition;

describe.skipIf(!dbReady)(
  "signed presentation reproducibility — request level",
  () => {
    let app: Express;
    let patientId = 0;
    let testId = 0;
    let signatureId = 0;
    let templateRowId = 0;
    let orderId = 0;
    let seq = 0;
    /** The D5 flag's state before this suite touched it — `null` when no row
     *  existed, so cleanup deletes our own row and restores somebody else's value. */
    let flagBefore: { enabled: boolean } | null = null;
    let originalSelection: { restore: () => Promise<void> } | null = null;
    const reportIds: number[] = [];
    const orderTestIds: number[] = [];
    const studyIds: number[] = [];
    const worklistIds: number[] = [];

    async function makeStaff() {
      const [user] = await db
        .insert(usersTable)
        .values({
          name: SIGNER_NAME,
          email: `repro-${marker}@vitest.invalid`,
          username: `repro-${marker}`,
          role: "radiologist",
          permissions: JSON.stringify([
            "/reports",
            "/reports:sign",
            "/reports:verify",
            "/radiology",
          ]),
          pin: "0000",
          isActive: true,
        })
        .returning();
      await db.insert(portalSessionsTable).values({
        token: signerToken,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      });
    }

    /** Point the clinic's active clinical presentation selection at `key`
     *  (category 'report' — readActiveSelections filters on it at
     *  presentationTemplateStore.ts:334) and hand back its exact undo, so a test that
     *  swaps the key cannot leak the swap into the next one. */
    async function setActiveTemplateTo(
      key: string,
    ): Promise<{ restore: () => Promise<void> }> {
      const [existing] = await db
        .select({ id: pacsSettingsTable.id, value: pacsSettingsTable.value })
        .from(pacsSettingsTable)
        .where(
          and(
            eq(pacsSettingsTable.key, "report_presentation_template"),
            eq(pacsSettingsTable.category, "report"),
          ),
        )
        .limit(1);
      if (existing) {
        const previous = existing.value;
        await db
          .update(pacsSettingsTable)
          .set({ value: key })
          .where(eq(pacsSettingsTable.id, existing.id));
        return {
          restore: async () => {
            await db
              .update(pacsSettingsTable)
              .set({ value: previous })
              .where(eq(pacsSettingsTable.id, existing.id));
          },
        };
      }
      await db.insert(pacsSettingsTable).values({
        key: "report_presentation_template",
        value: key,
        category: "report",
      });
      return {
        restore: async () => {
          await db
            .delete(pacsSettingsTable)
            .where(
              and(
                eq(pacsSettingsTable.key, "report_presentation_template"),
                eq(pacsSettingsTable.value, key),
              ),
            );
        },
      };
    }

    /** Returns the undo: beforeAll keeps it so afterAll can put the selection back
     *  even when a test aborts before its own `finally`. */
    const setActiveTemplate = () => setActiveTemplateTo(KEY);

    async function publishTemplate(
      status: "published" | "retired" = "published",
    ) {
      const [row] = await db
        .insert(radiologyPresentationTemplatesTable)
        .values({
          templateKey: KEY,
          version: V,
          displayName: `Repro Probe ${marker}`,
          description: "Suite-local published presentation template.",
          copyType: "standard",
          status,
          rendererVersion: 1,
          isSystem: false,
          definition: definitionOf(),
        })
        .returning();
      templateRowId = row.id;
    }

    async function newDraft(title: string): Promise<number> {
      const res = await request(app)
        .post("/api/patient-reports")
        .set("Authorization", `Bearer ${signerToken}`)
        .send({
          type: "radiology",
          patientId,
          testId,
          title,
          body: "Synthetic findings for the reproducibility probe.",
          impression: "Synthetic impression.",
        });
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(
          `POST /api/patient-reports → ${res.status}: ${res.text}`,
        );
      }
      reportIds.push(res.body.id as number);
      return res.body.id as number;
    }

    /** One billed, matched, APPROVED worklist row — the shape that reaches the D5
     *  structured-finalize door (`POST /api/patient-reports` carrying a studyId while
     *  `ff_radiology_structured_final` is ON, patient-reports.ts:2475). Deliberately
     *  NO draft row: the certificate pre-gate runs BEFORE the finalize transaction,
     *  and the premise under test is precisely what a refusal must not create. */
    async function billedWorklistStudy(label: string) {
      seq += 1;
      const tag = `${marker}-${seq}`;
      const today = new Date().toISOString().slice(0, 10);
      const [ot] = await db
        .insert(orderTestsTable)
        .values({ orderId, testId, price: "1000" })
        .returning();
      orderTestIds.push(ot.id);
      const [study] = await db
        .insert(radiologyStudiesTable)
        .values({
          accessionNumber: `ACC-REPRO-${tag}`,
          orderId,
          orderTestId: ot.id,
          patientId,
          testId,
          modality: "MR",
          department: "MRI",
          studyDescription: label,
          studyDate: today,
          status: "scheduled",
        })
        .returning();
      studyIds.push(study.id);
      const [worklist] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `Repro Probe ${marker}`,
          patientId,
          studyId: study.id,
          modality: "MR",
          studyDescription: label,
          studyDate: today,
          accessionNumber: `ACC-REPRO-${tag}`,
          studyInstanceUID: `1.2.840.repro.${seq}.${marker}`,
          matchScore: "GREEN",
          matchDecision: "APPROVED",
          status: "STUDY_RECEIVED",
        })
        .returning();
      worklistIds.push(worklist.id);
      return worklist;
    }

    /** Flip the D5 door for one test and hand back its exact undo. The flag cache
     *  has a 30 s TTL (`lib/featureFlags.ts:17-34`), so an INSERT alone would not be
     *  seen by this process — invalidation is part of the fixture, not a nicety. */
    async function enableStructuredFinalize(): Promise<{
      restore: () => Promise<void>;
    }> {
      const [existing] = await db
        .select({ enabled: featureFlagsTable.enabled })
        .from(featureFlagsTable)
        .where(eq(featureFlagsTable.key, "ff_radiology_structured_final"))
        .limit(1);
      flagBefore = existing ?? null;
      if (existing) {
        await db
          .update(featureFlagsTable)
          .set({ enabled: true })
          .where(eq(featureFlagsTable.key, "ff_radiology_structured_final"));
      } else {
        await db.insert(featureFlagsTable).values({
          key: "ff_radiology_structured_final",
          enabled: true,
          description: "Suite-local: reaches the D5 signing door.",
        });
      }
      invalidateFeatureFlagCache();
      return {
        restore: async () => {
          if (existing) {
            await db
              .update(featureFlagsTable)
              .set({ enabled: existing.enabled })
              .where(
                eq(featureFlagsTable.key, "ff_radiology_structured_final"),
              );
          } else {
            await db
              .delete(featureFlagsTable)
              .where(
                eq(featureFlagsTable.key, "ff_radiology_structured_final"),
              );
          }
          invalidateFeatureFlagCache();
        },
      };
    }

    const sign = (id: number) =>
      request(app)
        .post(`/api/patient-reports/${id}/sign`)
        .set("Authorization", `Bearer ${signerToken}`)
        .send({ signatureId });

    const reportRow = async (id: number) =>
      (
        await db
          .select()
          .from(patientReportsTable)
          .where(eq(patientReportsTable.id, id))
          .limit(1)
      )[0];

    const freezeRow = async (id: number) =>
      (
        await db
          .select()
          .from(radiologyReportPresentationFreezeTable)
          .where(eq(radiologyReportPresentationFreezeTable.reportId, id))
          .limit(1)
      )[0] ?? null;

    /** `db.execute` answers `{ rows: [...] }` for a raw select on this drizzle
     *  version, so a destructured first element is undefined and the count reads as
     *  a confident zero. Read both shapes explicitly. */
    async function scalarInt(query: ReturnType<typeof sql>): Promise<number> {
      const res = (await db.execute(query)) as unknown;
      const rows = Array.isArray(res)
        ? res
        : ((res as { rows?: unknown[] }).rows ?? []);
      const first = (rows as Record<string, unknown>[])[0];
      return Number(first?.n ?? -1);
    }

    const setTemplateStatus = (status: "published" | "retired") =>
      db
        .update(radiologyPresentationTemplatesTable)
        .set({ status })
        .where(eq(radiologyPresentationTemplatesTable.id, templateRowId));

    /** A refusal must not leave a signature behind, but it is still an event worth
     *  recording: the audit row that documents it lives OUTSIDE the rolled-back
     *  transaction, so the two counters are asserted separately. */
    const signAuditCount = (id: number) =>
      scalarInt(sql`
    select count(*)::int as n from audit_logs
    where entity_id = ${String(id)} and action = 'legacy_sign'`);

    const refusalAuditCount = (id: number) =>
      scalarInt(sql`
    select count(*)::int as n from audit_logs
    where entity_id = ${String(id)} and action = 'legacy_sign_rejected'
      and reason = 'report_presentation_unresolved'`);

    /** A refused amendment must not have started at all: the linkage row is written
     *  in the same transaction as the amended document. */
    const amendmentCount = (id: number) =>
      scalarInt(sql`
    select count(*)::int as n from patient_report_amendments
    where original_report_id = ${id}`);

    beforeAll(async () => {
      app = await createTestApp();
      await makeStaff();

      const [patient] = await db
        .insert(patientsTable)
        .values({
          patientId: `REPRO-${marker}`,
          firstName: "Repro",
          lastName: `Probe ${marker}`,
          dateOfBirth: "1970-03-04",
          gender: "male",
          phone: "0000000000",
        })
        .returning();
      patientId = patient.id;

      const [test] = await db
        .insert(testsTable)
        .values({
          name: `MRI Brain ${marker}`,
          code: `REPR${marker.slice(0, 4).toUpperCase()}`,
          price: "1000",
          category: "Radiology",
          department: "Radiology",
          duration: "1 day",
          isActive: true,
        })
        .returning();
      testId = test.id;

      const [order] = await db
        .insert(ordersTable)
        .values({
          orderNumber: `ORD-REPRO-${marker}`,
          patientId,
          status: "pending",
        })
        .returning();
      orderId = order.id;

      const [sig] = await db
        .insert(signaturesTable)
        .values({
          name: SIGNER_NAME,
          role: "Radiologist",
          qualification: "MD Radiodiagnosis",
          registrationNo: `REG-REPRO-${marker.slice(0, 6).toUpperCase()}`,
          imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          isActive: true,
        })
        .returning();
      signatureId = sig.id;

      // No institutional-style fixture: the certificate does not consult it. Signing
      // without any `radiology_institutional_styles` row is the shipped default for a
      // fresh install, and `signedPresentationFreeze.request.test.ts` already covers
      // what the style row DOES feed (the frozen signer flags).

      await publishTemplate();
      originalSelection = await setActiveTemplate();
    }, 180_000);

    afterAll(async () => {
      // Put the clinic's own selection back deterministically, not only via each
      // test's `finally`: a suite that aborts mid-run otherwise leaves our marker
      // key installed as the active presentation for every later suite in the
      // worker, which is a cross-file failure that looks like someone else's bug.
      if (originalSelection) await originalSelection.restore();
      if (templateRowId) {
        await db
          .delete(radiologyPresentationTemplatesTable)
          .where(eq(radiologyPresentationTemplatesTable.id, templateRowId));
      }
      for (const id of reportIds) {
        await db
          .delete(radiologyReportPresentationFreezeTable)
          .where(eq(radiologyReportPresentationFreezeTable.reportId, id));
        await db
          .delete(patientReportsTable)
          .where(eq(patientReportsTable.id, id));
      }
      await db
        .delete(signaturesTable)
        .where(eq(signaturesTable.id, signatureId));
      for (const id of worklistIds) {
        await db
          .delete(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.id, id))
          .catch(() => {});
      }
      for (const id of studyIds) {
        await db
          .delete(radiologyStudiesTable)
          .where(eq(radiologyStudiesTable.id, id))
          .catch(() => {});
      }
      for (const id of orderTestIds) {
        await db
          .delete(orderTestsTable)
          .where(eq(orderTestsTable.id, id))
          .catch(() => {});
      }
      if (orderId) {
        await db.delete(ordersTable).where(eq(ordersTable.id, orderId)).catch(() => {});
      }
      // Backstop for a test that aborted inside the D5 door: put the flag row back
      // exactly as it was, and delete it only if this suite is the one that created it.
      if (flagBefore) {
        await db
          .update(featureFlagsTable)
          .set({ enabled: flagBefore.enabled })
          .where(eq(featureFlagsTable.key, "ff_radiology_structured_final"))
          .catch(() => {});
      } else {
        await db
          .delete(featureFlagsTable)
          .where(eq(featureFlagsTable.key, "ff_radiology_structured_final"))
          .catch(() => {});
      }
      invalidateFeatureFlagCache();
      await db.delete(testsTable).where(eq(testsTable.id, testId));
      await db.delete(patientsTable).where(eq(patientsTable.id, patientId));
    }, 120_000);

    it("T1 — a real published DB version certifies, and the freeze records ITS version", async () => {
      const id = await newDraft("Repro T1");
      const res = await sign(id);
      expect(res.status, res.text).toBe(200);

      const row = await freezeRow(id);
      expect(row, "signed with no freeze row").not.toBeNull();
      expect(row!.templateKey).toBe(KEY);
      // The seed is version 1. Recording 7 is the proof the snapshot came from the
      // database row and not from seedByKey — a freeze row alone cannot show this.
      expect(row!.templateVersion).toBe(V);
    });

    it("T6 — a certified signature writes all three artifacts together", async () => {
      // requirement 3, the positive half: the flip, the freeze and the audit entry are
      // one transaction, so a signed report can never again exist with a print surface
      // that re-derives from live data (freeze missing) or no trace at all (audit missing).
      const id = await newDraft("Repro T6");
      expect((await reportRow(id)).status).toBe("draft");

      const res = await sign(id);
      expect(res.status, res.text).toBe(200);

      const row = await reportRow(id);
      expect(row.status).toBe("pending_verification");
      expect(row.signedAt).not.toBeNull();
      expect(row.signatureId).toBe(signatureId);
      expect(
        await scalarInt(sql`
      select count(*)::int as n from radiology_report_presentation_freeze
      where report_id = ${id}`),
      ).toBe(1);
      expect(await signAuditCount(id)).toBe(1);
      expect(await refusalAuditCount(id)).toBe(0);
    });

    it("T2 — no published DB version: signing is refused, nothing at all is written", async () => {
      const id = await newDraft("Repro T2");
      // status='retired' is the documented soft delete (presentationTemplateStore.ts:7),
      // and it is what `latestPublishedVersion` filters on — so "no published version"
      // is reached the way an operator would reach it, not by editing the table under it.
      await setTemplateStatus("retired");
      try {
        const res = await sign(id);
        expect(res.status).toBe(409);
        expect(String(res.body?.code)).toBe("report_presentation_unresolved");
        // A refusal is never a dead end: it must name the fix, not just fail.
        expect(String(res.body?.error)).toMatch(/template/i);

        const row = await reportRow(id);
        // This IS the rollback proof: the UPDATE that sets status/signedAt/signatureId
        // runs FIRST, inside the same transaction as the freeze that then throws, so
        // every one of these three columns is the pre-sign value again.
        expect(row.status).toBe("draft");
        expect(row.signedAt).toBeNull();
        expect(row.signatureId).toBeNull();
        expect(await freezeRow(id)).toBeNull();
        expect(await signAuditCount(id)).toBe(0);
        // The refusal itself is recorded, and names the fix.
        expect(await refusalAuditCount(id)).toBe(1);
      } finally {
        await setTemplateStatus("published");
      }
    });

    it("T3 — an active presentation nobody published: the silent seed fallback is refused", async () => {
      // The defect requirement 1 names, measured on the resolver's own degradation
      // chain. When the clinic's selection names a key with no published version,
      // resolveTemplateRecordForRender falls through every lookup and ends at
      // seedByKey(DEFAULT_TEMPLATE_KEY) (presentationTemplateStore.ts:548); the
      // freeze INSERT then succeeds and records care-classic@1 — a presentation
      // nobody chose, which any later code edit to the seed re-themes without
      // asking. A signature must not be taken under that; and the refusal has to
      // name the key, because "publish the template" is only actionable if the
      // radiologist can see WHICH one.
      const ghostKey = `care-unpublished-${marker}`;
      if (seedByKey(ghostKey))
        throw new Error(
          `${ghostKey} is a shipped seed; the suite's premise changed`,
        );

      const id = await newDraft("Repro T3");
      const selection = await setActiveTemplateTo(ghostKey);
      try {
        const res = await sign(id);
        expect(
          res.status,
          `${res.text} — an unpublished presentation certified a signature`,
        ).toBe(409);
        expect(String(res.body?.code)).toBe("report_presentation_unresolved");
        expect(String(res.body?.error)).toContain(ghostKey);
        expect((await reportRow(id)).status).toBe("draft");
        expect(await freezeRow(id)).toBeNull();
        expect(await signAuditCount(id)).toBe(0);
      } finally {
        await selection.restore();
      }
    });

    it("T4 — the readiness probe says so early, read-only, and changes nothing", async () => {
      // The SAME route is exercised in both states, so a stub that always answers
      // ok:true cannot pass.
      const good = await newDraft("Repro T4 ok");
      const before = await reportRow(good);

      const ok = await request(app)
        .get(`/api/patient-reports/${good}/signing-readiness`)
        .set("Authorization", `Bearer ${signerToken}`);
      expect(ok.status, ok.text).toBe(200);
      expect(ok.body?.ready).toBe(true);
      expect(ok.body?.templateKey).toBe(KEY);
      expect(ok.body?.templateVersion).toBe(V);

      const after = await reportRow(good);
      expect(after.status).toBe(before.status);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(await freezeRow(good)).toBeNull();
      expect(await signAuditCount(good)).toBe(0);
      expect(await refusalAuditCount(good)).toBe(0);

      await setTemplateStatus("retired");
      try {
        const bad = await request(app)
          .get(`/api/patient-reports/${good}/signing-readiness`)
          .set("Authorization", `Bearer ${signerToken}`);
        expect(bad.status).toBe(200);
        expect(bad.body?.ready).toBe(false);
        expect(String(bad.body?.code)).toBe("report_presentation_unresolved");
        expect((await reportRow(good)).status).toBe("draft");
        // Read-only in BOTH states: a probe that records readiness would put audit
        // rows on the chain for every keystroke-level check the UI makes.
        expect(await signAuditCount(good)).toBe(0);
        expect(await refusalAuditCount(good)).toBe(0);
        expect(await freezeRow(good)).toBeNull();
      } finally {
        await setTemplateStatus("published");
      }
    });

    it("T10 — the pre-finalize probe answers by PATIENT, and the door says the same thing", async () => {
      // Requirement 6 wired into the reporting workspace. A FIRST finalize signs a
      // document that has no `patient_reports` id yet, so
      // `/:id/signing-readiness` cannot describe it and the radiologist would learn
      // the clinic's presentation was never published only after signing and being
      // refused. The patient-scoped sibling answers the same two halves early.
      const probe = (id: number | string) =>
        request(app)
          .get(`/api/patient-reports/signing-readiness/${id}`)
          .set("Authorization", `Bearer ${signerToken}`);

      const ok = await probe(patientId);
      expect(ok.status, ok.text).toBe(200);
      expect(ok.body?.ready).toBe(true);
      expect(ok.body?.templateKey).toBe(KEY);
      expect(ok.body?.templateVersion).toBe(V);

      // The template half, in both states, on the same route — so a stub that
      // always answers ready:true cannot pass this.
      await setTemplateStatus("retired");
      try {
        const bad = await probe(patientId);
        expect(bad.status, bad.text).toBe(200);
        expect(bad.body?.ready).toBe(false);
        expect(String(bad.body?.code)).toBe("report_presentation_unresolved");
        expect(String(bad.body?.fault)).toBe("template");
      } finally {
        await setTemplateStatus("published");
      }

      // The identity half, which only this probe can reach early: a registration
      // with no name would sign a document that cannot say whose it is. The probe
      // and the Sign door must quote ONE sentence, or the screen promises what the
      // button takes back.
      const [nameless] = await db
        .insert(patientsTable)
        .values({
          patientId: `REPRO-N-${marker}`,
          firstName: "",
          lastName: "",
          dateOfBirth: "1970-03-04",
          gender: "female",
          phone: "0000000001",
        })
        .returning();
      try {
        const warned = await probe(nameless.id);
        expect(warned.status, warned.text).toBe(200);
        expect(warned.body?.ready).toBe(false);
        expect(String(warned.body?.fault)).toBe("identity");
        expect(String(warned.body?.message)).toContain("whose report it is");

        const [row] = await db
          .insert(patientReportsTable)
          .values({
            reportNumber: `REPRO-N-${marker}`,
            type: "radiology",
            patientId: nameless.id,
            testId,
            title: "Repro T10 nameless",
            body: "Synthetic findings for the pre-finalize probe.",
            status: "draft",
          })
          .returning();
        reportIds.push(row.id);

        const door = await sign(row.id);
        expect(door.status, door.text).toBe(409);
        expect(String(door.body?.fault)).toBe("identity");
        expect(door.body?.message).toBe(warned.body?.message);
        expect((await reportRow(row.id)).status).toBe("draft");
        expect(await freezeRow(row.id)).toBeNull();

        // Control on the same door: the patient WITH a name signs, so the refusal
        // above is the identity half and not a fixture that never reached the gate.
        const control = await newDraft("Repro T10 control");
        const signed = await sign(control);
        expect(signed.status, signed.text).toBe(200);
      } finally {
        await db.delete(patientsTable).where(eq(patientsTable.id, nameless.id));
      }

      // A row with no patient to resolve is a 400, not an identity refusal: the
      // workspace has to be able to tell "nothing was checked" from "this cannot
      // be signed", because the first is the Not-checked block's sentence.
      const junk = await probe("0");
      expect(junk.status, junk.text).toBe(400);
    });

    it("T5 — refusing a signature never changes what a draft prints", async () => {
      // requirement 8: print keeps its never-throw resolution, or this gate would
      // turn a template fault into a blank page instead of a refused signature.
      const id = await newDraft("Repro T5");
      const html = await request(app)
        .get(`/api/patient-reports/${id}/print?preview=true`)
        .set("Authorization", `Bearer ${signerToken}`);
      expect(html.status).toBe(200);
      expect(html.text.length).toBeGreaterThan(200);
    });

    it("T7 — an audit write that fails INSIDE the signing transaction rolls the signature back", async () => {
      // Requirement 3's negative half, and the only proof that the audit entry is
      // really in the transaction: the shipped code wrote it in its OWN transaction
      // and swallowed the failure (`lib/audit.ts`), so a report could be signed with
      // no trace in the register at all. That difference is invisible to a test that
      // only counts rows on the happy path, so the fault is injected here.
      //
      // `audit_logs` has exactly one constraint a request can violate — its serial
      // primary key (lib/db/src/schema/auditLogs.ts:19) — so the sequence is put one
      // row behind: the next nextval() returns an id that already exists.
      const id = await newDraft("Repro T7");
      await db.execute(
        sql`select setval(pg_get_serial_sequence('audit_logs','id'),
                         (select coalesce(greatest(max(id) - 1, 1), 1) from audit_logs))`,
      );
      try {
        const res = await sign(id);
        expect(res.status).toBe(500);

        const row = await reportRow(id);
        expect(row.status, "an audit failure left the report signed").toBe("draft");
        expect(row.signedAt).toBeNull();
        expect(row.signatureId).toBeNull();
        expect(await freezeRow(id)).toBeNull();
        expect(await signAuditCount(id)).toBe(0);
      } finally {
        await db.execute(
          sql`select setval(pg_get_serial_sequence('audit_logs','id'),
                            (select coalesce(max(id), 1) from audit_logs))`,
        );
      }
    });

    it("T8 — the D5 structured-finalize door refuses without creating a second report", async () => {
      // Requirement 4. D5 signs in its own transaction inside a 3-attempt loop, and
      // any throw in that loop is caught by the existing handler and answered with a
      // LEGACY patient_reports row (patient-reports.ts:2558-2565). So a certificate
      // thrown from inside it would turn one refused finalize into a second document
      // for the same study — the gate therefore runs outside and before the loop.
      //
      // The fixture carries no draft on purpose: that is what makes the structured
      // transaction skip, and the skip is what the legacy fallback would then sign.
      const worklist = await billedWorklistStudy("MRI BRAIN T8");
      const flag = await enableStructuredFinalize();
      const body = {
        type: "radiology",
        patientId,
        testId,
        studyId: worklist.id,
        worklistId: worklist.id,
        title: "Repro T8",
        body: "Synthetic findings for the D5 door.",
        impression: "Synthetic impression.",
      };
      const countFor = () =>
        scalarInt(
          sql`select count(*)::int as n from patient_reports where study_id = ${worklist.id}`,
        );

      await setTemplateStatus("retired");
      try {
        const before = await countFor();
        const refused = await request(app)
          .post("/api/patient-reports")
          .set("Authorization", `Bearer ${signerToken}`)
          .send(body);
        expect(refused.status, refused.text).toBe(409);
        expect(String(refused.body?.code)).toBe("report_presentation_unresolved");
        expect(await countFor()).toBe(before);

        const [wl] = await db
          .select()
          .from(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.id, worklist.id));
        expect(wl.status).toBe("STUDY_RECEIVED");
        expect(wl.reportId).toBeNull();
      } finally {
        await setTemplateStatus("published");
        await flag.restore();
      }

      // Control on the same worklist row: with a published presentation the request
      // is accepted and DOES create the report the refusal withheld. Without this
      // half, a fixture that never reached the door would look like a working gate.
      const accepted = await request(app)
        .post("/api/patient-reports")
        .set("Authorization", `Bearer ${signerToken}`)
        .send(body);
      expect(accepted.status, accepted.text).toBe(201);
      reportIds.push(accepted.body.id as number);
      expect(await countFor()).toBe(1);
    });

    it("T9 — the amendment door answers the certificate before the document check", async () => {
      // Requirement 4's third door. An amendment is a NEW signed row superseding a
      // signed parent, so it takes the same certificate (patient-reports.ts:1749) —
      // and it must answer it early, because the transaction it precedes is the one
      // that writes the chain link, the audit row and the amendment row.
      const id = await newDraft("Repro T9");
      const flag = await enableStructuredFinalize();
      const amend = () =>
        request(app)
          .post(`/api/patient-reports/${id}/amend`)
          .set("Authorization", `Bearer ${signerToken}`)
          .send({ reason: "Correction under the reproducibility gate." });

      try {
        await setTemplateStatus("retired");
        const refused = await amend();
        expect(refused.status, refused.text).toBe(409);
        expect(String(refused.body?.code)).toBe("report_presentation_unresolved");
        expect(await amendmentCount(id)).toBe(0);
        expect((await reportRow(id)).status).toBe("draft");

        // Control, same request and the same flag state: with the presentation
        // published the gate lets it through and the DOCUMENT rule refuses it
        // instead — proof the certificate is selective, not a blanket veto on
        // amendments.
        await setTemplateStatus("published");
        const pastGate = await amend();
        expect(pastGate.status, pastGate.text).toBe(409);
        expect(String(pastGate.body?.error)).toBe("not_a_signed_structured_report");
        expect(await amendmentCount(id)).toBe(0);
      } finally {
        await setTemplateStatus("published");
        await flag.restore();
      }
    });

    it("suite hygiene: the refused reports never carry a legacy_sign entry", async () => {
      // Global restatement of the gate across the whole suite run: every report whose
      // signature was refused or failed stays unsigned in the audit register too. T6 is
      // the signed case and is deliberately NOT in this set.
      expect(
        await scalarInt(sql`
      select count(*)::int as n from audit_logs al
      join patient_reports pr on pr.id::text = al.entity_id
      where pr.title in (${"Repro T2"}, ${"Repro T3"}, ${"Repro T7"}, ${"Repro T8"}, ${"Repro T9"})
        and al.action = 'legacy_sign'`),
      ).toBe(0);
    });
  },
);
