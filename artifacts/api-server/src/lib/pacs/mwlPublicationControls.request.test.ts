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
import { db } from "@workspace/db";
import {
  billsTable,
  orderTestsTable,
  pacsSettingsTable,
  patientsTable,
  radiologyScheduledProceduresTable,
  testsTable,
  ordersTable,
} from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { hasDatabaseUrl } from "../../testSupport/apiTestApp";
import { publishRadiologyStudyToMwl } from "./publishRadiologyStudyToMwl";
import {
  MWL_SUPPRESSED_TEST_IDS_KEY,
  isMwlPublicationSuppressedFor,
  loadMwlSuppressedTestIds,
  suppressedSiblingSuffix,
} from "./mwlPublicationControls";

const dbAvailable = hasDatabaseUrl();
const RUN = randomUUID().slice(0, 8);

const PARENT_NAME = `MRI BRAIN ${RUN}`;
const CONTRAST_NAME = `MRI CONTRAST ${RUN}`;
const PARENT_CODE = `MWLS-${RUN}-P`;
const CONTRAST_CODE = `MWLS-${RUN}-C`;

let parentTestId = 0;
let contrastTestId = 0;
let orderId = 0;
let patientId = 0;
let billId = 0;

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
      ])
      .returning();
    parentTestId = inserted.find((t) => t.code === PARENT_CODE)!.id;
    contrastTestId = inserted.find((t) => t.code === CONTRAST_CODE)!.id;
    await db
      .insert(orderTestsTable)
      .values([
        { orderId, testId: parentTestId, price: "7000" },
        { orderId, testId: contrastTestId, price: "2000" },
      ]);
  }, 120_000);

  afterAll(async () => {
    const sweep: Array<() => Promise<unknown>> = [
      () => db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.key, MWL_SUPPRESSED_TEST_IDS_KEY)),
      () => db.delete(radiologyScheduledProceduresTable).where(like(radiologyScheduledProceduresTable.accessionNumber, `MWLS-${RUN}%`)),
      () => db.delete(orderTestsTable).where(eq(orderTestsTable.orderId, orderId)),
      () => db.delete(billsTable).where(eq(billsTable.id, billId)),
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
});
