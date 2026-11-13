/**
 * The worklist folder rebuild has to be reachable from a shell.
 *
 * care-pacs archives stale `.wl` files with `tools/prune_stale_worklists.sh`,
 * and the runbook's mandatory next step was one line:
 *
 *   curl -s -X POST http://172.16.1.139:8888/api/radiology/mwl-worklist/sync
 *
 * That route sits on the staff router, behind `requireStaffAuth`, so from a
 * terminal it answers 401 "Staff authentication required". The prune had
 * already moved files out, the rebuild never ran, and an appointment booked
 * weeks ago and still pending simply disappeared from the modality's worklist —
 * while the runbook printed the whole procedure as completed.
 *
 * The fix is a second door onto the SAME orchestrator, guarded by the internal
 * key the Orthanc sidecars already use. These cases pin three things:
 *
 *   1. the internal door works with the key and does real folder work;
 *   2. it refuses without the key, so the door is not an unauthenticated write;
 *   3. both doors make identical decisions, so extracting the shared function
 *      did not fork the logic and let one door drift.
 *
 * Deliberately NOT asserted here: that a `.wl` file is created. That leg shells
 * out to DCMTK's `dump2dcm`, which CI does not install, so `writeWorklistFile`
 * returns false and `written` stays 0 on the runner. The removal leg is pure
 * filesystem and is what these tests can honestly prove; creation is proven on
 * the NAS, where DCMTK exists. `written` is compared between the two doors
 * rather than against a number, so parity holds either way.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  radiologyScheduledProceduresTable,
  usersTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import {
  MWL_NOT_CONFIGURED_MESSAGE,
  syncMwlWorklistFolder,
} from "./publishRadiologyStudyToMwl";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

// Strong enough for the strict guard as well as the lenient one, so this suite
// is not accidentally proving anything about key strength.
const INTERNAL_KEY = `vitest-mwl-${RUN}-${randomUUID()}`;

const PENDING_ACC = `MWFS-${RUN}-PENDING`;
const CANCELLED_ACC = `MWFS-${RUN}-CANCELLED`;

let dirA = "";
let dirB = "";
let staffToken = "";
let userId = 0;

async function seedProcedures(): Promise<void> {
  await db.insert(radiologyScheduledProceduresTable).values([
    {
      accessionNumber: PENDING_ACC,
      patientId: `MWFS-${RUN}-PT`,
      // Synthetic on purpose: request fixtures must never carry a name a real
      // patient could answer to.
      patientName: "Vitest^Pending",
      patientSex: "F",
      modality: "MR",
      studyDescription: "MR BRAIN VITEST",
      scheduledDate: "20300101",
      scheduledTime: "090000",
      // A real station, so the sync's "repair ANY" leg is not what is under test.
      stationAeTitle: "VITESTMR",
      status: "SENT_TO_MWL",
    },
    {
      accessionNumber: CANCELLED_ACC,
      patientId: `MWFS-${RUN}-PT`,
      patientName: "Vitest^Cancelled",
      patientSex: "M",
      modality: "MR",
      studyDescription: "MR CANCELLATION VITEST",
      scheduledDate: "20300101",
      scheduledTime: "100000",
      stationAeTitle: "VITESTMR",
      status: "CANCELLED",
    },
  ]);
}

/** Pre-place the two files a prune would have left behind, mirroring reality. */
async function seedFolderFiles(dir: string): Promise<{ pending: string; cancelled: string }> {
  const pending = path.join(dir, `${PENDING_ACC}.wl`);
  const cancelled = path.join(dir, `${CANCELLED_ACC}.wl`);
  await writeFile(pending, "still a live appointment on the scanner");
  await writeFile(cancelled, "cancelled last month, file outlived it");
  return { pending, cancelled };
}

async function staffDoor(app: Awaited<ReturnType<typeof createTestApp>>) {
  return request(app).post("/api/radiology/mwl-worklist/sync").set("Authorization", `Bearer ${staffToken}`);
}

async function internalDoor(app: Awaited<ReturnType<typeof createTestApp>>, key = INTERNAL_KEY) {
  return request(app)
    .post("/api/internal/radiology/mwl-worklist/sync")
    .set("Authorization", `Bearer ${key}`);
}

