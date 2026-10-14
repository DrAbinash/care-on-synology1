#!/usr/bin/env node
/**
 * audit-external-result-links.mjs — read-only duplicate/association audit for
 * external_result_links (PR-I6).
 *
 * WHY THIS EXISTS
 *   migrations/zzzzzzzzzzzzzzzzzz_external_result_links_referral_report_uq.sql adds
 *   UNIQUE(referral_id, care_report_id). On a database that already contains
 *   duplicates the migration refuses to proceed (by design — see its header), so an
 *   operator needs a way to find out BEFORE scheduling the patch what is there and
 *   how big it is. This script answers exactly that and nothing else: it issues
 *   SELECTs only, writes nothing, and never picks a winner.
 *
 * IT IS READ-ONLY BY CONSTRUCTION
 *   Every statement is a SELECT, and each one runs inside its own
 *   `BEGIN READ ONLY … ROLLBACK` transaction, so an accidental write in this file
 *   would abort rather than land. It takes no lock beyond the shared reads Postgres
 *   already takes for any query.
 *
 * NO PHI IS PRINTED
 *   Output is counts, numeric row ids and internal status strings. Patient names,
 *   report titles, impressions, phone numbers and document ids are never selected.
 *   The one text column read is `report_status`, an enum-like workflow value.
 *
 * USAGE
 *   DATABASE_URL=postgres://user:pass@host:5432/care node scripts/audit-external-result-links.mjs
 *
 * It prints the database it connected to and the row count it scanned, so an operator
 * can see at a glance that they are pointed where they meant to be. It does not
 * connect to any production host on its own and is not run by CI, by any deploy
 * script, or by the test suite.
 */
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { Client } = require_("pg");

const QUERIES = [
  {
    key: "total_rows",
    label: "Rows in external_result_links (all shapes)",
    sql: `SELECT count(*)::int AS n FROM external_result_links`,
  },
  {
    key: "duplicate_referral_report",
    label: "Duplicate (referral_id, care_report_id) groups — THE BLOCKER for the new UNIQUE",
    sql: `SELECT count(*)::int AS groups, coalesce(sum(n),0)::int AS rows
          FROM (SELECT referral_id, care_report_id, count(*)::int AS n
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL
                 GROUP BY referral_id, care_report_id HAVING count(*) > 1) d`,
    detail: `SELECT referral_id, care_report_id, count(*)::int AS n,
                    array_agg(id ORDER BY id)::int[] AS link_ids,
                    array_agg(DISTINCT report_status ORDER BY report_status)::text[] AS report_statuses,
                    count(delivered_at)::int AS delivered_rows,
                    array_agg(DISTINCT coalesce(critical_ack_status,'-'))::text[] AS ack_states
               FROM external_result_links
              WHERE care_report_id IS NOT NULL
              GROUP BY referral_id, care_report_id HAVING count(*) > 1
              ORDER BY n DESC, referral_id LIMIT 20`,
  },
  {
    key: "duplicate_item_report",
    label: "Duplicate (referral_item_id, care_report_id) groups — already blocked by the existing index",
    sql: `SELECT count(*)::int AS groups FROM (SELECT referral_item_id, care_report_id
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL AND referral_item_id IS NOT NULL
                 GROUP BY referral_item_id, care_report_id HAVING count(*) > 1) d`,
  },
  {
    key: "itemless_duplicates",
    label: "Item-less links (referral_item_id IS NULL) that are duplicated by report",
    sql: `SELECT count(*)::int AS groups, coalesce(sum(n),0)::int AS rows
          FROM (SELECT referral_id, care_report_id, count(*)::int AS n
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL AND referral_item_id IS NULL
                 GROUP BY referral_id, care_report_id HAVING count(*) > 1) d`,
  },
  {
    key: "same_report_many_items",
    label: "One (referral, report) reached through more than one item — the cross-item shape",
    sql: `SELECT count(*)::int AS groups FROM (SELECT referral_id, care_report_id
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL AND referral_item_id IS NOT NULL
                 GROUP BY referral_id, care_report_id HAVING count(DISTINCT referral_item_id) > 1) d`,
  },
  {
    key: "report_in_conflicting_referrals",
    label: "A report linked to more than one referral (informational — may be legitimate if two referrals reference the same CARE order)",
    sql: `SELECT count(*)::int AS reports, coalesce(sum(refs),0)::int AS links
          FROM (SELECT care_report_id, count(DISTINCT referral_id)::int AS refs
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL
                 GROUP BY care_report_id HAVING count(DISTINCT referral_id) > 1) d`,
    detail: `SELECT l.care_report_id,
                    count(DISTINCT l.referral_id)::int AS referrals,
                    array_agg(DISTINCT l.referral_id ORDER BY l.referral_id)::int[] AS referral_ids,
                    count(DISTINCT r.care_order_id)::int AS distinct_care_orders
               FROM external_result_links l
               JOIN diagnostic_referrals r ON r.id = l.referral_id
              WHERE l.care_report_id IS NOT NULL
              GROUP BY l.care_report_id HAVING count(DISTINCT l.referral_id) > 1
              ORDER BY referrals DESC, l.care_report_id LIMIT 20`,
  },
  {
    key: "report_in_conflicting_patients",
    label: "A report linked to referrals carrying different source_patient_id — potential wrong-patient association",
    sql: `SELECT count(*)::int AS reports FROM (
            SELECT l.care_report_id
              FROM external_result_links l
              JOIN diagnostic_referrals r ON r.id = l.referral_id
             WHERE l.care_report_id IS NOT NULL
             GROUP BY l.care_report_id
            HAVING count(DISTINCT coalesce(r.source_patient_id,'')) > 1) d`,
    detail: `SELECT l.care_report_id, count(DISTINCT l.referral_id)::int AS referrals,
                    count(DISTINCT coalesce(r.source_patient_id,''))::int AS distinct_patient_keys
               FROM external_result_links l
               JOIN diagnostic_referrals r ON r.id = l.referral_id
              WHERE l.care_report_id IS NOT NULL
              GROUP BY l.care_report_id
             HAVING count(DISTINCT coalesce(r.source_patient_id,'')) > 1
             ORDER BY distinct_patient_keys DESC, l.care_report_id LIMIT 20`,
  },
  {
    key: "orphan_reports",
    label: "Links whose care_report_id names a patient_reports row that does not exist (no FK on this column)",
    sql: `SELECT count(*)::int AS n FROM external_result_links l
          WHERE l.care_report_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = l.care_report_id)`,
  },
  {
    key: "item_referral_mismatch",
    label: "Links whose referral_item_id belongs to a DIFFERENT referral than the link's own referral_id",
    sql: `SELECT count(*)::int AS n FROM external_result_links l
          JOIN diagnostic_referral_items i ON i.id = l.referral_item_id
          WHERE l.referral_id <> i.referral_id`,
  },
  {
    key: "amended_without_chain",
    label: "Links marked report_status='amended' whose report has no patient_report_amendments row",
    sql: `SELECT count(*)::int AS n FROM external_result_links l
          WHERE l.report_status = 'amended'
            AND l.care_report_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM patient_report_amendments a WHERE a.amended_report_id = l.care_report_id)`,
  },
  {
    key: "never_emitted",
    label: "Links with no outbox event — recorded but never sent to any partner",
    sql: `SELECT count(*)::int AS n FROM external_result_links WHERE emitted_outbox_id IS NULL`,
  },
  {
    key: "ack_split",
    label: "Duplicate pairs where one row is acknowledged and its twin is not — the escalation-loop shape",
    sql: `SELECT count(*)::int AS groups
          FROM (SELECT referral_id, care_report_id
                  FROM external_result_links
                 WHERE care_report_id IS NOT NULL
                 GROUP BY referral_id, care_report_id
                HAVING count(*) FILTER (WHERE critical_ack_status = 'acknowledged') > 0
                   AND count(*) FILTER (WHERE critical_ack_status IS DISTINCT FROM 'acknowledged') > 0) d`,
  },
];

