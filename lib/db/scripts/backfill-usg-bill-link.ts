/**
 * Owner-reviewed backfill: link ultrasound worklist rows that arrived before
 * intake started doing this itself.
 *
 * Every US study scanned before the intake fix landed is still sitting with
 * study_id NULL (measured 666 of 668 rows in a 7-day window), so the ERP
 * worklist and the Studio report no bill, test name, referring doctor or
 * demographics for them. This runs the same matcher intake now runs — unique
 * name/modality/date candidate or no link at all — over the historical rows.
 *
 * Rows are walked oldest-first on purpose: autoLinkBilledStudyForWorklist
 * excludes studies already claimed by another worklist row, so processing in
 * scan order lets each study be claimed once instead of twice.
 *
 * Default: DRY-RUN (prints what would be attempted, writes nothing).
 * Execute: pass --execute.
 * Bound the window: --days=14 (default).
 *
 * Run via care-migrate (compose manual profile):
 *   docker compose --profile manual run --rm care-migrate \
 *     pnpm --filter @workspace/db run usg-link:dry-run
 *   docker compose --profile manual run --rm care-migrate \
 *     pnpm --filter @workspace/db run usg-link:execute
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/index";
import { radiologyWorklistTable } from "../src/schema";

function daysWindow(): number {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const n = arg ? Number.parseInt(arg.slice("--days=".length), 10) : 14;
  return Number.isFinite(n) && n > 0 ? n : 14;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const days = daysWindow();
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`\n=== backfill-usg-bill-link (${mode}, last ${days} days) ===\n`);

  const rows = await db
    .select({
      worklistId: radiologyWorklistTable.id,
      patientName: radiologyWorklistTable.patientName,
      modality: radiologyWorklistTable.modality,
      studyDate: radiologyWorklistTable.studyDate,
      accessionNumber: radiologyWorklistTable.accessionNumber,
      studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
      createdAt: radiologyWorklistTable.createdAt,
    })
    .from(radiologyWorklistTable)
    .where(
      and(
        isNull(radiologyWorklistTable.studyId),
        sql`upper(${radiologyWorklistTable.modality}) similar to '%(US|USG|ULTRASOUND|DOPPLER)%'`,
        sql`${radiologyWorklistTable.createdAt} >= now() - make_interval(days => ${days})`,
      ),
    )
    .orderBy(asc(radiologyWorklistTable.createdAt));

  console.log(`Unlinked US worklist rows in window: ${rows.length}\n`);

  const { autoLinkBilledStudyForWorklist } = execute
    ? await import("../../../artifacts/api-server/src/lib/pacs/worklistBillingLink.ts")
    : { autoLinkBilledStudyForWorklist: null };

  let linked = 0;
  let refused = 0;
  let failed = 0;

  for (const r of rows) {
    const line = {
      worklistId: r.worklistId,
      patientName: r.patientName,
      modality: r.modality,
      studyDate: r.studyDate,
      accessionNumber: r.accessionNumber,
      studyInstanceUID: r.studyInstanceUID,
    };

    if (!execute || !autoLinkBilledStudyForWorklist) {
      console.log("[dry-run]", JSON.stringify(line));
      continue;
    }

    try {
      const result = await autoLinkBilledStudyForWorklist(r.worklistId, "backfill-usg-link");
      if (result.linked) {
        linked += 1;
        console.log("[linked]", JSON.stringify({ ...line, studyId: result.studyId, method: result.method }));
      } else {
        refused += 1;
        console.log("[refused]", result.reason, JSON.stringify(line));
      }
    } catch (err) {
      failed += 1;
      console.log("[fail]", err instanceof Error ? err.message : String(err), JSON.stringify(line));
    }
  }

  console.log(
    `\nDone. mode=${mode} scanned=${rows.length} linked=${linked} refused=${refused} failed=${failed}\n`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