describe.skipIf(!dbAvailable)("MWL worklist folder rebuild: internal door", () => {
  const savedEnv: Record<string, string | undefined> = {
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    ORTHANC_WORKLIST_DIR: process.env.ORTHANC_WORKLIST_DIR,
  };

  beforeAll(async () => {
    dirA = await mkdtemp(path.join(os.tmpdir(), `mwl-sync-A-${RUN}-`));
    dirB = await mkdtemp(path.join(os.tmpdir(), `mwl-sync-B-${RUN}-`));
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    process.env.ORTHANC_WORKLIST_DIR = dirA;

    await seedProcedures();

    const username = `mwl-sync-${RUN}`;
    staffToken = `vitest-${username}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `MWL Sync Vitest ${RUN}`,
        email: `${username}@vitest.invalid`,
        username,
        role: "admin",
        permissions: JSON.stringify(["/radiology"]),
        pin: "0000",
        isActive: true,
      })
      .returning();
    userId = user!.id;
    await db.insert(portalSessionsTable).values({
      token: staffToken,
      scope: "staff",
      subjectId: userId,
      subjectName: user!.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    process.env.INTERNAL_API_KEY = savedEnv.INTERNAL_API_KEY;
    process.env.ORTHANC_WORKLIST_DIR = savedEnv.ORTHANC_WORKLIST_DIR;
    await db
      .delete(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, PENDING_ACC));
    await db
      .delete(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, CANCELLED_ACC));
    try {
      await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, staffToken));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    } catch {
      // Marker-scoped rows; the next run gets a new marker.
    }
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  it("the runbook command now works: internal key rebuilds the folder", async () => {
    const files = await seedFolderFiles(dirA);
    const app = await createTestApp();

    const res = await internalDoor(app);

    expect(res.status).toBe(200);
    // The regression in one line: before the internal door existed this call
    // was a 401, so the cancelled file survived and nobody looked twice.
    expect(existsSync(files.cancelled)).toBe(false);
    expect(res.body).toMatchObject({ removed: expect.any(Number), total: expect.any(Number) });
  });

  it("refuses without the internal key rather than half-running", async () => {
    const files = await seedFolderFiles(dirA);
    const app = await createTestApp();

    // INTERNAL_API_KEY is set for this suite, so both guards really compare:
    // an unset key would make requireInternalApiKey pass through by design in
    // non-production, and a test that relied on that would prove nothing.
    const noHeader = await request(app).post("/api/internal/radiology/mwl-worklist/sync");
    expect(noHeader.status).toBe(401);

    const wrongKey = await internalDoor(app, `wrong-but-long-enough-${RUN}-key-value`);
    expect(wrongKey.status).toBe(401);

    // A refused rebuild must not have touched the folder either.
    expect(existsSync(files.cancelled)).toBe(true);
  });

  it("both doors make exactly the same decisions", async () => {
    // The reason the shared orchestrator is allowed to exist: if the staff door
    // and the machine door each kept their own copy of the loop, a later fix to
    // one would silently not reach the other — which is how the withheld-entry
    // bug was found in the first place.
    //
    // `stationsRepaired` is deliberately not compared. Repairing a null/ANY
    // station is a write to a shared row, so whichever door runs first settles
    // it for the other; comparing it would test the order of these two calls
    // rather than the equality of the logic.
    const staffFiles = await seedFolderFiles(dirA);
    const internalFiles = await seedFolderFiles(dirB);
    const app = await createTestApp();

    process.env.ORTHANC_WORKLIST_DIR = dirA;
    const staffRes = await staffDoor(app);
    process.env.ORTHANC_WORKLIST_DIR = dirB;
    const internalRes = await internalDoor(app);

    expect(staffRes.status).toBe(200);
    expect(internalRes.status).toBe(200);
    expect(internalRes.body.total).toBe(staffRes.body.total);
    expect(internalRes.body.written).toBe(staffRes.body.written);
    expect(internalRes.body.removed).toBe(staffRes.body.removed);

    expect(existsSync(staffFiles.cancelled)).toBe(false);
    expect(existsSync(internalFiles.cancelled)).toBe(false);
    expect(existsSync(staffFiles.pending)).toBe(existsSync(internalFiles.pending));
  });

  it("an unmounted folder answers 503 with the same wording on both doors", async () => {
    const previous = process.env.ORTHANC_WORKLIST_DIR;
    delete process.env.ORTHANC_WORKLIST_DIR;
    try {
      const app = await createTestApp();
      const internalRes = await internalDoor(app);
      const staffRes = await staffDoor(app);

      expect(internalRes.status).toBe(503);
      expect(staffRes.status).toBe(503);
      expect(internalRes.body.error).toBe(MWL_NOT_CONFIGURED_MESSAGE);
      expect(staffRes.body.error).toBe(MWL_NOT_CONFIGURED_MESSAGE);
    } finally {
      process.env.ORTHANC_WORKLIST_DIR = previous;
    }
  });

  it("the orchestrator itself reports an unmounted folder as a state, not a fault", async () => {
    const previous = process.env.ORTHANC_WORKLIST_DIR;
    delete process.env.ORTHANC_WORKLIST_DIR;
    try {
      const result = await syncMwlWorklistFolder();
      expect(result).toEqual({ ok: false, reason: "not_configured" });
    } finally {
      process.env.ORTHANC_WORKLIST_DIR = previous;
    }
  });
});
