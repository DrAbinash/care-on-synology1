# USG Companion Workspace — P0/P1 Deployment Validation & Hardening

Validation of the P0 + P1 implementation against a real CARE ERP stack
(frontend build, api-server, an isolated Postgres 16 with the canonical
radiology schema, and the real feature-flag + PCPNDT paths). No P2 features were
added. No patient-identifiable data was used.

> **Environment note.** This ran in an ephemeral CI container (it was reclaimed
> once mid-task; all committed work survived on the remote). An isolated Postgres
> cluster was stood up locally and the canonical schema applied via
> `drizzle-kit push`. A full browser click-through of the *deployed* API +
> Orthanc was not stood up here (see §4/§9 limitations); the equivalent paths
> were validated against the real DB + real gate + real components instead.

---

## 1. Implementation-diff review — findings table

| # | Issue | Severity | File(s) | Correction |
|---|---|---|---|---|
| 1 | Ellipsoid volume formula was mirrored in the frontend builder and the server engine (drift risk). | **High** | `usgFindingBuilder.ts`, `usgMeasurementEngine.ts` | Moved to shared `@workspace/measurements` (`volume.ts`); both import `ellipsoidVolumeMlFromMm`. **Fixed** (§2). |
| 2 | Prostatomegaly was auto-diagnosed from a hard-coded threshold and written straight into the impression. | **High** | `usgOrganLibrary.ts` | Measurement vs clinical finding separated; threshold only *suggests*; radiologist confirms; centralized in `usgProstateConfig.ts`. **Fixed** (§3). |
| 3 | Manual volume override kept the reason but not a calculated-vs-entered record. | Medium | `usgFindingBuilder.ts`, `usgOrganLibrary.ts` | `DerivedValue` now carries `calculated` + `entered` + `reason`; author/timestamp already on the object. **Fixed**. |
| 4 | Unit conversion used a local mm/cm table in the builder. | Low | `usgFindingBuilder.ts` | Routed through the shared `convertUnitValue`. **Fixed**. |

**Confirmations (all PASS — verified by `usgWorkspaceContract.test.ts` + code read):**

- No second reporting lifecycle — save/finalize go through `lib/radiologyReportLifecycle` only.
- No second draft store — writes to canonical `radiology_report_drafts.findings_sections`.
- No new finalized-report store — finalize creates a canonical `patient_reports` row.
- No duplicated/bypassed PCPNDT — the shell calls `finalizeRadiologyReport`, whose server path enforces the shared gate; the page never re-implements it (§8).
- No independent Quick Findings engine — the page does not mount `QuickFindingsPanel`.
- No large canonical component copied — the shell composes existing panels.
- Feature flag follows the real server→client path — `ff_radiology_usg_workspace` (the `ff_radiology_` prefix hydrates from `/api/feature-flags`), default **off**.
- Flag off restores the existing workflow — the page redirects to `/radiology/report/:studyId`; the worklist keeps opening US studies in the canonical workspace.

**No Critical defects. The two High defects are fixed.**

---

## 2. Single source of truth for prostate/organ volume

- New shared module **`lib/measurements/src/volume.ts`** in `@workspace/measurements`
  (already a dependency of both `diagnostic-erp` and `api-server`) exports
  `ellipsoidVolumeMlFromMm`, `ellipsoidVolumeMl(unit-aware)`, `ELLIPSOID_FACTOR`.
- The frontend builder and the server `usgMeasurementEngine` both import it — the
  mirrored copies are gone. Unit conversion goes through the package's existing
  `convertUnitValue` (one conversion path).
- **Source of truth: `@workspace/measurements`.**
- 3.4 × 3.1 × 2.4 cm → **13.23 cc** (verified in `lib/measurements/src/volume.test.ts`
  and the organ-library tests; frontend-mm and server-cm inputs proven equal).

## 3. Prostatomegaly decision hardening

- The finding text always states the **measurement** (dimensions + calculated volume).
- A separate radiologist-controlled parameter **Clinical finding** (`Awaiting
  radiologist` / `Normal prostate` / `Prostatomegaly` / `Indeterminate`,
  default *Awaiting radiologist*) drives the impression.
