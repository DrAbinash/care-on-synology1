# Disaster Recovery & System Audits Directory
## Care Diagnostics ERP Master Reference

This folder is the single source of truth for disaster recovery, infrastructure deployment, system audits, and future developer/sysadmin handovers. It is organized into modular directories representing each system component.

---

## Document Index & Catalog

### 01_INFRASTRUCTURE
*   **[deploy-synology.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/01_INFRASTRUCTURE/deploy-synology.sh)**
    *   **Purpose**: Production deployment script installing dependencies, validating builds, executing migrations, and restarting containers on the Synology NAS.
    *   **Last Update**: June 2026
    *   **Related Modules**: All
    *   **Dependencies**: pnpm, Docker, PostgreSQL
    *   **When to Use**: During active production deployments or system environment re-initialization.
*   **[SYNOLOGY-INSTALL.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/01_INFRASTRUCTURE/SYNOLOGY-INSTALL.md)**
    *   **Purpose**: Step-by-step documentation for installing DiskStation Manager (DSM), setting up Docker, and deploying the initial Care stack.
    *   **Last Update**: June 2026
    *   **Related Modules**: OS / Hosting Layer
    *   **Dependencies**: Synology DSM 7.2+
    *   **When to Use**: Setting up a new or replacement Synology NAS hardware unit.
*   **[ERP_MODULE_DEPENDENCY_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/01_INFRASTRUCTURE/ERP_MODULE_DEPENDENCY_MAP.md)**
    *   **Purpose**: Visualizes relationships between registration, billing, PACS, pathology, and accounting modules.
    *   **Last Update**: June 2026
    *   **Related Modules**: All
    *   **When to Use**: Onboarding new developers or refactoring cross-module APIs.
*   **[ERP_DATA_FLOW_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/01_INFRASTRUCTURE/ERP_DATA_FLOW_MAP.md)**
    *   **Purpose**: Traces patient data from registration, through DICOM modalities, and into financial ledger entries.
    *   **Last Update**: June 2026
    *   **Related Modules**: Modalities, Billing, Accounting

### 02_DATABASE
*   **[DATABASE_ARCHITECTURE_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/02_DATABASE/DATABASE_ARCHITECTURE_AUDIT.md)**
    *   **Purpose**: Comprehensive audit of schemas, constraints, indexes, and relationship cascades.
    *   **Last Update**: June 2026
    *   **Related Modules**: DB / Storage
    *   **Dependencies**: PostgreSQL 16
    *   **When to Use**: Performing schema updates, database performance tuning, or database troubleshooting.
*   **[DATABASE_RISK_MATRIX.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/02_DATABASE/DATABASE_RISK_MATRIX.md)**
    *   **Purpose**: Lists critical database performance risks, index deficiencies, and locking issues with mitigation fixes.
    *   **Last Update**: June 2026
    *   **Related Modules**: DB / Storage
*   **[Database_Master_Map.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/02_DATABASE/Database_Master_Map.md)**
    *   **Purpose**: Complete structural reference map for every table and relationship.
    *   **Last Update**: June 2026

### 03_DOCKER
*   **[docker-compose.yml](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/03_DOCKER/docker-compose.yml)**
    *   **Purpose**: Production Docker Compose configuration containing active container services, environment vars, volumes, and port mappings.
    *   **Last Update**: June 2026
    *   **Related Modules**: Orchestration
    *   **When to Use**: Starting, stopping, rebuilding, or reconfiguring active services on the host.
*   **[Dockerfile](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/03_DOCKER/Dockerfile)**
    *   **Purpose**: Multi-stage build file compiling the API server, Super Admin, and Diagnostic ERP web frontends.
    *   **Last Update**: June 2026

### 04_PACS_ORTHANC & 05_CONQUEST
*   **[PACS_CURRENT_STATE_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/04_PACS_ORTHANC/PACS_CURRENT_STATE_REPORT.md)**
    *   **Purpose**: Details routing logic, auto-pull agent scripts, and connectivity profiles for local and remote radiologist viewing.
    *   **Last Update**: June 2026
    *   **Related Modules**: Radiology, OHIF, Weasis
    *   **When to Use**: Troubleshooting missing DICOM studies or viewer integration issues.
*   **[DICOM_PACS_FAILURE_SIMULATION.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/04_PACS_ORTHANC/DICOM_PACS_FAILURE_SIMULATION.md)**
    *   **Purpose**: Operational runbook simulating Orthanc storage or Conquest gateway failures.
    *   **Last Update**: June 2026
*   **[conquest/](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/05_CONQUEST/)**
    *   **Purpose**: Local Conquest configuration directory containing custom scripts and database definitions.
    *   **Last Update**: June 2026

### 06_NETWORK & 07_SECURITY
*   **[VIEWER_NETWORK_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/06_NETWORK/VIEWER_NETWORK_AUDIT.md)**
    *   **Purpose**: Details profile routing rules (LAN, Tailscale, WAN) and health check endpoints.
    *   **Last Update**: June 2026
    *   **When to Use**: Network profiling errors or slow PACS response troubleshooting.
