# Disaster Recovery & System Audits Directory
## Care Diagnostics ERP Master Reference

This folder is the single source of truth for disaster recovery, infrastructure deployment, system audits, and future developer/sysadmin handovers. It is organized into modular directories representing each system component.

---

## Document Index & Catalog

### 01_INFRASTRUCTURE
*   **[deploy-synology.sh](01_INFRASTRUCTURE/deploy-synology.sh)** — **RETIRED POINTER, DO NOT RUN**
    *   **Purpose**: No longer a deployment script. The live program is [`deploy-synology.sh`](../../deploy-synology.sh) at the repository root; this path holds only an explanation of why the copy was retired and what to run instead.
    *   **Last Update**: October 2026
    *   **Why it was retired**: the copy was 51 lines while the live script was 292. Following it would have deployed the folder's existing commit without fetching `main`, migrated with `pnpm db:deploy` instead of the `care-db-patch-v2` container (skipping the migration ledger and the schema gate), exported every `.env` value through `xargs`, and printed "Deployment completed successfully!" with no health check.
    *   **When to Use**: Never for a deploy. For a deploy: `node scripts/ops-preflight.mjs` then `bash deploy-synology.sh`, both from the repository root.
*   **[SYNOLOGY-INSTALL.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/01_INFRASTRUCTURE/SYNOLOGY-INSTALL.md)**
    *   **Purpose**: Step-by-step documentation for installing DiskStation Manager (DSM), setting up Docker, and deploying the initial Care stack.
    *   **Last Update**: June 2026
    *   **Related Modules**: OS / Hosting Layer
    *   **Dependencies**: Synology DSM 7.2+
    *   **When to Use**: Setting up a new or replacement Synology NAS hardware unit.
*   **[ERP_MODULE_DEPENDENCY_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/01_INFRASTRUCTURE/ERP_MODULE_DEPENDENCY_MAP.md)**
    *   **Purpose**: Visualizes relationships between registration, billing, PACS, pathology, and accounting modules.
    *   **Last Update**: June 2026
    *   **Related Modules**: All
    *   **When to Use**: Onboarding new developers or refactoring cross-module APIs.
*   **[ERP_DATA_FLOW_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/01_INFRASTRUCTURE/ERP_DATA_FLOW_MAP.md)**
    *   **Purpose**: Traces patient data from registration, through DICOM modalities, and into financial ledger entries.
    *   **Last Update**: June 2026
    *   **Related Modules**: Modalities, Billing, Accounting

### 02_DATABASE
*   **[DATABASE_ARCHITECTURE_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/02_DATABASE/DATABASE_ARCHITECTURE_AUDIT.md)**
    *   **Purpose**: Comprehensive audit of schemas, constraints, indexes, and relationship cascades.
    *   **Last Update**: June 2026
    *   **Related Modules**: DB / Storage
    *   **Dependencies**: PostgreSQL 16
    *   **When to Use**: Performing schema updates, database performance tuning, or database troubleshooting.
*   **[DATABASE_RISK_MATRIX.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/02_DATABASE/DATABASE_RISK_MATRIX.md)**
    *   **Purpose**: Lists critical database performance risks, index deficiencies, and locking issues with mitigation fixes.
    *   **Last Update**: June 2026
    *   **Related Modules**: DB / Storage
*   **[Database_Master_Map.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/02_DATABASE/Database_Master_Map.md)**
    *   **Purpose**: Complete structural reference map for every table and relationship.
    *   **Last Update**: June 2026

### 03_DOCKER
*   **[docker-compose.yml](03_DOCKER/docker-compose.yml)** — **RETIRED POINTER, DO NOT RUN**
    *   **Purpose**: Not the production configuration. The live file is [`docker-compose.yml`](../../docker-compose.yml) at the repository root (649 lines, 7 services).
    *   **Last Update**: October 2026
    *   **Why it was retired**: the copy was 281 lines with 5 services and no `schema-verify` and no `redis`. `care-api` starts only after both `care-db-patch-v2` **and** `care-schema-verify` complete, so a stack built from this copy brings the ERP up without the schema gate ever running.
    *   **When to Use**: Never. To inspect the real stack from the repository root: `docker compose config`.