- Exceeding the volume threshold only raises a **suggestion** (a builder warning);
  it **never** silently writes the impression. The impression appears only after
  the radiologist confirms a clinical finding.
- **No numeric grade** is assigned (no approved grading config exists;
  `PROSTATE_GRADING_CONFIG = null`).
- The threshold lives in **one** place — `usgProstateConfig.ts` — not in the
  finding definition or any React component.
- Manual override retains reason + author + timestamp + calculated-vs-entered.
- Screenshot evidence: the live builder shows *"…approximately 13 cc"* with
  Clinical finding = *Awaiting radiologist* and **no** prostatomegaly in the
  impression (§9, shot 01/04).

---

## 4. Real stack used

- **Postgres 16** isolated cluster (local, trust auth, dedicated `care_test` DB);
  canonical radiology schema applied via `drizzle-kit push` (schema-based, clean).
- **api-server** modules + the real `db` handle + real `checkPcpndtFormFCompliance`
  exercised against that DB (§5–§8).
- **Frontend** production build + the real React components rendered in a browser
  (§9).
- **Dummy studies:** created programmatically in-DB (a non-obstetric draft with
  structured findings; an obstetric patient with incomplete/complete Form F). No
  PII.
- **Not stood up here:** the running API HTTP server + worklist auth session +
  Orthanc viewer (ephemeral-container constraint). Those paths are covered by the
  DB round-trip, the structural contract test, and the component render instead of
  a browser click-through.

## 5–6. Structured-finding persistence (real DB)

`usgWorkspacePersistence.integration.test.ts` (DB-gated) inserts a fully-populated
`UsgFindingObject` inside the canonical `radiology_report_drafts.findings_sections`
exactly as `saveRadiologyDraft` does (JSON string), reloads it, and asserts **every**
field survives: organ, laterality, finding type, parameters, units, derived values
(incl. `calculated`/`entered`/`reason`), source type/reference, generated text,
radiologist-edited text, author, timestamps — plus the normal-organ shape and the
`impression` string[]. **Unknown-field stripping is not a risk:** the server's
`SaveDraftBody.findingsSections` schema is `z.object({normal,text}).passthrough()`,
so the structured `findings` array passes through untouched and is stored verbatim.

**Scope note (honest):** the structured objects persist durably in the **canonical
draft**, which is retained (status `FINAL`, `final_report_id` set) after finalize —
they survive create/update/reload/finalize there. The **signed `patient_reports`**
row carries the faithfully-rendered findings + impression *text* (its authoritative
artifact), not the structured objects; embedding structured USG findings into the
signed D1 document (`structured_json_d1`) requires catalog IDs and is P2+ work. No
alternative storage path was added — this rides the existing `.passthrough()`.

## 7. Feature-flag lifecycle

- `ff_radiology_usg_workspace` added to `FEATURE_FLAG_DEFAULTS` (**off**), server-
  hydratable via the `ff_radiology_` prefix path; `isFeatureEnabled(...)` default
  **false** verified in `usgReportComposer.test.ts`.
- **Off:** page redirects to canonical; worklist unchanged for MRI/CT/X-ray (they
  never touch this route); direct route access redirects safely (no blank screen /
  loop) — logic verified by the contract test.
- **On:** the worklist routes only *ultrasound* studies to `/radiology/usg/:id`.

## 8. PCPNDT fail-closed (real DB + real gate)

Verified against the real `checkPcpndtFormFCompliance` and DB:
no patient → blocked (`no_patient`); no Form F → blocked (`no_form_f`); incomplete
Form F → blocked (`incomplete_form_f`); only a complete Form F → `compliant`.
The gate is **unchanged and not relocated**; it stays server-side at every finalize
site (`patient-reports.ts`, `internal-radiology.ts`, `usgReports.ts`,
`fetalUsgLevel4.ts`). The shell can only reach finalize through
`finalizeRadiologyReport`, so it cannot bypass the block; switching to the canonical
workspace hits the same server gate.

