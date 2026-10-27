/**
 * The composer's canal AP read against REAL rows.
 *
 * The unit suites prove what the projection does with a record. This proves the
 * two things only a database can prove: that the record is read from the ONE draft
 * row the report of record uses — the worklist-linked draft, whose `study_id` is
 * the worklist ROW id, not the billed study id — and that nothing in this path
 * writes to it.
 *
 * That distinction is the old CARE trap: a reader that looks the draft up by the
 * billed study returns nothing, and an AI that is told nothing about a patient's
 * canal diameters is free to state wrong ones.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable,
  radiologyReportDraftsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
} from "@workspace/db/schema";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { STRUCTURED_JSON_ENVELOPE_KIND } from "../structuredJsonColumn";
import {
  loadCanonicalCanalApForDraft,
  loadCanonicalCanalApForWorklist,
  resolveAuthoritativeComposeDraft,
} from "./resolveComposeDraft";
import { ComposerInputSnapshotSchema } from "./types";

const marker = `vitest-canal-${randomUUID().slice(0, 8)}`;

const ENVELOPE = (provenance: Record<string, unknown>) => ({
  kind: STRUCTURED_JSON_ENVELOPE_KIND,
  careCanalApProvenance: provenance,
});

describe.skipIf(!hasDatabaseUrl())(
  "the composer's canal AP read resolves the authoritative draft",
  () => {
    const patientIds: number[] = [];
    const studyIds: number[] = [];
    const worklistIds: number[] = [];
    const draftIds: number[] = [];

    const insertDraft = async (values: Record<string, unknown>) => {
      const [row] = await db
        .insert(radiologyReportDraftsTable)
        .values(values)
        .returning();
      draftIds.push(row.id as number);
      return row;
    };

    /** One examination: patient → billed study → worklist row → draft. */
    const makeStudy = async (tag: string, structuredJson: unknown) => {
      const [patient] = await db
        .insert(patientsTable)
        .values({
          patientId: `MRN-${marker}-${tag}`,
          firstName: "Synthetic",
          lastName: tag,
          dateOfBirth: "1970-01-01",
          gender: "F",
          phone: "0000000000",
        })
        .returning();
      patientIds.push(patient.id as number);

      const [study] = await db
        .insert(radiologyStudiesTable)
        .values({
          accessionNumber: `ACC-${marker}-${tag}`,
          patientId: patient.id,
          testId: 1,
          modality: "MR",
          department: "MRI",
          status: "acquired",
          studyInstanceUid: `1.2.826.vitest.canal.${marker}.${tag}`,
        })
        .returning();
      studyIds.push(study.id as number);

      const [wl] = await db
        .insert(radiologyWorklistTable)
        .values({
          patientName: `Synthetic ${tag}`,
          patientId: patient.id,
          studyId: study.id,
          patientMatchStatus: "MATCHED",
          modality: "MR",
          studyDescription: "MRI LS SPINE",
          studyInstanceUID: `1.2.826.vitest.canal.${marker}.${tag}`,
          accessionNumber: `ACC-${marker}-${tag}`,
          status: "STUDY_RECEIVED",
        })
        .returning();
      worklistIds.push(wl.id as number);

      // The reporting workspace's own habit: the draft row carries the WORKLIST
      // ROW id in `study_id`. A reader that queries the billed id finds nothing.
      const draft = await insertDraft({
        studyId: wl.id,
        worklistId: wl.id,
        patientId: patient.id,
        modality: "MR",
        status: "DRAFT",
        structuredJson,
      });
      return { patientId: patient.id as number, worklistId: wl.id as number, draftId: draft.id as number };
    };

    let measured: { patientId: number; worklistId: number; draftId: number };
    let bare: { patientId: number; worklistId: number; draftId: number };
    let empty: { patientId: number; worklistId: number; draftId: number };

    beforeAll(async () => {
      measured = await makeStudy(
        "measured",
        ENVELOPE({ "L4-L5": { viewerValue: 9.4, reportValue: 6.4, manualOverride: true } }),
      );
      bare = await makeStudy("bare-shape", {
        careCanalApProvenance: { "L1-L2": { viewerValue: 12.6 } },
      });
      empty = await makeStudy("no-record", ENVELOPE({ "L4-L5": { manualOverride: false } }));
    });

    afterAll(async () => {
      if (draftIds.length) {
        await db.delete(radiologyReportDraftsTable).where(inArray(radiologyReportDraftsTable.id, draftIds));
      }
      if (worklistIds.length) {
        await db.delete(radiologyWorklistTable).where(inArray(radiologyWorklistTable.id, worklistIds));
      }
      if (studyIds.length) {
        await db.delete(radiologyStudiesTable).where(inArray(radiologyStudiesTable.id, studyIds));
      }
      if (patientIds.length) {
        await db.delete(patientsTable).where(inArray(patientsTable.id, patientIds));
      }
    });

    it("reads the grid measurement, override and all, from the worklist-linked draft", async () => {
      const out = await loadCanonicalCanalApForWorklist(measured.worklistId);
      expect(out?.readings).toEqual([
        expect.objectContaining({
          level: "L4-L5",
          valueMm: "6.4",
          unit: "mm",
          segment: "lumbar",
          source: "radiologist-entered",
          manualOverride: true,
        }),
      ]);
    });

    it("resolves through the one draft rule every reader uses", async () => {
      const resolved = await resolveAuthoritativeComposeDraft({ worklistId: measured.worklistId });
      expect(resolved?.draftId).toBe(measured.draftId);
      const byDraft = await loadCanonicalCanalApForDraft(resolved?.draftId ?? null);
      expect(byDraft?.readings.map((r) => r.valueMm)).toEqual(["6.4"]);
    });

    it("reads the older persisted shape as well as the envelope", async () => {
      const out = await loadCanonicalCanalApForWorklist(bare.worklistId);
      expect(out?.readings.map((r) => [r.level, r.valueMm])).toEqual([["L1-L2", "12.6"]]);
    });

    it("carries nothing for a draft with no measurement, instead of inventing one", async () => {
      const out = await loadCanonicalCanalApForWorklist(empty.worklistId);
      expect(out?.readings).toEqual([]);
      expect(out?.isEmpty).toBe(true);
    });

    it("gives the newest draft of a study when a save added a second row", async () => {
      // Its own examination, so nothing above depends on test order.
      const prior = await makeStudy(
        "second-save",
        ENVELOPE({ "L4-L5": { viewerValue: 9.4, reportValue: 6.4, manualOverride: true } }),
      );
      // A draft save writes a new row; the AI must be told what the report of
      // record now says, not what an earlier one said.
      await insertDraft({
        studyId: prior.worklistId,
        worklistId: prior.worklistId,
        patientId: prior.patientId,
        modality: "MR",
        status: "DRAFT",
        structuredJson: ENVELOPE({ "L4-L5": { viewerValue: 5.2 } }),
      });
      const out = await loadCanonicalCanalApForWorklist(prior.worklistId);
      expect(out?.readings.map((r) => r.valueMm)).toEqual(["5.2"]);
      expect(out?.readings[0]?.source).toBe("viewer-caliper");
    });

    it("is not a value the client can supply, so a forged record changes nothing", async () => {
      // The browser's snapshot is stripped of the column, and the server reads the
      // row. Both halves are needed: a record that could arrive from the client
      // would be a second authority over what the AI is told about a patient.
      const forged = ComposerInputSnapshotSchema.parse({
        modality: "MR",
        findings: "",
        impression: "",
        recommendation: "",
        observations: [],
        careCanalApProvenance: { "L4-L5": { viewerValue: 99 } },
      });
      expect(forged).not.toHaveProperty("careCanalApProvenance");
      const out = await loadCanonicalCanalApForWorklist(measured.worklistId);
      expect(out?.readings.map((r) => r.valueMm)).not.toContain("99");
    });

    it("reads the record without writing to it", async () => {
      const before = await db
        .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
        .from(radiologyReportDraftsTable)
        .where(sql`${radiologyReportDraftsTable.id} = ${measured.draftId}`);
      const jsonBefore = JSON.stringify(before[0]?.structuredJson);
      await loadCanonicalCanalApForWorklist(measured.worklistId);
      const after = await db
        .select({ structuredJson: radiologyReportDraftsTable.structuredJson })
        .from(radiologyReportDraftsTable)
        .where(sql`${radiologyReportDraftsTable.id} = ${measured.draftId}`);
      expect(JSON.stringify(after[0]?.structuredJson)).toBe(jsonBefore);
    });

    it("answers null rather than guessing when there is no draft to read", async () => {
      for (const id of [null, undefined, 0, -1, Number.NaN]) {
        expect(await loadCanonicalCanalApForDraft(id)).toBeNull();
      }
      expect(await loadCanonicalCanalApForWorklist(null)).toBeNull();
    });
  },
);
