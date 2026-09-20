/**
 * Owner-reviewed one-off: stamp blank Orthanc AccessionNumber on USG studies
 * from matching bills (same single-hit rule as STAMP_ACCESSION_FROM_BILL).
 *
 * Default: DRY-RUN (prints candidate pairs).
 * Execute: pass --execute (requires STAMP_ACCESSION_FROM_BILL enabled).
 *
 * Run via care-migrate (compose manual profile):
 *   docker compose --profile manual run --rm care-migrate \
 *     pnpm --filter @workspace/db run stamp-accession:dry-run
 *   docker compose --profile manual run --rm care-migrate \
 *     pnpm --filter @workspace/db run stamp-accession:execute
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../src/index";
import {
  billsTable,
  patientsTable,
  radiologyStudiesTable,
} from "../src/schema";

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`\n=== stamp-blank-accession-usg (${mode}) ===\n`);

  const stampMod = await import(
    "../../../artifacts/api-server/src/lib/pacs/stampAccessionFromBill.ts"
  );
  const { stampBlankAccessionForBill, isStampAccessionEnabled } = stampMod;

  if (execute && !(await isStampAccessionEnabled())) {
    console.error(
      "Refusing execute: enable STAMP_ACCESSION_FROM_BILL (env=true or feature_flags) first.",
    );
    process.exit(2);
  }

  const studies = await db
    .select({
      studyId: radiologyStudiesTable.id,
      modality: radiologyStudiesTable.modality,
      studyDate: radiologyStudiesTable.studyDate,
      billId: radiologyStudiesTable.billId,
      billNumber: billsTable.billNumber,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
    })
    .from(radiologyStudiesTable)
    .innerJoin(billsTable, eq(radiologyStudiesTable.billId, billsTable.id))
    .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .where(
      and(
        ne(radiologyStudiesTable.status, "cancelled"),
        ne(billsTable.status, "cancelled"),
        sql`upper(${radiologyStudiesTable.modality}) similar to '%(US|USG|ULTRASOUND|DOPPLER)%'`,
      ),
    );

  console.log(`Candidates from ERP radiology_studies (USG + billed): ${studies.length}\n`);

  let stamped = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of studies) {
    if (s.billId == null || !s.billNumber) {
      skipped += 1;
      continue;
    }
    const patientName = `${s.patientFirstName ?? ""} ${s.patientLastName ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    const line = {
      studyId: s.studyId,
      billNumber: s.billNumber,
      patientName,
      modality: s.modality,
      studyDate: s.studyDate,
    };

    if (!execute) {
      console.log("[dry-run]", JSON.stringify(line));
      continue;
    }

    const result = await stampBlankAccessionForBill({
      billId: s.billId,
      billNumber: s.billNumber,
      patientName,
      modality: s.modality,
      studyDate: s.studyDate || new Date().toISOString().slice(0, 10),
    });

    if (result.ok && result.stamped) {
      stamped += 1;
      console.log("[stamped]", JSON.stringify({ ...line, studyUid: result.studyUid }));
    } else if (result.ok) {
      skipped += 1;
      console.log("[skip]", result.reason, JSON.stringify(line));
    } else {
      failed += 1;
      console.log("[fail]", result.error, JSON.stringify(line));
    }
  }

  console.log(
    `\nDone. mode=${mode} scanned=${studies.length} stamped=${stamped} skipped=${skipped} failed=${failed}\n`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