## 9. UI validation & screenshots

Real components rendered through the app's Vite + Tailwind and captured with
Chromium/Playwright at 1440×900 (and 1024×768):

| Shot | Shows |
|---|---|
| `01-whole-abdomen-1440` | Full 3-column workspace; prostate builder live volume **13 cc**, clinical finding *Awaiting radiologist*; measurements co-visible |
| `02-renal-calculus` | Renal-calculus builder → *"…5.5 mm … lower calyx of the right kidney, showing posterior acoustic shadowing. No hydronephrosis…"* |
| `03-cholelithiasis` | Cholelithiasis builder + live preview |
| `04-prostate-volume` | Prostate dimensions → calculated **13.23 cc (calculated)**; no auto-diagnosis |
| `05-mixed-report-1440` | Mixed normal/abnormal organ report (Liver normal, GB/kidney/prostate abnormal) |
| `06-dark-1440` | Dark theme |
| `07-viewer-collapsed` / `08-viewer-expanded` | Viewer collapse/expand (report column widens) |
| `09-narrow-1024` | Single-monitor width |

**Checks:** no horizontal page overflow at 1024px (asserted programmatically:
`scrollWidth === clientWidth`); report editor retains usable width; viewer
collapsible; organ rail always visible; keyboard shortcuts are disabled while
typing in text fields (guarded in `UsgCompanionWorkspace` keydown handler);
manual edits are never silently overwritten (`addFinding`/normal-merge are
non-destructive — unit-tested). **Not browser-captured:** flag-off fallback (9.9)
and the PCPNDT finalize block (9.10) — both proven by the contract test and the
real-DB PCPNDT test respectively.

## 10. Tests & build

| Gate | Result |
|---|---|
| Frontend typecheck | **0 errors** |
| Full workspace typecheck (`pnpm typecheck`) | **all packages Done** |
| Full `vitest run` **with** DATABASE_URL | **199 files / 2942 tests passed, 0 failures** |
| Canonical routing + platform-contract guards | pass (in the above) |
| PCPNDT + report-lifecycle tests | pass (in the above) |
| Migration-ordering validation | **0 violations** (see note) |
| Production build (`diagnostic-erp`) | **success** |

**Migration-ordering — correction to the earlier report.** The
`check-migration-order` "queue-display" failure I previously reported was a
**false positive of running the suite without a database**; the checker is pure
file I/O and, run directly/with a DB, reports **0 violations** (`queue_display_settings`
is a core drizzle table, so the feature migration's ALTER is valid). There is **no
real pre-existing migration-ordering bug**, and no queue-display code was touched.
DB-less runs still show ~8 api-server suites failing on `DATABASE_URL` import
(pre-existing env-gating) and the new integration test **skips** cleanly.

---

## 11. GO / NO-GO for P2

**Recommendation: GO** — with one staging smoke-test carried into P2 kickoff.

| Gate | Status |
|---|---|
| Live dummy USG workflow passes | **Met at DB + component level** (real-DB draft round-trip; real components rendered). A full browser click-through of the deployed API + Orthanc was not runnable in this ephemeral container — do this once on staging. |
| Structured findings persist through finalization | **Met** — durably in the retained canonical draft (real-DB round-trip); signed report carries rendered text (structured-in-signed-doc is P2+). |
| Canonical lifecycle reuse proven | **Met** (contract test + code). |
| PCPNDT remains fail-closed | **Met** (real-DB gate test). |
| Feature-flag fallback works | **Met**. |
| Shared prostate-volume single source of truth | **Met**. |
| No Critical/High defects remain | **Met** (2 High fixed; 0 Critical). |

**Remaining limitation / condition:** run a one-time live smoke test on staging —
worklist → open `/radiology/usg/:id` → lock → build findings → save → finalize →
open signed report → confirm no legacy USG store row and correct audit author —
plus a viewer check against Orthanc. Everything that could be validated without the
running HTTP server + PACS has been validated here.
