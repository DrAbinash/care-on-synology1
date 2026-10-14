-- External result links — database-level identity for HOPE result links
-- ============================================================================
-- ONE HOPE referral ↔ ONE CARE signed report: AT MOST ONE result link.
--
-- Semantics:
--   `external_result_links` is the row that says "this signed CARE report has been
--   delivered against this HOPE referral". Both writers of the row — the 5-minute
--   reconciler (services/integration/resultsEmitter.ts) and the manual/auto
--   "Send to Hope" path (services/integration/emitReportToHope.ts) — already treat
--   (referral_id, care_report_id) as the identity: each re-checks that exact pair
--   inside the same advisory lock #997/#998 introduced, and no code anywhere
--   updates referral_id, referral_item_id or care_report_id on an existing row.
--
--   The database does not enforce that identity today. The only report-keyed unique
--   index is:
--       external_result_links_report_uidx (referral_item_id, care_report_id)
--         WHERE care_report_id IS NOT NULL
--   and PostgreSQL treats NULLs as distinct, while referral_item_id is legitimately
--   NULL whenever the report's order test has no matching referral item
--   (resultsEmitter.ts:85, emitReportToHope.ts:244 — both `?? null`). So for an
--   item-less referral nothing at all stops two rows for one (referral, report)
--   pair, and the same pair is also reachable through two DIFFERENT items of one
--   referral, which the item-keyed index considers two different results. Measured:
--   see the regression suite (services/integration/externalLinkIntegrity.db.test.ts,
--   cases I1 and I3 — both inserts accepted, two independent connections both commit).
--
--   The consequence is not cosmetic. A duplicated link row is a duplicated delivery
--   anchor: the critical-result acknowledgement (routes/integration/inbound.ts:247)
--   and CARE's escalation counter (services/integration/criticalEscalation.ts:64)
--   attach to ONE link id, so a second row can leave the same critical report
--   permanently "unacknowledged" in HOPE's view — escalation keeps firing at a
--   hospital that has already acknowledged, or the ack lands on a row nobody reads.
--
-- Upgrade-safe:
--   1) Count duplicate (referral_id, care_report_id) groups.
--   2) If any exist, RAISE with an actionable diagnostic and never delete, merge or
--      rewrite a link row. A duplicate may hold a critical-acknowledgement state a
--      clinician already recorded; choosing which row survives is a human decision
--      about a clinical document, not a migration's to make.
--   3) Only then create the partial unique index.
--
-- Deliberately NOT dropped: the existing (referral_item_id, care_report_id) index.
-- It is subsumed by this one for report rows (an item belongs to exactly one
-- referral, so any item-keyed duplicate shares referral_id), but removing an index
-- production reads is a separate, risk-free-later decision, not part of adding a
-- safeguard.
--
-- Partial on care_report_id IS NOT NULL, NOT NULLS NOT DISTINCT: a link row with no
-- report id is legitimate (#996's outbox write-back anchors on referral +
-- emitted_outbox_id only — see outboxRecovery.db.test.ts:136), and NULLS NOT
-- DISTINCT would start refusing that row shape. Partial unique indexes need no
-- version note at all: they have been supported since PostgreSQL 9.x, and this
-- clinic's compose file pins postgres:16-alpine (docker-compose.yml:44 and :114) —
-- the constraint therefore applies unchanged on the version the migration runs on.
--
-- Safe to re-run (IF NOT EXISTS, and the DO block is read-only until it raises).

DO $$
DECLARE
  dup_groups int;
  dup_rows   int;
  diag       text;
BEGIN
  SELECT count(*)::int, coalesce(sum(n), 0)::int INTO dup_groups, dup_rows
  FROM (
    SELECT referral_id, care_report_id, count(*)::int AS n
    FROM external_result_links
    WHERE care_report_id IS NOT NULL
    GROUP BY referral_id, care_report_id
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    -- Identifiers only: referral/report/outbox numbers, link ids and the state each
    -- row holds. No patient name, no report text, no contact detail.
    SELECT string_agg(
      format(
        'referral_id=%s care_report_id=%s rows=%s [ids=%s statuses=%s acked=%s delivered=%s]',
        referral_id,
        care_report_id,
        n,
        link_ids,
        report_statuses,
        ack_states,
        delivered_states
      ),
      E'\n'
      ORDER BY referral_id, care_report_id
    )
    INTO diag
    FROM (
      SELECT
        referral_id,
        care_report_id,
        count(*)::int AS n,
        array_agg(id ORDER BY id)::text AS link_ids,
        array_agg(DISTINCT report_status ORDER BY report_status)::text AS report_statuses,
        array_agg(DISTINCT coalesce(critical_ack_status, '-') ORDER BY coalesce(critical_ack_status, '-'))::text AS ack_states,
        count(delivered_at)::text AS delivered_states
      FROM external_result_links
      WHERE care_report_id IS NOT NULL
      GROUP BY referral_id, care_report_id
      HAVING count(*) > 1
    ) d;

    RAISE EXCEPTION
      'external_result_links: cannot create UNIQUE(referral_id, care_report_id) — % duplicate pair(s) covering % rows exist. Decide by hand which link row keeps the delivery state (a duplicate may hold a critical-result acknowledgement a clinician already made, so this migration will not choose for you); then re-run. Diagnostics:%',
      dup_groups, dup_rows, E'\n' || coalesce(diag, '(no detail)');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS external_result_links_referral_report_uidx
  ON external_result_links (referral_id, care_report_id)
  WHERE care_report_id IS NOT NULL;
