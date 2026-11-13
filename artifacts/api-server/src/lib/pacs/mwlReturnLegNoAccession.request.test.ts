/**
 * A study that arrives without an AccessionNumber silently leaves the loop open.
 *
 * The return leg of the imaging loop is keyed on one field: `completeMwlOnIntake`
 * looks up the scheduled procedure BY accession, marks it COMPLETED and deletes
 * the `.wl` file — that deletion is the replacement for the Orthanc worklist
 * housekeeper thread that was switched off after it segfaulted the PACS.
 *
 * A modality console that does not copy the MWL's AccessionNumber back onto the
 * study it sends therefore produces the worst kind of failure: the images arrive,
 * they reach Orthanc, care-erp-sync posts them, intake returns 201, the study is
 * readable in OHIF — and the appointment stays SENT_TO_MWL with its worklist file
 * still on the scanner, showing a real patient as pending forever. Every check
 * anyone had was green.
 *
 * Fix #2 puts that state on the dashboard as an error row naming the UID. It does
 * NOT auto-complete anything: the UID a pre-allocated worklist carries is derived
 * from its accession, so the appointment could be found by re-deriving it, but
 * writing COMPLETED to a scheduled procedure is a clinical write and needs its own
 * sign-off. These cases pin exactly that boundary — including the healthy path
 * staying silent, so the alarm cannot become background noise.
 *
 * Why the assertions go through POST /api/internal/radiology/studies rather than
 * calling `completeMwlOnIntake` directly: the defect was partly that intake held
 * the UID and never passed it down. A test that supplied the UID itself would pass
 * against the unfixed route. Only the real request proves the producer wired it.
 *
 * Because the route fires the automation without awaiting it, absence cannot be
 * asserted immediately after the response. The settle window is therefore taken
 * from the latency this same file OBSERVES on the positive case (see
 * `observedSettleMs`), not from a guessed sleep.
 *
 * The last case reads the alarm back through the dashboard endpoint the clinic
 * actually looks at, because a row in a table an operator never opens is not an
 * alarm. That case also found the second half of the fix: the dashboard picks its
 * "what to do next" text from keywords in the message, and this row's wording
 * matches the infrastructure-fault branch, so it needed its own event-type branch
 * in `pacsEnterprise.ts` — otherwise the advice printed beside the correct
 * complaint was to go check a cron agent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  pacsLogsTable,
  portalSessionsTable,
  radiologyScheduledProceduresTable,
  radiologyWorklistTable,
  usersTable,
} from "@workspace/db/schema";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { MWL_RETURN_LEG_NO_ACCESSION } from "./dicomIntakeAutomation";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);
const INTERNAL_KEY = `vitest-mwl-noleg-${RUN}-${randomUUID()}`;

// Synthetic DICOM UIDs under a private-ish root carrying this run's marker, so
// rows can be deleted by prefix and never touch a real study.
const UID_NO_ACC = `1.2.826.0.1.3680043.10.9999.${RUN}.NOACC`;
const UID_REPUSH = `1.2.826.0.1.3680043.10.9999.${RUN}.REPUSH`;
const UID_WITH_ACC = `1.2.826.0.1.3680043.10.9999.${RUN}.WITHACC`;
const UID_NO_MWL = `1.2.826.0.1.3680043.10.9999.${RUN}.NOMWL`;

const ACC_OK = `MWNA-${RUN}-LINKED`;
// A fifth study, used only by the case that reads the dashboard back.
const UID_TILE = `1.2.826.0.1.3680043.10.9999.${RUN}.TILE`;

let worklistDir = "";
let app: Awaited<ReturnType<typeof createTestApp>>;
let staffToken = "";
let userId = 0;

/**
 * How long the positive case actually took to land its row. The negative cases
 * wait this long (with margin) before claiming "nothing was written", so the
 * absence is measured against a window this run proved sufficient rather than
 * against a constant that a slower CI machine could outrun and turn into a
 * passing test that observed nothing.
 */
let observedSettleMs = 0;

async function countAlarmRows(studyInstanceUid: string): Promise<number> {
  const rows = await db
    .select({ id: pacsLogsTable.id })
    .from(pacsLogsTable)
    .where(
      and(
        eq(pacsLogsTable.eventType, MWL_RETURN_LEG_NO_ACCESSION),
        eq(pacsLogsTable.studyInstanceUid, studyInstanceUid),
      )!,
    );
  return rows.length;
}

async function pushStudy(body: Record<string, unknown>) {
  return request(app).post("/api/internal/radiology/studies").set("Authorization", `Bearer ${INTERNAL_KEY}`).send(body);
}