*   **[Dockerfile](03_DOCKER/Dockerfile)** — **RETIRED POINTER, DO NOT BUILD**
    *   **Purpose**: Not the production image definition. The live file is [`Dockerfile`](../../Dockerfile) at the repository root (223 lines).
    *   **Last Update**: October 2026
    *   **Why it was retired**: the copy is 87 lines and has no `ARG GIT_COMMIT / GIT_BRANCH / ERP_VERSION / BUILD_NUMBER` bake, so an image built from it reports version `unknown` permanently and no deploy can be attributed to a commit — the one fact a rollback decision needs.

### 04_PACS_ORTHANC & 05_CONQUEST
*   **[PACS_CURRENT_STATE_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/04_PACS_ORTHANC/PACS_CURRENT_STATE_REPORT.md)**
    *   **Purpose**: Details routing logic, auto-pull agent scripts, and connectivity profiles for local and remote radiologist viewing.
    *   **Last Update**: June 2026
    *   **Related Modules**: Radiology, OHIF, Weasis
    *   **When to Use**: Troubleshooting missing DICOM studies or viewer integration issues.
*   **[DICOM_PACS_FAILURE_SIMULATION.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/04_PACS_ORTHANC/DICOM_PACS_FAILURE_SIMULATION.md)**
    *   **Purpose**: Operational runbook simulating Orthanc storage or Conquest gateway failures.
    *   **Last Update**: June 2026
*   **[conquest/](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/05_CONQUEST/)**
    *   **Purpose**: Local Conquest configuration directory containing custom scripts and database definitions.
    *   **Last Update**: June 2026

### 06_NETWORK & 07_SECURITY
*   **[VIEWER_NETWORK_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/06_NETWORK/VIEWER_NETWORK_AUDIT.md)**
    *   **Purpose**: Details profile routing rules (LAN, Tailscale, WAN) and health check endpoints.
    *   **Last Update**: June 2026
    *   **When to Use**: Network profiling errors or slow PACS response troubleshooting.
*   **[ERP_SECURITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/07_SECURITY/ERP_SECURITY_AUDIT.md)**
    *   **Purpose**: Analyzes endpoint access, authentication tokens, limiters, and session security.
    *   **Last Update**: June 2026

### 08_FINANCIAL & 09_ACCOUNTING
*   **[FINANCIAL_FREEZE_RULEBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_FREEZE_RULEBOOK.md)**
    *   **Purpose**: Core governance document locking financial calculations and detailing strict code modification protocols.
    *   **Last Update**: June 2026
    *   **When to Use**: Prior to planning or writing code for any billing, payment, or accounting modifications.
*   **[FINANCIAL_CHANGE_CONTROL.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_CHANGE_CONTROL.md)**
    *   **Purpose**: Outlines the formal root cause and impact analysis framework required for any financial code modifications.
    *   **Last Update**: June 2026
*   **[FINANCIAL_CODE_REVIEW_CHECKLIST.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_CODE_REVIEW_CHECKLIST.md)**
    *   **Purpose**: Mandatory checklist for pull request reviewers to verify decimal rounding, duplicate voucher prevention, and database locking safety.
    *   **Last Update**: June 2026
*   **[FINANCIAL_RELEASE_CHECKLIST.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_RELEASE_CHECKLIST.md)**
    *   **Purpose**: Verification protocols required on staging environments before deploying billing or ledger changes to production.
    *   **Last Update**: June 2026
*   **[ACCOUNTING_PROTECTED_FILES.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/ACCOUNTING_PROTECTED_FILES.md)**
    *   **Purpose**: Registry cataloging all protected source code files, database tables, and API routes subject to the financial freeze.
    *   **Last Update**: June 2026
*   **[FINAL_FINANCIAL_CONSISTENCY_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINAL_FINANCIAL_CONSISTENCY_REPORT.md)**
    *   **Purpose**: Validates the correct implementation of the canonical outstanding balance invariant: `balance = max(0, total - paid - refund)`.
    *   **Last Update**: June 2026
    *   **When to Use**: Auditing financial ledger discrepancies or outstanding dues calculations.
*   **[FINANCIAL_REGRESSION_TEST_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/08_FINANCIAL/FINANCIAL_REGRESSION_TEST_REPORT.md)**
    *   **Purpose**: Captures results of the 42-scenario regression test verifying accounting write paths.
    *   **Last Update**: June 2026
