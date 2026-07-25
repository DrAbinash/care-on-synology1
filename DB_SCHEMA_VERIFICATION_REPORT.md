# DB Schema Repair Report

**Generated:** 2026-07-07T22:23:54.647Z  
**Mode:** REPAIR  
**Objects repaired:** 2  

## Repair Log

| Action | Table | Column/Index | Details |
|---|---|---|---|
| ADD COLUMN | `dicom_nodes` | `pull_interval_minutes` | OK |
| ADD COLUMN | `dicom_nodes` | `pull_query_days` | OK |
| SKIP INDEX | `orders` | `idx_orders_referred_by` | OK |
| SKIP INDEX | `bills` | `idx_bills_referred_by_id` | OK |
| SKIP INDEX | `bills` | `idx_bills_referred_by_created` | OK |
| SKIP INDEX | `radiology_worklist` | `radiology_worklist_accession_uq` | OK |
| SKIP INDEX | `study_tat_metrics` | `tat_study_idx` | OK |
| SKIP INDEX | `study_tat_metrics` | `tat_delayed_idx` | OK |
| SKIP INDEX | `study_tat_metrics` | `tat_radiologist_idx` | OK |
| SKIP INDEX | `study_tat_metrics` | `tat_sla_idx` | OK |

## Safety Guarantees

- ✓ No tables were dropped
- ✓ No columns were dropped
- ✓ No data was modified
- ✓ All operations used IF NOT EXISTS

## Next Step

Run `--verify` to confirm repairs:
```bash
docker compose run --rm care-migrate node /repo/scripts/db-schema-verify.cjs --verify --verbose
```