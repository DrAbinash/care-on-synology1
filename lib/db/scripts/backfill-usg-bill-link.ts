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
 * Three modes, all bounded by --days (default 14 — the backlog goes back
 * months, so pass an explicit window, e.g. --days=120):
 *
 *   --preview  RUNS THE REAL MATCHER and reports what it decided, writing
 *              nothing. This is the mode that answers "how many will link".
 *   --execute  Runs the same cascade and writes it.
 *   (default)  Lists the rows in scope. It does NOT run the matcher and always
 *              reports linked=0 refused=0 — it is a census, not a preview, and
 *              reading its zeros as "nothing would link" is a trap.
 *
 * --preview and --execute together is an error: one is the rehearsal of the
 * other, and running both at once would make the rehearsal's output a lie
 * about rows the run had already consumed.
 *
 * Run via the `migrate` service (compose *service* name; `care-migrate` is only
 * its container_name, and the image must be rebuilt after a pull because a
 * service-scoped `up -d --build care-api` does not rebuild it):
 *   docker compose build migrate
 *   docker compose --profile manual run --rm migrate \
 *     pnpm --filter @workspace/db run usg-link:preview
 *   docker compose --profile manual run --rm migrate \
 *     pnpm --filter @workspace/db run usg-link:dry-run
 *   docker compose --profile manual run --rm migrate \
 *     pnpm --filter @workspace/db run usg-link:execute
 *
 * Not care-db-patch-v2: that container is bare postgres:16-alpine with only the
 * SQL migration directories mounted — it has no Node and no repo source.
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
  const preview = process.argv.includes("--preview");
  if (execute && preview) {
    console.error(
      "--preview and --execute are mutually exclusive: the preview is only meaningful against rows the run has not already consumed.",
    );
    process.exit(2);
  }
  // Only `execute` and `preview` run the matcher. The bare invocation lists.
  const runMatcher = execute || preview;
  const days = daysWindow();
  const mode = execute ? "EXECUTE" : preview ? "PREVIEW" : "LISTING";
  const actor = preview ? "backfill-usg-link:preview" : "backfill-usg-link";
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

  const { autoLinkBilledStudyForWorklist } = runMatcher
    ? await import("../../../artifacts/api-server/src/lib/pacs/worklistBillingLink.ts")
    : { autoLinkBilledStudyForWorklist: null };

  let linked = 0;
  let alreadyLinked = 0;
  let contended = 0;
  let refused = 0;
  let failed = 0;
  // Preview writes nothing, so it cannot mark a candidate consumed. Two worklist
  // rows that both decide the same study would each report "would link" while a
  // real run links the first and refuses the second. Tracking which studies the
  // preview has already promised lets the tally report that overlap instead of
  // quietly inflating the headline number.
  const previewClaimed = new Set<number>();
  const byLane = new Map<string, number>();
  const byReason = new Map<string, number>();

  for (const r of rows) {
    const line = {
      worklistId: r.worklistId,
      patientName: r.patientName,
      modality: r.modality,
      studyDate: r.studyDate,
      accessionNumber: r.accessionNumber,
      studyInstanceUID: r.studyInstanceUID,
    };

    if (!runMatcher || !autoLinkBilledStudyForWorklist) {
      console.log("[in-scope]", JSON.stringify(line));
      continue;
    }

    try {
      const result = await autoLinkBilledStudyForWorklist(r.worklistId, actor, { preview });
      if (result.linked && result.reason === "already linked") {
        // A row the window query thought was unlinked. Counted apart so the
        // tally answers "what will this backfill add", not "what is linked".
        alreadyLinked += 1;
        console.log(`[${preview ? "would-skip" : "skipped"}] already linked ${JSON.stringify(line)}`);
      } else if (result.linked) {
        const promised = preview && result.studyId != null && previewClaimed.has(result.studyId);
        if (promised) {
          contended += 1;
          console.log("[contended]", JSON.stringify({ ...line, studyId: result.studyId }));
        } else {
          linked += 1;
          if (preview && result.studyId != null) previewClaimed.add(result.studyId);
          const lane = result.method ?? "unknown";
          byLane.set(lane, (byLane.get(lane) ?? 0) + 1);
          console.log(
            preview ? "[would-link]" : "[linked]",
            JSON.stringify({
              ...line,
              studyId: result.studyId,
              method: result.method,
              matchPoints: result.matchPoints,
              matchScore: result.matchScore,
            }),
          );
        }
      } else {
        refused += 1;
        const reason = result.reason ?? "unspecified";
        byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
        console.log(preview ? "[would-refuse]" : "[refused]", reason, JSON.stringify(line));
      }
    } catch (err) {
      failed += 1;
      console.log("[fail]", err instanceof Error ? err.message : String(err), JSON.stringify(line));
    }
  }

  console.log(
    `\nDone. mode=${mode} scanned=${rows.length} ${preview ? "wouldLink" : "linked"}=${linked}` +
      ` contended=${contended} alreadyLinked=${alreadyLinked} refused=${refused} failed=${failed}\n`,
  );
  if (preview && contended > 0) {
    console.log(
      `Note: ${contended} row(s) decided a study an earlier row already claimed. A real run links the first` +
        ` and refuses the rest, so the expected gain is ${linked}, not ${linked + contended}.\n`,
    );
  }

  if (byLane.size > 0) {
    console.log(preview ? "Would link, by lane:" : "Linked, by lane:");
    for (const [lane, n] of [...byLane.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(6)}  ${lane}`);
    }
    console.log("");
  }
  if (byReason.size > 0) {
    console.log("Refusals, by reason:");
    for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(6)}  ${reason}`);
    }
    console.log("");
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