*   **[ACCOUNTING_WIRING_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/09_ACCOUNTING/ACCOUNTING_WIRING_MAP.md)**
    *   **Purpose**: Maps how database events trigger double-entry ledger vouchers.
    *   **Last Update**: June 2026

### 10_AI
*   **[AI_DEVELOPER_HANDBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/10_AI/AI_DEVELOPER_HANDBOOK.md)**
    *   **Purpose**: Manual detailing how local Ollama containers interface with the reporting dashboard for smart findings.
    *   **Last Update**: June 2026
*   **[AI_SAFE_MODIFICATION_RULEBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/10_AI/AI_SAFE_MODIFICATION_RULEBOOK.md)**
    *   **Purpose**: Guardrails for writing safe prompts and structuring clinical structured templates.
    *   **Last Update**: June 2026

### 11_DEPLOYMENT, 12_BACKUPS & 13_RESTORE
*   **[ERP_DEPLOYMENT_RUNBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/11_DEPLOYMENT/ERP_DEPLOYMENT_RUNBOOK.md)**
    *   **Purpose**: Runbook documenting the full pipeline setup, environmental keys, and post-installation validation steps.
    *   **Last Update**: June 2026
*   **[BACKUP.md](12_BACKUPS/BACKUP.md) / [synology-backup.sh](12_BACKUPS/synology-backup.sh)**
    *   **Purpose**: Backup administration guide, plus the copy of the cloud (Replit) pull script. The clinic's own daily dump is `scripts/synology-nas-backup.sh` — see `BACKUP.md` section 2 for the DSM task that schedules it.
    *   **When to Use**: Configuring daily scheduled backups or testing encryption passphrases.
*   **[RESTORE.md](13_RESTORE/RESTORE.md) / [synology-restore.sh](13_RESTORE/synology-restore.sh) / [verify-backup-restore.sh](13_RESTORE/verify-backup-restore.sh)**
    *   **Purpose**: Restore execution procedures, auto-decryption parameters, and the restore proof that decides whether a backup exists at all.
    *   **When to Use**: Database recovery after corruption, and every week whether or not anything is wrong.
    *   **These are copies, not links**: each `.sh` here is byte-identical to its `scripts/` twin so the binder still works with the repository absent. `scripts/` is what you edit; `scripts/backupScripts.test.mjs` fails CI when a copy drifts, and runs the copies to check they behave the same.

### 14_BUSINESS_CONTINUITY & 15_HANDOVER
*   **[DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/14_BUSINESS_CONTINUITY/DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md)**
    *   **Purpose**: Risk matrix, mitigation priorities, and component-wise recovery actions for total hardware loss.
    *   **Last Update**: June 2026
    *   **When to Use**: Disaster recovery planning, business continuity audits, or active total outage resolution.
*   **[CODING_AGENT_ONBOARDING.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/15_HANDOVER/CODING_AGENT_ONBOARDING.md)**
    *   **Purpose**: Handover documentation describing code structures, build verification steps, and project directory architecture.
    *   **Last Update**: June 2026
    *   **When to Use**: Onboarding new developers or setting up a clean local developer workspace.

### 16_RUNBOOKS & 17_AUDITS
*   **[deploy-synology.sh](16_RUNBOOKS/deploy-synology.sh)** — **RETIRED POINTER, DO NOT RUN**
    *   **Purpose**: A second copy of the same superseded script, kept only as the pointer. The runbook for a deploy is [`docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md`](../../docs/CARE_ERP_DEPLOYMENT_RUNBOOK.md), and the program is [`deploy-synology.sh`](../../deploy-synology.sh) at the repository root.
*   **[ERP_PRODUCTION_READINESS_FINAL.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/17_AUDITS/ERP_PRODUCTION_READINESS_FINAL.md)**
    *   **Purpose**: Final readiness review scoring 82/100, outlining post-patching validation.
    *   **Last Update**: June 2026
*   **[CARE_DIAGNOSTICS_MASTER_AUDIT_2026.md](file:///c:/Users/abina/caredeoghar--antigravity/SOP/RECOVERY/17_AUDITS/CARE_DIAGNOSTICS_MASTER_AUDIT_2026.md)**
    *   **Purpose**: Baseline system assessment covering registration, diagnostic consoles, and billing.
    *   **Last Update**: June 2026