const fmt = (v) => (typeof v === "number" ? String(v) : JSON.stringify(v));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. This audit reads one database and never guesses which.");
    process.exit(2);
  }
  const client = new Client({ connectionString: url, statement_timeout: 60_000 });
  await client.connect();

  const id = await client.query(
    `SELECT current_database() AS db, current_setting('server_version') AS ver,
            (SELECT count(*)::int FROM external_result_links) AS rows`);
  console.log(`READ-ONLY AUDIT — external_result_links`);
  console.log(`database=${id.rows[0].db}  postgres=${id.rows[0].ver}  rows=${id.rows[0].rows}`);
  console.log(`no writes are issued by this script; nothing is deleted, merged or rewritten\n`);

  // The index this audit exists to predict.
  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE tablename='external_result_links' ORDER BY 1`);
  const hasNew = idx.rows.some((r) => r.indexname === "external_result_links_referral_report_uidx");
  console.log(`unique indexes present: ${idx.rows.map((r) => r.indexname).join(", ")}\n`);

  const summary = [];
  for (const q of QUERIES) {
    // Each statement runs in its own read-only transaction, so a mistake in this
    // file could not write even if it tried.
    await client.query("BEGIN READ ONLY");
    let value;
    try {
      const res = await client.query(q.sql);
      value = res.rows[0] ?? {};
      summary.push({ key: q.key, label: q.label, value });
      console.log(`· ${q.label}`);
      console.log(`    ${Object.entries(value).map(([k, v]) => `${k}=${fmt(v)}`).join("  ")}`);
      if (q.detail && Number(value.groups ?? value.reports ?? value.n ?? 0) > 0) {
        const d = await client.query(q.detail);
        for (const row of d.rows) console.log(`      - ${JSON.stringify(row)}`);
      }
    } finally {
      await client.query("ROLLBACK");
    }
  }

  // Read the blocker count straight out of the collected rows. An earlier version of
  // this line asked for a query result object where the value already IS the row, got
  // `undefined`, defaulted to 0 and printed "no duplicates" against a database that
  // had one — an audit whose all-clear is unreliable is worse than no audit.
  const blockers = Number(summary.find((s) => s.key === "duplicate_referral_report")?.value?.groups ?? -1);
  if (blockers < 0) {
    console.log("\n=== verdict\nCOULD NOT DETERMINE: the duplicate query did not report a count. Treat this as unknown, not as clean.");
    await client.end();
    process.exit(1);
  }
  console.log(`\n=== verdict`);
  if (hasNew) {
    console.log(`UNIQUE(referral_id, care_report_id) is ALREADY present on this database, so the duplicate counts above `
      + `describe what the constraint permits now — they are not evidence about the state before it was added.`);
  } else if (blockers > 0) {
    console.log(`${blockers} duplicate (referral_id, care_report_id) group(s) exist. `
      + "The migration WILL refuse until each pair is reconciled by hand — a duplicate link row may hold a "
      + "critical-result acknowledgement a clinician already made, so no script chooses which row survives.");
  } else {
    console.log("No duplicates found: the constraint can be added without touching a single existing row.");
  }
  await client.end();
}

main().catch((e) => { console.error("audit failed:", String(e.message).split("\n")[0]); process.exit(1); });
