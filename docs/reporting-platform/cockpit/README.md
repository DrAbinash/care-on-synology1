<!-- markdownlint-disable -->
# Engineering Cockpit — usage & data contract

A static, dependency-free visualization of the [CARE Reporting Platform master audit](../CARE_PLATFORM_MASTER_AUDIT.md). It renders a **versioned audit snapshot** — per-modality readiness, coverage, the issue tracker, roadmap, and control center.

> ⚠️ **Not live telemetry.** The cockpit reads a committed data file. It is **not** wired to the repository, runtime, database, or CI. Percentages are **engineering judgments**; asset counts were **code-verified** at the audit base commit. Evidence lives in the [master audit](../CARE_PLATFORM_MASTER_AUDIT.md).

## Files

| File | Role |
|---|---|
| [`index.html`](./index.html) | Presentation + rendering only (CSS + a small render script). No data. |
| [`audit-data.js`](./audit-data.js) | **The editable snapshot** — `window.CARE_AUDIT` with `meta`, `capabilities`, `modalities`, `issues`, `verifiedSolid`, `controlCenter`, and `auditHistory`. |

## Viewing it

- **Locally:** open `index.html` directly in a browser. It loads its sibling `audit-data.js` via a classic `<script src>` (works over `file://` in Chromium/Firefox; if a browser blocks it, an inline notice explains how to serve the folder).
- **Served:** point any static server at `docs/reporting-platform/cockpit/` (e.g. `python3 -m http.server` from this directory) and open `index.html`.

It is theme-aware (follows the OS light/dark preference) and fully self-contained — no network, fonts, or build step.

## Refreshing the snapshot (documentation change)

1. Edit **`audit-data.js`** only — update `modalities[]` (readiness %, `caps`, `cov`, roadmap fields), `issues[]` (status/notes as work lands), and `controlCenter[]`.
2. Bump `meta.auditVersion` and set `meta.lastUpdated`; update `meta.auditBaseCommit` if you re-verified against a newer tree.
3. Append a row to `auditHistory` describing the new snapshot.
4. Keep the evidence in [`../CARE_PLATFORM_MASTER_AUDIT.md`](../CARE_PLATFORM_MASTER_AUDIT.md) in sync — it remains the source of truth for `file:line` detail.

Capability status codes in `modalities[].caps` (aligned 1:1 with `capabilities`): **`2`** full · **`1`** partial · **`0`** none · **`"p"`** planned/flag-reserved.

## Data shape (`window.CARE_AUDIT`)

```
meta:            { auditVersion, auditDate, auditBaseCommit, committedOnto,
                   lastUpdated, reviewer, method, engHealth, liveModalitiesPct,
                   allModalityPct, productionOrDev, freshnessNote }
capabilities:    string[]                      // matrix/card column labels
modalities:      { n, code, pct, st:[label,cssClass], mc, cov:[impl,total],
                   cr, caps:number|"p"[], issues, audit, cur, nxt, blk, rem, dep }[]
issues:          [id, sev, issue, status, statusClass, prPhase, risk, evidence, notes][]
verifiedSolid:   string[]
controlCenter:   [title, cssVar, [ [html, tag], ... ]][]
auditHistory:    { version, date, base, summary, reviewer }[]
```

## Super-Admin import contract (future, optional)

A future in-app **Super Admin** dashboard could surface these snapshots **without ever claiming live analysis**, by treating each committed `audit-data.js` (or a JSON export of `window.CARE_AUDIT`) as an immutable, versioned artifact:

1. **Read, don't compute.** Load the committed snapshot(s) at build time; never recompute percentages at runtime.
2. **Show provenance.** Render every score with `meta.auditVersion`, `meta.auditDate`, `meta.auditBaseCommit`, and `meta.reviewer`, plus a persistent **"snapshot — not live"** badge.
3. **Version picker.** Offer a selector over `auditHistory` so admins can compare snapshots (trend) — each still labelled as a manual audit, not telemetry.
4. **No new coupling.** Gate it behind the existing Super Admin RBAC; it reads static docs only — no new API, DB schema, or reporting-workspace dependency.

**The contract:** the app *may display* these numbers, but must attribute them to a **dated manual audit** and must **not** present them as computed-live. Regenerating a snapshot is a documentation change, reviewed like any other doc PR.

## Constraints honored

Documentation only. This cockpit does **not** touch application navigation, React pages, APIs, database schema, the reporting workspace, or the USG/PCPNDT branches. It has no runtime coupling to the app.
