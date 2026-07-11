# Manual-only migrations

Files in this folder are **never** auto-applied. `care-db-patch-v2` only scans
`migrations/*.sql` (non-recursive) — anything in this subfolder is invisible
to that automatic scan by design.

Previously `prepare_payment_uniqueness_index.sql` lived directly in
`migrations/`, which meant `care-db-patch-v2` picked it up and ran it
automatically on every deploy despite its own header saying
"DO NOT EXECUTE AUTOMATICALLY" — the warning was a comment, not an actual
technical guard. Moved here on 2026-07-07 to close that gap. It touches the
protected billing/payments zone, so it stays here until Dr. Abinash approves
running it manually, per its own Step 1 (impact assessment), backup, and
maintenance-window instructions.

To run it when ready:
```bash
docker compose exec -T db psql -U erp -d diagnostic_erp -f /path/to/prepare_payment_uniqueness_index.sql
```
(or copy its contents into `psql` directly after reviewing Step 1's output).
