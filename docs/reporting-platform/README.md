<!-- markdownlint-disable -->
# CARE Reporting Platform — Engineering Documentation

Documentation-only home for the **CARE radiology reporting platform** engineering audit and its per-modality health cockpit.

> ⚠️ **Audit snapshot — not live telemetry.** Everything in this folder is a **point-in-time, manually-produced snapshot**. It is **not** connected to the live repository, runtime, database, or CI. Percentage/readiness scores are **engineering judgments (estimates)**; asset counts (templates, protocols, Copilot modules, `modalityMap`) were **code-verified** at the audit base commit. Evidence-backed detail lives in the master audit.

## Snapshot metadata

| | |
|---|---|
| **Audit version** | 1.0.0 |
| **Audit date** | 2026-07-16 |
| **Audit base commit** | `8200e766` (post MRI PR 5 — evidence `file:line` refs point here) |
| **Committed onto** | `01b0ee49` |
| **Last updated** | 2026-07-16 |
| **Responsible reviewer** | DrAbinash (platform owner) — pending human sign-off |
| **Method** | Six independent read-only audit sweeps, cross-checked and consolidated |

## Contents

| File | What it is |
|---|---|
| [`CARE_PLATFORM_MASTER_AUDIT.md`](./CARE_PLATFORM_MASTER_AUDIT.md) | The authoritative report — 8 scores with justification, 13 per-audit summaries, **~75 ranked issues** (each with `file:line` evidence, effort, regression risk, recommended PR), verified-solid, and the six-month roadmap. |
| [`cockpit/index.html`](./cockpit/index.html) | The **engineering cockpit** — a visual, per-modality readiness dashboard rendered from the data snapshot. Open in a browser. |
| [`cockpit/audit-data.js`](./cockpit/audit-data.js) | The cockpit's **editable data snapshot** (modalities, issues, roadmap, control center, history + metadata). Edit this to refresh the cockpit. |
| [`cockpit/README.md`](./cockpit/README.md) | How the cockpit works, how to refresh it, and the Super-Admin import contract. |

## What this is (and isn't)

- **Is:** a versioned engineering assessment used to plan the platform's evolution to new modalities (USG completion, CT, Mammography, X-Ray, …).
- **Is not:** a runtime health monitor, a functional feature, or anything wired into the application. It changes only when someone re-runs an audit and commits an updated snapshot.

## Headline findings (see the master audit for evidence)

- **Overall engineering health: 60/100.** A genuinely well-engineered core (Copilot 86, Clinical Workflow 78, Reliability 73) carrying safety-critical duplication and structural debt (Architecture 44, Extension Readiness 38).
- **4 Critical · 19 High · 18 Medium · 20 Low** issues, all documented with evidence. None edited here — this is documentation only.
- **The platform is MRI-primary with USG bolted on**, not modality-generic; the data-driven expansion path exists but is flag-gated `wired: false`.

## Remediation posture

Fixes are **documented, not implemented** in this folder. Per the audit's constraints, the highest-value fixes sit in merge-hot files (`RadiologyReportingWorkspace.tsx`, `patient-reports.ts`, `schema/*`) shared with the in-flight **USG (PR B)** and **PCPNDT** branches, so they are queued (see the roadmap and the cockpit's PR queue) rather than applied. Consolidation/migration items are planning-only.

## Related in-repo docs

- `docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md` — backend contract freeze
- `PROTECTED_FILES.md` — change-governance
- `HOW_TO_ADD_DB_MIGRATIONS.md` — migration process

*(Audit finding **H19**: a dedicated `docs/architecture/COPILOT.md` does not yet exist and is recommended — see the master audit.)*