*   **[ERP_SECURITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/07_SECURITY/ERP_SECURITY_AUDIT.md)**
    *   **Purpose**: Analyzes endpoint access, authentication tokens, limiters, and session security.
    *   **Last Update**: June 2026

### 08_FINANCIAL & 09_ACCOUNTING
*   **[FINAL_FINANCIAL_CONSISTENCY_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/08_FINANCIAL/FINAL_FINANCIAL_CONSISTENCY_REPORT.md)**
    *   **Purpose**: Validates the correct implementation of the canonical outstanding balance invariant: `balance = max(0, total - paid - refund)`.
    *   **Last Update**: June 2026
    *   **When to Use**: Auditing financial ledger discrepancies or outstanding dues calculations.
*   **[FINANCIAL_REGRESSION_TEST_REPORT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/08_FINANCIAL/FINANCIAL_REGRESSION_TEST_REPORT.md)**
    *   **Purpose**: Captures results of the 42-scenario regression test verifying accounting write paths.
    *   **Last Update**: June 2026
*   **[ACCOUNTING_WIRING_MAP.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/09_ACCOUNTING/ACCOUNTING_WIRING_MAP.md)**
    *   **Purpose**: Maps how database events trigger double-entry ledger vouchers.
    *   **Last Update**: June 2026

### 10_AI
*   **[AI_DEVELOPER_HANDBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/10_AI/AI_DEVELOPER_HANDBOOK.md)**
    *   **Purpose**: Manual detailing how local Ollama containers interface with the reporting dashboard for smart findings.
    *   **Last Update**: June 2026
*   **[AI_SAFE_MODIFICATION_RULEBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/10_AI/AI_SAFE_MODIFICATION_RULEBOOK.md)**
    *   **Purpose**: Guardrails for writing safe prompts and structuring clinical structured templates.
    *   **Last Update**: June 2026

### 11_DEPLOYMENT, 12_BACKUPS & 13_RESTORE
*   **[ERP_DEPLOYMENT_RUNBOOK.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/11_DEPLOYMENT/ERP_DEPLOYMENT_RUNBOOK.md)**
    *   **Purpose**: Runbook documenting the full pipeline setup, environmental keys, and post-installation validation steps.
    *   **Last Update**: June 2026
*   **[BACKUP.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/12_BACKUPS/BACKUP.md) / [synology-backup.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/12_BACKUPS/synology-backup.sh)**
    *   **Purpose**: Backup administration guide and execution script supporting AES-256 backup encryption.
    *   **Last Update**: June 2026
    *   **When to Use**: Configuring daily scheduled backups or testing encryption passphrases.
*   **[RESTORE.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/13_RESTORE/RESTORE.md) / [synology-restore.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/13_RESTORE/synology-restore.sh) / [verify-backup-restore.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/13_RESTORE/verify-backup-restore.sh)**
    *   **Purpose**: Restore execution procedures, auto-decryption parameters, and the automated sandbox docker verification runbook.
    *   **Last Update**: June 2026
    *   **When to Use**: Database recovery after corruption or automated weekly backup health verification.

### 14_BUSINESS_CONTINUITY & 15_HANDOVER
*   **[DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/14_BUSINESS_CONTINUITY/DISASTER_RECOVERY_BUSINESS_CONTINUITY_AUDIT.md)**
    *   **Purpose**: Risk matrix, mitigation priorities, and component-wise recovery actions for total hardware loss.
    *   **Last Update**: June 2026
    *   **When to Use**: Disaster recovery planning, business continuity audits, or active total outage resolution.
*   **[CODING_AGENT_ONBOARDING.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/15_HANDOVER/CODING_AGENT_ONBOARDING.md)**
    *   **Purpose**: Handover documentation describing code structures, build verification steps, and project directory architecture.
    *   **Last Update**: June 2026
    *   **When to Use**: Onboarding new developers or setting up a clean local developer workspace.

### 16_RUNBOOKS & 17_AUDITS
*   **[deploy-synology.sh](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/16_RUNBOOKS/deploy-synology.sh)**
    *   **Purpose**: Duplicate script reference mapped under operational runbooks for immediate sysadmin execution.
*   **[ERP_PRODUCTION_READINESS_FINAL.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/17_AUDITS/ERP_PRODUCTION_READINESS_FINAL.md)**
    *   **Purpose**: Final readiness review scoring 82/100, outlining post-patching validation.
    *   **Last Update**: June 2026
*   **[CARE_DIAGNOSTICS_MASTER_AUDIT_2026.md](file:///c:/Users/abina/caredeoghar--antigravity/RECOVERY/17_AUDITS/CARE_DIAGNOSTICS_MASTER_AUDIT_2026.md)**
    *   **Purpose**: Baseline system assessment covering registration, diagnostic consoles, and billing.
    *   **Last Update**: June 2026