/** Minimal payload the route accepts: it requires a name plus one identifier. */
function intakePayload(studyInstanceUID: string, accessionNumber = "") {
  return {
    studyInstanceUID,
    accessionNumber,
    patientId: `MWNA-${RUN}-PT`,
    // Synthetic: a request fixture must never carry a name a real patient answers to.
    patientName: "Vitest^Noaccession",
    patientSex: "F",
    modality: "MR",
    studyDescription: "MR VITEST RETURN LEG",
    studyDate: "20300101",
    aeTitle: "ORTHANC2",
  };
}

async function settleWaitMs(): Promise<number> {
  return Math.max(observedSettleMs * 5, 1_000);
}

async function waitUntilAlarmAppears(studyInstanceUid: string, timeoutMs = 10_000): Promise<number> {
  const startedAt = Date.now();
  for (;;) {
    const count = await countAlarmRows(studyInstanceUid);
    if (count > 0) {
      observedSettleMs = Math.max(observedSettleMs, Date.now() - startedAt);
      return count;
    }
    if (Date.now() - startedAt > timeoutMs) return count;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitFullWindow(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
}

describe.skipIf(!dbAvailable)("MWL return leg: study without accession", () => {
  const savedEnv: Record<string, string | undefined> = {
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    ORTHANC_WORKLIST_DIR: process.env.ORTHANC_WORKLIST_DIR,
  };

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    worklistDir = await mkdtemp(path.join(os.tmpdir(), `mwl-noleg-${RUN}-`));
    // The alarm is scoped to deployments that actually have a shared worklist
    // folder, so it has to be mounted for the "it fires" cases.
    process.env.ORTHANC_WORKLIST_DIR = worklistDir;
    app = await createTestApp();

    // The dashboard half is a staff route (/api/radiology/network/health-monitor),
    // so reading the alarm back needs a real staff session rather than a header
    // the guard would reject.
    const username = `mwl-noleg-${RUN}`;
    staffToken = `vitest-${username}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `MWL No-Leg Vitest ${RUN}`,
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
    for (const uid of [UID_NO_ACC, UID_REPUSH, UID_WITH_ACC, UID_NO_MWL, UID_TILE]) {
      await db
        .delete(pacsLogsTable)
        .where(
          and(
            eq(pacsLogsTable.eventType, MWL_RETURN_LEG_NO_ACCESSION),
            eq(pacsLogsTable.studyInstanceUid, uid),
          )!,
        );
      await db
        .delete(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.studyInstanceUID, uid));
    }
    await db
      .delete(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, ACC_OK));
    process.env.INTERNAL_API_KEY = savedEnv.INTERNAL_API_KEY;
    process.env.ORTHANC_WORKLIST_DIR = savedEnv.ORTHANC_WORKLIST_DIR;
    await rm(worklistDir, { recursive: true, force: true });
  });

  it("names the study on the dashboard when its accession leg is missing", async () => {
    const res = await pushStudy(intakePayload(UID_NO_ACC));

    // The images DID arrive; intake is a success. That is the whole point — this
    // request looked healthy before the fix.
    expect(res.status).toBe(201);

    const count = await waitUntilAlarmAppears(UID_NO_ACC);
    expect(count).toBe(1);

    const [row] = await db
      .select()
      .from(pacsLogsTable)
      .where(
        and(
          eq(pacsLogsTable.eventType, MWL_RETURN_LEG_NO_ACCESSION),
          eq(pacsLogsTable.studyInstanceUid, UID_NO_ACC),
        )!,
      )
      .limit(1);

    expect(row).toBeDefined();
    // severity=error is what the ops health check reads; a warning would sit
    // below the threshold the operator actually notices.
    expect(row!.severity).toBe("error");
    // The message has to name the study and the action, because this row is the
    // only thing the operator sees about an appointment nobody booked as open.
    expect(row!.message).toContain(UID_NO_ACC);
    expect(row!.message).toMatch(/Match Center/i);
    expect(row!.accessionNumber).toBeNull();
  });

  it("records one row per study, not one per push", async () => {
    // Retention replays, a modality re-sending the study, and care-erp-sync's own
    // retry ladder can all push the same UID repeatedly. Stacking identical errors
    // would make the count meaningless and bury the one study that needs a human.
    await pushStudy(intakePayload(UID_REPUSH));
    const first = await waitUntilAlarmAppears(UID_REPUSH);
    expect(first).toBe(1);

    await pushStudy(intakePayload(UID_REPUSH));
    await pushStudy(intakePayload(UID_REPUSH));
    await waitFullWindow(await settleWaitMs());

    expect(await countAlarmRows(UID_REPUSH)).toBe(1);
  });

  it("stays silent on the healthy path, where the accession closes the loop", async () => {
    // The control that makes the alarm trustworthy: a normal arrival, with its
    // accession intact, must NOT raise it. An alarm that also fires on success is
    // an alarm the operator stops reading.
    await db.insert(radiologyScheduledProceduresTable).values({
      accessionNumber: ACC_OK,
      patientId: `MWNA-${RUN}-PT`,
      patientName: "Vitest^Linked",
      patientSex: "F",
      modality: "MR",
      studyDescription: "MR LINKED VITEST",
      scheduledDate: "20300101",
      scheduledTime: "090000",
      stationAeTitle: "VITESTMR",
      status: "SENT_TO_MWL",
    });

    const res = await pushStudy(intakePayload(UID_WITH_ACC, ACC_OK));
    expect(res.status).toBe(201);
    await waitFullWindow(await settleWaitMs());

    expect(await countAlarmRows(UID_WITH_ACC)).toBe(0);

    // And the appointment really did close — this is the behaviour the missing
    // accession leg silently skips.
    const [proc] = await db
      .select({ status: radiologyScheduledProceduresTable.status })
      .from(radiologyScheduledProceduresTable)
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, ACC_OK))
      .limit(1);
    expect(proc!.status).toBe("COMPLETED");
  });

  it("does not raise it where no worklist folder is mounted at all", async () => {
    // Without a shared folder no `.wl` can be left open, so the same study would
    // be a false alarm on a deployment that never had the loop.
    const previous = process.env.ORTHANC_WORKLIST_DIR;
    delete process.env.ORTHANC_WORKLIST_DIR;
    try {
      const res = await pushStudy(intakePayload(UID_NO_MWL));
      expect(res.status).toBe(201);
      await waitFullWindow(await settleWaitMs());
      expect(await countAlarmRows(UID_NO_MWL)).toBe(0);
    } finally {
      process.env.ORTHANC_WORKLIST_DIR = previous;
    }
  });

  it("reaches the operator: the worklist tile turns red and says Match Center", async () => {
    // Fix #2 is worth nothing if the row only lands in a table.
    // GET /api/radiology/network/health-monitor is the screen the clinic reads:
    // it turns `worklistCreation` red on any error row created today whose
    // source or message mentions worklist/scheduled, and lists that row under
    // recent errors with a `suggestedAction` chosen from keywords in the message.
    //
    // The baseline is captured first because that keyword chain was written for
    // infrastructure faults. Without the event-type branch added alongside this
    // alarm, this row's own wording would have matched "worklist" and the
    // dashboard would have told the operator to go verify a cron agent and a
    // sync endpoint — when the study arrived correctly and needs one link in the
    // Match Center. The tile colour alone cannot prove that link, because a
    // shared CI database may already hold an unrelated error today, so the
    // predicate is also asserted on the row's own text.
    const before = await request(app)
      .get("/api/radiology/network/health-monitor")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(before.status).toBe(200);
    const baselineTile = before.body?.health?.worklistCreation;

    const res = await pushStudy(intakePayload(UID_TILE));
    expect(res.status).toBe(201);
    expect(await waitUntilAlarmAppears(UID_TILE)).toBe(1);

    const [alarm] = await db
      .select({ message: pacsLogsTable.message, severity: pacsLogsTable.severity })
      .from(pacsLogsTable)
      .where(
        and(
          eq(pacsLogsTable.eventType, MWL_RETURN_LEG_NO_ACCESSION),
          eq(pacsLogsTable.studyInstanceUid, UID_TILE),
        )!,
      )
      .limit(1);
    // What the tile's own WHERE clause looks for, stated on the row rather than
    // inferred from a colour.
    expect(alarm!.severity).toBe("error");
    expect(alarm!.message.toLowerCase()).toContain("worklist");

    const after = await request(app)
      .get("/api/radiology/network/health-monitor")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(after.status).toBe(200);
    expect(after.body?.health?.worklistCreation).toBe("red");

    type ListedError = {
      eventType?: string | null;
      studyInstanceUid?: string | null;
      suggestedAction?: string;
    };
    const listed: ListedError | undefined = ((after.body?.recentErrors ?? []) as ListedError[]).find(
      (e) => e.eventType === MWL_RETURN_LEG_NO_ACCESSION && e.studyInstanceUid === UID_TILE,
    );

    expect(
      listed,
      `alarm row absent from the dashboard's recent errors (baseline tile was ${String(baselineTile)})`,
    ).toBeDefined();
    expect(listed!.suggestedAction).toMatch(/Match Center/);
    // The regression this assertion exists for: the keyword chain would
    // otherwise answer with cron/endpoint advice for a study needing a link.
    expect(listed!.suggestedAction).not.toMatch(/cron|endpoint path/i);
  }, 30_000); // the endpoint probes Orthanc/OHIF/Weasis before it answers, and
  // on a CI runner every one of those hosts is absent, so the request costs its
  // probe timeouts (~3s each, ×2 here) rather than the few queries it makes.
});
