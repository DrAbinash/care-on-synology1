/**
 * Z.AI audit item 8 (the sequence) — the value handed to the worklist writer.
 *
 * The correction has to be in `radiology_scheduled_procedures` *before*
 * `republishWorklistForAccession` reads it back: that function selects the row
 * by accession and passes what it finds straight to the writer, so an update
 * placed after the call would fix the database and still re-issue the old
 * referrer to the modality. Reading the stored row afterwards cannot see that —
 * by then the row is right either way.
 *
 * So this suite takes the hand-off itself. `dump2dcm` is not installed here or
 * in CI, which is why the file's bytes are unobservable; mocking the writer's
 * own entry point lets the assertion be made on the exact object the publisher
 * was given, which is the same input `buildMwlDumpText` would have rendered.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  portalSessionsTable,
  radiologyScheduledProceduresTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const handedToWriter: { accession: string; referringDoctor: unknown; referringDoctorId: unknown }[] = [];

vi.mock("../lib/pacs/mwlWorklistWriter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/pacs/mwlWorklistWriter")>();
  return {
    ...real,
    syncWorklistForStatus: async (p: any, status: string) => {
      handedToWriter.push({
        accession: p.accessionNumber,
        referringDoctor: p.referringDoctor,
        referringDoctorId: p.referringDoctorId,
      });
      return { action: "written", written: true } as const;
    },
  };
});

const dbReady = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8).toUpperCase();
const OLD_DOC = `DR SEQ OLD ${RUN}`;
const NEW_DOC = `DR SEQ NEW ${RUN}`;

describe.skipIf(!dbReady)("referring-doctor correction → what the writer is handed", () => {
  let app: Express;
  let token = "";
  let userId = 0;
  const accession = `RD-${RUN}-SEQ`;
  let worklistId = 0;

  beforeAll(async () => {
    app = await createTestApp();
    token = `rd-seq-token-${randomUUID()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Referrer Sequence ${RUN}`,
        email: `referrer-seq-${RUN}@vitest.invalid`,
        username: `referrer-seq-${RUN}`,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user.id;
    await db.insert(portalSessionsTable).values({
      token,
      scope: "staff",
      subjectId: userId,
      subjectName: user.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: `Vitest Sequence ${RUN}`,
        age: "41Y",
        sex: "M",
        modality: "MR",
        studyDescription: `MRI BRAIN ${RUN}-SEQ`,
        studyDate: "20261113",
        accessionNumber: accession,
        studyInstanceUID: `1.2.826.${RUN}.SEQ`,
        referringDoctor: OLD_DOC,
        status: "STUDY_RECEIVED",
      })
      .returning();
    worklistId = wl.id;

    await db.insert(radiologyScheduledProceduresTable).values({
      accessionNumber: accession,
      patientId: `RD-SEQ-${RUN}`,
      patientName: `Vitest Sequence ${RUN}`,
      modality: "MR",
      studyDescription: `MRI BRAIN ${RUN}-SEQ`,
      referringDoctor: OLD_DOC,
      referringDoctorId: `8${RUN.slice(0, 4)}`,
      scheduledDate: "20261113",
      scheduledTime: "093000",
      stationAeTitle: "MRI01",
      status: "SCHEDULED",
    });
  });

  afterAll(async () => {
    await db
      .delete(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, accession));
    if (worklistId) await db.delete(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, worklistId));
    await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("publishes the corrected referrer, not the one the booking resolved", async () => {
    expect(handedToWriter.length).toBe(0);
    const dir = await mkdtemp(path.join(os.tmpdir(), `mwl-seq-${RUN}-`));
    const previous = process.env.ORTHANC_WORKLIST_DIR;
    process.env.ORTHANC_WORKLIST_DIR = dir;
    try {
      const res = await request(app)
        .patch(`/api/radiology/pacs-worklist/${worklistId}/referring-doctor`)
        .set("Authorization", `Bearer ${token}`)
        .send({ referringDoctor: NEW_DOC });
      expect(res.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
      else process.env.ORTHANC_WORKLIST_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }

    const calls = handedToWriter.filter((c) => c.accession === accession);
    expect(calls.length, "the writer must be handed this accession").toBe(1);
    // This is the string the modality console paints. A route that updated the
    // row after the republish would leave the booked name here.
    expect(calls[0]!.referringDoctor).toBe(NEW_DOC);
    expect(calls[0]!.referringDoctorId).toBeNull();
  });
});
