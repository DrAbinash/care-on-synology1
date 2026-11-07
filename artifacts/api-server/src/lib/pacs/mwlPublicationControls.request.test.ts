/**
 * A booked contrast line must not become a second worklist entry — but it must
 * not vanish from the machine's view either.
 *
 * Owner ruling 7 Nov 2026, measured first: over the 45 days to that date the
 * clinic published 20 `MRI CONTRAST` items, 10 CT contrast items, 4
 * `PEN DRIVE / CD STORAGE` and 2 `MRI BRAIN EMG` as their own worklist entries
 * on bills that were one appointment at one scanner. The study fan-out makes one
 * accession per order test, and publication has never had a per-test gate, so
 * every bookable line reached the machine whether or not it is an examination.
 *
 * These cases pin both halves of the fix: the suppressed line gets no worklist
 * item and keeps its bill row, and the parent's description still says contrast
 * is coming — a technologist who is not told can be handed the wrong protocol.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { db } from "@workspace/db";
import {
  billsTable,
  orderTestsTable,
  pacsSettingsTable,
  patientsTable,
  portalSessionsTable,
  radiologyScheduledProceduresTable,
  radiologyStudiesTable,
  testsTable,
  usersTable,
  ordersTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { createTestApp, hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { publishRadiologyStudyToMwl } from "./publishRadiologyStudyToMwl";
import {
  MWL_SUPPRESSED_TEST_IDS_KEY,
  isMwlPublicationSuppressedFor,
  loadMwlSuppressedTestIds,
  mwlWorklistRemovalRequired,
  planMwlWorklistSync,
  suppressedSiblingSuffix,
} from "./mwlPublicationControls";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

const PARENT_NAME = `MRI BRAIN ${RUN}`;
const CONTRAST_NAME = `MRI CONTRAST ${RUN}`;
const PARENT_CODE = `MWLS-${RUN}-P`;
const CONTRAST_CODE = `MWLS-${RUN}-C`;
// Deliberately short: the second withheld line has to be small enough that a
// mutant which folds it into the wrong entry actually fits the 64-byte field.
const FILM_CODE = `MWLS-${RUN}-F`;
const FILM_NAME = `FILM ${RUN.slice(0, 4)}`;

let parentTestId = 0;
let contrastTestId = 0;
let filmTestId = 0;
let orderId = 0;
let patientId = 0;
let billId = 0;
let addOnOrderId = 0;
// This suite rewrites a shared settings row. On a database that also holds
// another suite's fixtures, deleting it outright would break that suite, so it
// is put back exactly as it was found.
let defaultsBackup: { value: string | null } | undefined = undefined;

async function restoreMwlTestDefaults(): Promise<void> {
  await db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, "mwl_test_defaults"));
  if (defaultsBackup === undefined) return;
  await db
    .insert(pacsSettingsTable)
    .values({ key: "mwl_test_defaults", value: defaultsBackup.value, category: "mwl", isSecret: false });
}

async function setSuppressed(ids: number[]): Promise<void> {
  await db
    .delete(pacsSettingsTable)
    .where(eq(pacsSettingsTable.key, MWL_SUPPRESSED_TEST_IDS_KEY));
  await db.insert(pacsSettingsTable).values({
    key: MWL_SUPPRESSED_TEST_IDS_KEY,
    value: JSON.stringify(ids),
    category: "mwl",
    isSecret: false,
  });
}

async function readProcedure(accession: string) {
  const [row] = await db
    .select()
    .from(radiologyScheduledProceduresTable)
    .where(eq(radiologyScheduledProceduresTable.accessionNumber, accession))
    .limit(1);
  return row;
}

describe("isMwlPublicationSuppressedFor (pure)", () => {
  it("never withholds a line whose test it cannot name", () => {
    // Publishing is what has always happened. An unknown test id must not be
    // read as a reason to leave a scanner with nothing to do.
    expect(isMwlPublicationSuppressedFor(null, [7])).toBe(false);
    expect(isMwlPublicationSuppressedFor(undefined, [7])).toBe(false);
    expect(isMwlPublicationSuppressedFor(Number.NaN, [7])).toBe(false);
  });

  it("withholds exactly the listed ids", () => {
    expect(isMwlPublicationSuppressedFor(7, [3, 7])).toBe(true);
    expect(isMwlPublicationSuppressedFor(8, [3, 7])).toBe(false);
    expect(isMwlPublicationSuppressedFor(7, [])).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("MWL publication controls against the database", () => {
  beforeAll(async () => {
    const [patient] = await db
      .insert(patientsTable)
      .values({
        patientId: `MWLS-${RUN}-PT`,
        firstName: "Hemlata",
        lastName: `Barman ${RUN}`,
        dateOfBirth: "1988-06-11",
        gender: "female",
        ageValue: 35,
        ageUnit: "years",
        phone: "9000000004",
      })
      .returning();
    patientId = patient!.id;
    const [order] = await db
      .insert(ordersTable)
      .values({ orderNumber: `MWLS-${RUN}-O`, patientId, status: "completed" })
      .returning();
    orderId = order!.id;
    const [bill] = await db
      .insert(billsTable)
      .values({
        billNumber: `MWLS-${RUN}-B`,
        orderId,
        patientId,
        totalAmount: "9000",
        status: "paid",
      })
      .returning();
    billId = bill!.id;
    const inserted = await db
      .insert(testsTable)
      .values([
        { code: PARENT_CODE, name: PARENT_NAME, category: "Radiology", price: "7000", duration: "45", department: "MRI" },
        { code: CONTRAST_CODE, name: CONTRAST_NAME, category: "Radiology", price: "2000", duration: "5", department: "MRI" },
        { code: FILM_CODE, name: FILM_NAME, category: "Radiology", price: "100", duration: "5", department: "MRI" },
      ])
      .returning();
    parentTestId = inserted.find((t) => t.code === PARENT_CODE)!.id;
    contrastTestId = inserted.find((t) => t.code === CONTRAST_CODE)!.id;
    filmTestId = inserted.find((t) => t.code === FILM_CODE)!.id;
    await db
      .insert(orderTestsTable)
      .values([
        { orderId, testId: parentTestId, price: "7000" },
        { orderId, testId: contrastTestId, price: "2000" },
      ]);
    const [defaults] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, "mwl_test_defaults"))
      .limit(1);
    defaultsBackup = defaults ? { value: defaults.value } : undefined;
  }, 120_000);

  afterAll(async () => {
    const sweep: Array<() => Promise<unknown>> = [
      () => db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, MWL_SUPPRESSED_TEST_IDS_KEY)),
      restoreMwlTestDefaults,
      () => db.delete(radiologyStudiesTable).where(like(radiologyStudiesTable.accessionNumber, `MWLS-${RUN}%`)),
      () => db.delete(radiologyScheduledProceduresTable).where(like(radiologyScheduledProceduresTable.accessionNumber, `MWLS-${RUN}%`)),
      () => db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, addOnOrderId)),
      () => db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)),
      () => db.delete(billsTable).where(eq(billsTable.id, billId)),
      () => db.delete(ordersTable).where(eq(ordersTable.id, addOnOrderId)),
      () => db.delete(ordersTable).where(eq(ordersTable.id, orderId)),
      () => db.delete(testsTable).where(like(testsTable.code, `MWLS-${RUN}%`)),
      () => db.delete(patientsTable).where(eq(patientsTable.id, patientId)),
    ];
    for (const drop of sweep) {
      try {
        await drop();
      } catch {
        // Marker-scoped rows on a shared database; the next run uses a new marker.
      }
    }
  }, 120_000);

  it("reads the list back exactly as the settings tab writes it", async () => {
    await setSuppressed([contrastTestId]);
    expect(await loadMwlSuppressedTestIds()).toEqual([contrastTestId]);
  });

  it("folds the contrast line into the parent's description", async () => {
    await setSuppressed([contrastTestId]);
    const suffix = await suppressedSiblingSuffix(orderId, parentTestId, PARENT_NAME, [contrastTestId]);
    expect(suffix).toBe(` + ${CONTRAST_NAME}`);
  });

  it("adds nothing when the parent is itself the suppressed line", async () => {
    expect(await suppressedSiblingSuffix(orderId, contrastTestId, CONTRAST_NAME, [contrastTestId])).toBe("");
  });

  it("refuses a suffix that would not fit an LO field", async () => {
    // A long exam name must not be truncated into a different exam. The parent
    // keeps its own description and the add-on simply is not appended.
    const longParent = "M".repeat(60);
    expect(await suppressedSiblingSuffix(orderId, parentTestId, longParent, [contrastTestId])).toBe("");
  });

  it("publishes the parent with the folded description and withholds the contrast", async () => {
    await setSuppressed([contrastTestId]);
    const parentAcc = `MWLS-${RUN}-ACC1`;
    const contrastAcc = `MWLS-${RUN}-ACC2`;

    const parent = await publishRadiologyStudyToMwl({
      accessionNumber: parentAcc,
      patientId,
      billId,
      orderId,
      modality: "MR",
      procedureName: PARENT_NAME,
      studyDescription: PARENT_NAME,
      testId: parentTestId,
    });
    const contrast = await publishRadiologyStudyToMwl({
      accessionNumber: contrastAcc,
      patientId,
      billId,
      orderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });

    expect(parent.scheduled).toBe(true);
    expect(parent.suppressed).toBe(false);
    expect(contrast.suppressed).toBe(true);

    const parentRow = await readProcedure(parentAcc);
    expect(parentRow?.studyDescription).toBe(`${PARENT_NAME} + ${CONTRAST_NAME}`);

    // Withheld from the machine, kept on the bill: the charge and the reporting
    // entry are real, and a worklist switch must not be able to erase either.
    const contrastRow = await readProcedure(contrastAcc);
    expect(contrastRow).toBeDefined();
    expect(contrastRow?.studyDescription).toBe(CONTRAST_NAME);
    expect(contrastRow?.status).not.toBe("SENT_TO_MWL");
  });

  it("re-labels the parent when the contrast is added to a visit already on the machine", async () => {
    // The clinic's real sequence (owner, 7 Nov 2026): the MRI brain is billed and
    // published, and the contrast is added to that bill afterwards. Withholding
    // the contrast alone would leave the console reading "MRI BRAIN" for a
    // contrast patient.
    await setSuppressed([contrastTestId]);
    const [addOnOrder] = await db
      .insert(ordersTable)
      .values({ orderNumber: `MWLS-${RUN}-O2`, patientId, status: "completed" })
      .returning();
    addOnOrderId = addOnOrder!.id;
    const [brainOt] = await db
      .insert(orderTestsTable)
      .values({ orderId: addOnOrderId, testId: parentTestId, price: "7000" })
      .returning();

    const parentAcc = `MWLS-${RUN}-ADD1`;
    await db.insert(radiologyStudiesTable).values({
      accessionNumber: parentAcc,
      billId,
      orderId: addOnOrderId,
      orderTestId: brainOt!.id,
      patientId,
      testId: parentTestId,
      modality: "MR",
      department: "MRI",
      studyDescription: PARENT_NAME,
    });
    await publishRadiologyStudyToMwl({
      accessionNumber: parentAcc,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: PARENT_NAME,
      studyDescription: PARENT_NAME,
      testId: parentTestId,
    });
    expect((await readProcedure(parentAcc))?.studyDescription).toBe(PARENT_NAME);

    // Now the contrast line joins the same visit.
    const [contrastOt] = await db
      .insert(orderTestsTable)
      .values({ orderId: addOnOrderId, testId: contrastTestId, price: "2000" })
      .returning();
    const contrastAcc = `MWLS-${RUN}-ADD2`;
    await db.insert(radiologyStudiesTable).values({
      accessionNumber: contrastAcc,
      billId,
      orderId: addOnOrderId,
      orderTestId: contrastOt!.id,
      patientId,
      testId: contrastTestId,
      modality: "MR",
      department: "MRI",
      studyDescription: CONTRAST_NAME,
    });
    const contrast = await publishRadiologyStudyToMwl({
      accessionNumber: contrastAcc,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });

    expect(contrast.suppressed).toBe(true);
    expect((await readProcedure(parentAcc))?.studyDescription).toBe(`${PARENT_NAME} + ${CONTRAST_NAME}`);
    // One entry, not two: the add-on line stays off the machine.
    expect((await readProcedure(contrastAcc))?.status).not.toBe("SENT_TO_MWL");
  });

  it("does not append the note twice when the same contrast is booked again", async () => {
    // Re-billing, a reconciliation sweep and an operator pressing Save twice all
    // re-publish; none of them may turn "MRI BRAIN + MRI CONTRAST" into a
    // three-part string the LO field cannot hold.
    const parentAcc = `MWLS-${RUN}-ADD1`;
    const contrastAcc = `MWLS-${RUN}-ADD2`;
    await publishRadiologyStudyToMwl({
      accessionNumber: contrastAcc,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });
    const description = (await readProcedure(parentAcc))?.studyDescription ?? "";
    expect(description).toBe(`${PARENT_NAME} + ${CONTRAST_NAME}`);
    expect(description.split(CONTRAST_NAME).length - 1).toBe(1);

    // And it must not rewrite the entry at all: a scanner that already pulled
    // this item should not have the file swapped under it on every re-billing.
    const before = await readProcedure(parentAcc);
    await publishRadiologyStudyToMwl({
      accessionNumber: contrastAcc,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });
    const after = await readProcedure(parentAcc);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it("never re-labels an entry that has already been scanned or cancelled", async () => {
    // A completed brain study is off the console; rewriting its label would mean
    // publishing to a machine for an examination that is over.
    await setSuppressed([contrastTestId]);
    const parentAcc = `MWLS-${RUN}-ADD1`;
    await db
      .update(radiologyScheduledProceduresTable)
      .set({ status: "COMPLETED", studyDescription: PARENT_NAME })
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, parentAcc));

    const contrast = await publishRadiologyStudyToMwl({
      accessionNumber: `MWLS-${RUN}-ADD3`,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });
    expect(contrast.suppressed).toBe(true);

    const row = await readProcedure(parentAcc);
    expect(row?.studyDescription).toBe(PARENT_NAME);
    expect(row?.status).toBe("COMPLETED");
  });

  it("rebuilds the label from the study's own name, not from whatever it currently says", async () => {
    // The label is derived, never appended. Anything else drifts: re-billing a
    // visit three times would read "… + CONTRAST + CONTRAST + CONTRAST".
    await setSuppressed([contrastTestId]);
    const parentAcc = `MWLS-${RUN}-ADD1`;
    await db
      .update(radiologyScheduledProceduresTable)
      .set({ studyDescription: `STALE ${RUN.slice(0, 4)}`, status: "SCHEDULED" })
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, parentAcc));

    await publishRadiologyStudyToMwl({
      accessionNumber: `MWLS-${RUN}-ADD2`,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });

    expect((await readProcedure(parentAcc))?.studyDescription).toBe(
      `${PARENT_NAME} + ${CONTRAST_NAME}`,
    );
  });

  it("leaves a withheld line's own entry un-annotated when several lines are withheld", async () => {
    // A pen-drive line is not an examination, and it is not made one by naming
    // another non-examination beside it.
    await setSuppressed([contrastTestId, filmTestId]);
    const parentAcc = `MWLS-${RUN}-ADD1`;
    await db
      .update(radiologyScheduledProceduresTable)
      .set({ studyDescription: PARENT_NAME, status: "SCHEDULED" })
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, parentAcc));

    const [filmOt] = await db
      .insert(orderTestsTable)
      .values({ orderId: addOnOrderId, testId: filmTestId, price: "100" })
      .returning();
    const filmAcc = `MWLS-${RUN}-ADD5`;
    await db.insert(radiologyStudiesTable).values({
      accessionNumber: filmAcc,
      billId,
      orderId: addOnOrderId,
      orderTestId: filmOt!.id,
      patientId,
      testId: filmTestId,
      modality: "MR",
      department: "MRI",
      studyDescription: FILM_NAME,
    });
    await publishRadiologyStudyToMwl({
      accessionNumber: filmAcc,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: FILM_NAME,
      studyDescription: FILM_NAME,
      testId: filmTestId,
    });
    expect((await readProcedure(filmAcc))?.studyDescription).toBe(FILM_NAME);

    await publishRadiologyStudyToMwl({
      accessionNumber: `MWLS-${RUN}-ADD2`,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });

    // The examination entry carries both add-ons; neither withheld entry names
    // the other.
    expect((await readProcedure(parentAcc))?.studyDescription).toBe(
      `${PARENT_NAME} + ${CONTRAST_NAME} + ${FILM_NAME}`,
    );
    expect((await readProcedure(filmAcc))?.studyDescription).toBe(FILM_NAME);
    expect((await readProcedure(`MWLS-${RUN}-ADD2`))?.studyDescription).toBe(CONTRAST_NAME);
  });

  it("keeps the note that fits when a later add-on would overflow the LO field", async () => {
    // The clinic's long catalogue names are the risk here: a 40-character film
    // storage line must not silence the word CONTRAST on the MRI entry.
    const longFilmName = `FILM ${RUN} STORAGE AND PRINT COPY FOR PATIENT`;
    await db.update(testsTable).set({ name: longFilmName }).where(eq(testsTable.id, filmTestId));
    await setSuppressed([contrastTestId, filmTestId]);

    await publishRadiologyStudyToMwl({
      accessionNumber: `MWLS-${RUN}-ADD2`,
      patientId,
      billId,
      orderId: addOnOrderId,
      modality: "MR",
      procedureName: CONTRAST_NAME,
      studyDescription: CONTRAST_NAME,
      testId: contrastTestId,
    });

    const parent = (await readProcedure(`MWLS-${RUN}-ADD1`))?.studyDescription ?? "";
    expect(parent).toBe(`${PARENT_NAME} + ${CONTRAST_NAME}`);
    expect(Buffer.byteLength(parent, "utf8")).toBeLessThanOrEqual(64);
    await db.update(testsTable).set({ name: FILM_NAME }).where(eq(testsTable.id, filmTestId));
  });

  it("changes nothing when the list is empty", async () => {
    await setSuppressed([]);
    const acc = `MWLS-${RUN}-ACC3`;
    const result = await publishRadiologyStudyToMwl({
      accessionNumber: acc,
      patientId,
      billId,
      orderId,
      modality: "MR",
      procedureName: PARENT_NAME,
      studyDescription: PARENT_NAME,
      testId: parentTestId,
    });
    expect(result.suppressed).toBe(false);
    const row = await readProcedure(acc);
    expect(row?.studyDescription).toBe(PARENT_NAME);
  });

  it("takes the body part from the per-test default when the bill has none", async () => {
    await setSuppressed([]);
    await db
      .delete(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, "mwl_test_defaults"));
    await db.insert(pacsSettingsTable).values({
      key: "mwl_test_defaults",
      // The store the MWL tab already writes: { "<testId>": { bodyPart, stationAE } }.
      value: JSON.stringify({ [String(parentTestId)]: { bodyPart: "HEAD", stationAE: "" } }),
      category: "mwl",
      isSecret: false,
    });

    const acc = `MWLS-${RUN}-ACC5`;
    await publishRadiologyStudyToMwl({
      accessionNumber: acc,
      patientId,
      billId,
      orderId,
      modality: "MR",
      studyDescription: PARENT_NAME,
      testId: parentTestId,
      // No bodyPart from the desk — measured as empty on 0 of 735 MRI studies,
      // so the per-test default is the only place the console can get it from.
    });

    const row = await readProcedure(acc);
    expect(row?.bodyPartExamined).toBe("HEAD");
  });

  it("leaves the description alone when the caller gives no test id", async () => {
    // The fan-out always passes one; a caller that does not must not get a
    // withheld entry or a guessed suffix.
    await setSuppressed([contrastTestId]);
    const acc = `MWLS-${RUN}-ACC4`;
    const result = await publishRadiologyStudyToMwl({
      accessionNumber: acc,
      patientId,
      billId,
      orderId,
      modality: "MR",
      studyDescription: PARENT_NAME,
    });
    expect(result.suppressed).toBe(false);
    expect((await readProcedure(acc))?.studyDescription).toBe(PARENT_NAME);
  });

  it("tells Sync exactly which of these entries may be on a machine", async () => {
    // The regression this pins: `POST /mwl-worklist/sync` regenerates the whole
    // folder from the procedure table, which stores no test id. Before this
    // decision existed, pressing Sync re-created every withheld entry on the
    // scanner while the settings tab still said it was off.
    await setSuppressed([contrastTestId, filmTestId]);
    const rows = await db
      .select({
        accessionNumber: radiologyScheduledProceduresTable.accessionNumber,
        status: radiologyScheduledProceduresTable.status,
      })
      .from(radiologyScheduledProceduresTable)
      .where(like(radiologyScheduledProceduresTable.accessionNumber, `MWLS-${RUN}-ADD%`));

    const plan = await planMwlWorklistSync(rows);
    // The brain examination publishes, and so does the accession with no study
    // row behind it (ADD3): an unknown is never read as a reason to withhold.
    expect(plan.write.slice().sort()).toEqual([`MWLS-${RUN}-ADD1`, `MWLS-${RUN}-ADD3`].sort());
    expect(plan.remove.slice().sort()).toEqual([`MWLS-${RUN}-ADD2`, `MWLS-${RUN}-ADD5`].sort());
  });

  it("counts a finished entry as one to remove even when nothing is withheld", async () => {
    await setSuppressed([]);
    const acc3 = `MWLS-${RUN}-ADD3`;
    await db
      .update(radiologyScheduledProceduresTable)
      .set({ status: "COMPLETED" })
      .where(eq(radiologyScheduledProceduresTable.accessionNumber, acc3));
    expect(await mwlWorklistRemovalRequired(acc3, "COMPLETED")).toBe(true);
    const plan = await planMwlWorklistSync([{ accessionNumber: acc3, status: "COMPLETED" }]);
    expect(plan.remove).toEqual([acc3]);
    expect(plan.write).toEqual([]);
  });

  it("answers the single-row question the same way the batch planner does", async () => {
    await setSuppressed([contrastTestId, filmTestId]);
    expect(await mwlWorklistRemovalRequired(`MWLS-${RUN}-ADD2`, "SCHEDULED")).toBe(true);
    expect(await mwlWorklistRemovalRequired(`MWLS-${RUN}-ADD1`, "SCHEDULED")).toBe(false);
    expect(await mwlWorklistRemovalRequired(`MWLS-${RUN}-ADD1`, "CANCELLED")).toBe(true);
    // An accession with no study row is publishable, not withheld.
    expect(await mwlWorklistRemovalRequired(`MWLS-${RUN}-ADD3`, "SCHEDULED")).toBe(false);
    // Nothing to act on is not a reason to touch a file.
    expect(await mwlWorklistRemovalRequired("", "SCHEDULED")).toBe(false);
    expect(await mwlWorklistRemovalRequired(null, "SCHEDULED")).toBe(false);
  });

  it("a Sync press removes a withheld entry instead of re-creating it", async () => {
    // The leg the planner exists for. `POST /api/radiology/mwl-worklist/sync`
    // regenerates the whole worklist folder from radiology_scheduled_procedures,
    // which stores no test id — so until every write path asked the withheld
    // list, pressing Sync put the MRI contrast entry back on the scanner while
    // the settings tab still said it was off. A grep of the route cannot see that.
    const dir = await mkdtemp(path.join(os.tmpdir(), `mwl-sync-${RUN}-`));
    const previousDir = process.env.ORTHANC_WORKLIST_DIR;
    const username = `mwl-sync-${RUN}`;
    const token = `vitest-${username}`;
    let userId = 0;
    process.env.ORTHANC_WORKLIST_DIR = dir;
    try {
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `MWL Sync ${RUN}`,
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
        token,
        scope: "staff",
        subjectId: userId,
        subjectName: user!.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await setSuppressed([contrastTestId, filmTestId]);

      const withheldFile = path.join(dir, `MWLS-${RUN}-ADD2.wl`);
      const publishedFile = path.join(dir, `MWLS-${RUN}-ADD1.wl`);
      await writeFile(withheldFile, "an entry from before the tick was ever clicked");
      await writeFile(publishedFile, "an examination the scanner is waiting for");

      const app = await createTestApp();
      const res = await request(app)
        .post("/api/radiology/mwl-worklist/sync")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.removed).toBeGreaterThanOrEqual(1);
      expect(existsSync(withheldFile)).toBe(false);
      expect(existsSync(publishedFile)).toBe(true);
    } finally {
      if (previousDir === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
      else process.env.ORTHANC_WORKLIST_DIR = previousDir;
      try {
        await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
        if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
      } catch {
        // Marker-scoped rows; the next run uses a new marker.
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
