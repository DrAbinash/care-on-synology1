-- SIGNER OWNERSHIP PR-A: a signature block must be able to say whose it is.
--
-- WHY THIS FILE EXISTS
-- `signatures` had nine columns and none of them identified an account. Measured on
-- the real app: signed in as one radiologist, the finalize/Hub picker offered EVERY
-- active block, and `POST /api/patient-reports/:id/sign { signatureId: <someone
-- else's block> }` answered 200 — the report then printed that other doctor's name,
-- qualification and registration number. Because the stamp also rewrites
-- `signed_by_name`, the account that actually authored the report could not withdraw
-- it (403 `not_the_signer`). There was nothing in the schema to check against: the
-- only filter on the block lookup was its id.
--
-- WHAT THIS MIGRATION ADDS
--   user_id   the `users.id` of the staff account the block belongs to. NULL means
--             "no owner claimed yet" — a block written before this file, or one whose
--             name matched more than one account or none.
--
-- The backfill is deliberately narrow
-- It binds a block only where the name is an exact, case- and whitespace-insensitive
-- match to exactly ONE staff account AND that account name matches exactly one block.
-- Anything ambiguous, or unmatched, stays NULL rather than being guessed at: a wrong
-- binding is worse than no binding, because it would refuse the real owner's own
-- signature. Retired blocks are bound too — ownership is a fact about the block, not
-- about its status, and a retired block that keeps no owner could be re-activated and
-- then used by anyone. The clinic can claim the remaining blocks in the Signatures
-- manager, which now stamps its creator.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No foreign key. `patient_reports.signature_id` has never had one, and an FK here
--     would refuse historical reports whose signer has since been deleted from `users`.
--     Ownership is enforced in the application, where the authenticated session is the
--     only source of the caller's identity.
--   * No NOT NULL, no default, no backfill of a sentinel. A default would make every
--     historical block look owned by someone.
--   * No new index. The lookups stay by `id` (a serial primary key); the picker filter
--     reads the small whole table it already reads.
--   * No rewrite of any earlier migration — the chain is append-only.
--
-- SAFE AGAINST THE CURRENT PRODUCTION SCHEMA
-- `ADD COLUMN IF NOT EXISTS` is a no-op where `drizzle-kit push` already created the
-- column, so a migration-built clinic database and a development database converge.
-- `signatures` is created by `zz_schema_reconcile_20260709.sql`, which sorts before
-- this file, as `node scripts/check-migration-order.cjs` verifies.

ALTER TABLE signatures
  ADD COLUMN IF NOT EXISTS user_id integer;

-- Exact unambiguous name match, active account, one block per name, one name per block.
UPDATE signatures s
SET user_id = u.id
FROM (
  SELECT lower(btrim(u2.name)) AS k, min(u2.id) AS id, count(*) AS users
  FROM users u2
  WHERE u2.is_active IS TRUE AND u2.name IS NOT NULL
  GROUP BY 1
) u
WHERE s.user_id IS NULL
  AND lower(btrim(s.name)) = u.k
  AND u.users = 1
  AND (SELECT count(*) FROM signatures s3 WHERE lower(btrim(s3.name)) = u.k) = 1;
