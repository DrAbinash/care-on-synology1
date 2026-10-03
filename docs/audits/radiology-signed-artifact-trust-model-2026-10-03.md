# CARE Radiology — Signed-Artifact Trust Model

**Production-safe verification and signed-artifact hardening.**
Delivered against the 9-phase specification. Date: 2026-10-03.

Branch `fix/reporting-workspace-end-to-end-integrity` · PR #815 (draft) · head `011f01a0`

> **Nothing in this document was deployed, merged, or run against the production
> database.** All production queries below are read-only and are given for the
> operator to run, not executed here.

---

## Phase 0 — Exact reality, established

The three states are **not** identical, and the gap is larger than it looks.

| State | Commit | Date | Relationship |
| --- | --- | --- | --- |
| **Production** (what the clinic runs) | `2d51e8d7` | 2026-09-16 (PR #722) | 110 commits behind `origin/main` |
| **`origin/main`** | `bc8ca8c5` | 2026-10-03 00:29 +0530 (PR #814) | contains production; merge-base of this branch |
| **This branch** | `011f01a0` | 2026-10-03 | 15 commits ahead of `origin/main`, no divergence |

Production was read from the live `GET /api/health` response, not assumed.
`git merge-base --is-ancestor 2d51e8d7 origin/main` → **yes**, so the branch is
strictly ahead of both; a merge would be a fast-forward of main's history.

**Consequence for the verdicts at the end of this document:** merging this PR
changes *main*, not production. Production moves only when
`deploy-synology.sh` runs on the NAS, and it will then receive all 110 pending
commits at once — not just this work. That is a deployment decision, not a
code one, and it is flagged as a remaining risk.

---

## Phase 1 — Verification of the existing remediation

### CI at the previous head `9904be9c` (run 37096768141)

| Job | Result |
| --- | --- |
| Static checks (typecheck, migration order, grounding) | `completed / success` |
| Tests + migration smoke (real Postgres 16) | `completed / failure` |

Test job totals: **1 failed | 9304 passed | 3 skipped (9308 tests)** across
**1 failed | 816 passed | 1 skipped (818 files)**, duration 346 s.

The 83 DB-gated files that cannot run on the development workstation **were**
exercised: CI provisions `postgres:16-alpine` with
`DATABASE_URL=postgresql://erp:erp@localhost:5432/care_test`, runs
`pnpm db:smoke` then `pnpm db:bootstrap`, then the whole suite with
`--no-file-parallelism`.

- Migration smoke: `✅ total table count unchanged (454)`, `RESULT: 26 passed, 0 failed`
- Bootstrap: `apply-all-migrations: 15 drizzle applied, 184/184 feature migrations OK`

### The single failure — root cause was the test, not the product

`reportQuality.demography.request.test.ts:255` —
`AssertionError: expected [ 'Q005' ] to include 'Q109'`.

The fixture links a DICOM worklist row with sex **F** to a patient master with
gender **male**, and the prose names the uterus. Q109 fires on a *contradiction*
between declared sex and anatomy mentioned
(`lib/report-quality/src/text/evaluate.ts:161-176`). Worklist-wins therefore
resolves sex to F, the uterus is **consistent** with F, and Q109 correctly stays
silent. The assertion demanded Q109 fire — meaning it would only have passed if
the ERP master had beaten the DICOM record. **The test was rewarding the bug it
existed to catch.** The engine was right.

Fixed by inverting the assertion and adding a positive control: the same prose
with no canonical draft must raise Q109, so the silence cannot pass vacuously
when demography resolution returns nothing. Commit `5add85c5`.

**Phase 1 conclusion: the remediation branch had no material regression.** One
inverted assertion, written by this work, on a new test file. Nothing to stop
for.

### CI at head `eb19b73e` (run 37099056964)

| Job | Result |
| --- | --- |
| Static checks (typecheck, migration order, grounding) | `completed / success` |
| Tests + migration smoke (real Postgres 16) | `completed / failure` — **1 test** |

Totals: **1 failed | 9375 passed | 3 skipped (9379 tests)** across
**1 failed | 818 passed | 1 skipped (820 files)**, duration 269.58 s.
Migration smoke: `RESULT: 26 passed, 0 failed`, `✅ total table count unchanged (454)`,
`✅ patient_reports count unchanged (1)`, and — directly relevant here —
`✅ SIGNED report content immutable (b6e05e564e7214de530d37347162b19c)`.
Bootstrap: `apply-all-migrations: 15 drizzle applied, 184/184 feature migrations OK`.

**The single failure was again a test, not the product** —
`signedArtifactTrust.request.test.ts:465`,
`expected 'Staff authentication required' to be 'acknowledger_identity_unavailable'`.
`requireStaffAuth` answers 401 before the handler runs, so the handler's own
401 code is unreachable defense in depth for a caller with no token. The
assertion pinned *which layer* refuses rather than the claim worth making — that
a typed name never becomes the record. Corrected in `011f01a0` to assert 401
plus `criticalAcknowledgedBy`/`criticalAcknowledgedAt` both still NULL, matching
the two sibling unauthenticated tests in the same file.

Every other new DB-gated suite passed on first execution in CI, including all 23
tests of `signedArtifactTrust.request.test.ts` bar that one, and
`internal-reporting-studio.request.test.ts` and `radiologyHardening.request.test.ts`
against the changed bridges.

### CI at head `011f01a0` — the exit condition for Phase 1

Run 37099518715. **Both jobs `completed / success`. Nothing failed.**

| Stage | Result |
| --- | --- |
| Migration order preflight (`migrations/*.sql`) | ✓ No ordering violations |
| Architecture grounding | ✓ **All 105 architecture claims hold against the code** |
| Workspace typecheck | `clinic-site`, `scripts`, `api-server`, `diagnostic-erp` — all **Done**, no errors |
| Migration smoke (clean boot + upgrade safety) | **RESULT: 26 passed, 0 failed** |
| Bootstrap (full migration path) | `15 drizzle applied, 184/184 feature migrations OK` |
| Vitest suite (sequential, one shared Postgres 16) | **9376 passed \| 3 skipped (9379 tests)** across **819 passed \| 1 skipped (820 files)** — **0 failed**, duration 231.45 s |
| Browser smoke (`e2e:smoke`, login shell) | **4 passed (7.9 s)** |

The migration smoke's own signed-artifact probe passed against a real Postgres:
`✅ SIGNED report content immutable (69e6d8becebcba5736aaf062e00344db)`,
`✅ total table count unchanged (454)`, `✅ patient_reports count unchanged (1)` —
i.e. the upgrade path creates no tables and touches no existing report rows.

Both new suites executed against the CI database, not skipped:

```
✓ artifacts/api-server/src/routes/signedArtifactTrust.request.test.ts (23 tests) 1743ms
✓ artifacts/api-server/src/lib/signedArtifactGuard.test.ts          (47 tests) 9ms
```

That answers Phase 1's requirement directly: the DB-gated files that silently skip
on a workstation without `DATABASE_URL` **were exercised in a real CI/test database
environment** at the exact branch head, and they pass.

---

## Phase 2 — Re-verification of RR-01, RR-02, RR-03

Re-derived from current source, independently of the audit that proposed them.

### The decisive measurement

```
git diff origin/main 9904be9c -- artifacts/api-server/src/routes/patient-reports.ts
```

returns **one 7-line hunk** at `:2765` — a fix that stopped the Impression being
printed twice on radiology reports. Nothing else. The PATCH handler, `/sign`,
`/verify` and `/acknowledge-critical` at the branch head before this work were
**byte-identical to production main**, and `auditLifecycleEvent`'s action union
was still exactly `"verify_attempt" | "verify_rejected" | "legacy_sign_rejected"`.

So the ten earlier remediation commits on this branch did not touch the
signed-artifact write path at all. All three findings are classified against
that reality.

---

### RR-01 — signed/finalized content mutable in place → **STILL PRESENT** (at `9904be9c`); **ALREADY FIXED** (at `011f01a0`)

**Evidence at `origin/main` = `9904be9c`, `patient-reports.ts:2139-2196`.**
`PATCH /:id` had exactly two content gates:

```js
if (existing.status === "verified" || existing.status === "delivered") { …409… }
const signedStructured = existing.structuredJson?.audit?.signature?.state === "final";
if (signedStructured) { …409… }
```

Two reachable holes, not one:

1. **`status: "pending_verification"` was not gated.** `/sign` sets exactly that
   status. A legacy-signed report could therefore still take a `body` PATCH —
   the content changed under an existing signature, with no version row and no
   audit entry.
2. **`signedAt` was not a witness at all.** The structured finalize path inserts
   a row with `signedByName` and `signedAt` set while leaving `status` at the
   schema default `"draft"` (`patient-reports.ts:1086-1110` and `:1746-1770`;
   neither insert sets `status`). A signed artifact with no structured document
   — or one whose signature state was not the literal string `"final"` — passed
   both gates.

Hole 2 was not hypothetical. `patient-reports.d6.test.ts` shipped a shared
fixture with `status: "draft"` **and** `signedAt: new Date()` **and**
`signedByName: "Dr. Rao"`, and a test asserting that row accepted body edits.
The test suite had encoded the defect as expected behaviour.

**Fix.** `artifacts/api-server/src/lib/signedArtifactGuard.ts` — pure, DB-free,
session-free.

- `isSignedArtifact(row)` reads **three independent witnesses**: `signedAt != null`,
  `status ∈ {pending_verification, verified, delivered}`, or
  `structuredJson.audit.signature.state === "final"`. Any one is sufficient.
- `classifySignedReportPatch()` refuses `body`, `parameters`, `title`,
  `impression` on any signed row, and returns a machine-readable code
  (`signed_report_immutable`) plus the offending field list.
- Wired at `patient-reports.ts:2174-2190`, **before** any `updates` object is
  accumulated, so a refusal cannot partially persist.
- Re-saving an *identical* value is also refused — otherwise "no change" becomes
  a probe for which fields are guarded.
- Non-clinical metadata still flows, so delivery, sharing and public links are
  untouched.
- Refusals are audited as `signed_mutation_rejected` with the attempted fields.

Correction goes through the **existing** amendment mechanism
(`patient_report_amendments`, `POST /:id/amend`, `radiologyReportVersion.ts`).
No parallel versioning system was created.

---

### RR-02 — critical-result state/acknowledgement improperly clearable → **STILL PRESENT** (at `9904be9c`); **ALREADY FIXED** (at `011f01a0`)

**Evidence at `origin/main` = `9904be9c`.** Two independent defects.

`patient-reports.ts:2180-2186`, inside `PATCH /:id`, **outside both content gates**:

```js
if (typeof b.isCritical === "boolean") {
  updates.isCritical = b.isCritical;
  if (!b.isCritical) {
    updates.criticalNote = null;
    updates.criticalAcknowledgedAt = null;
    updates.criticalAcknowledgedBy = null;
  }
}
```

Unconditional. `{ "isCritical": false }` wiped the acknowledgement on a
**delivered** report — the gates above only covered `body`/`parameters`/`title`/
`impression`. A separate `if (typeof b.criticalNote === "string")` allowed
blanking the note with `""`. The record that a critical result had been
communicated to a treating clinician was erasable by any caller who could reach
PATCH, with no audit row.

`patient-reports.ts:2450-2467`, `POST /:id/acknowledge-critical`:

```js
const acknowledgedBy = typeof b.acknowledgedBy === "string" ? b.acknowledgedBy.trim() : "";
if (!acknowledgedBy) { 400 }
const [row] = await db.update(…).set({ criticalAcknowledgedAt: new Date(),
                                       criticalAcknowledgedBy: acknowledgedBy })…
```

The acknowledger was **whoever the request body said**. There was no
session-derived identity, no check that the report existed before writing (the
update ran first, 404 came from an empty result), no check that the report was
actually critical, no protection against silently overwriting an earlier
acknowledgement, and no audit row.

`businessTime.stage0.characterization.test.ts` had characterized this route as
*"names whoever the body says and writes no audit row"* — an accurate
description of the defect, filed as a contract.

**Fix.**

- `classifySignedReportPatch` returns `critical_state_immutable` when the caller
  tries to set `isCritical: false` on a signed **or** acknowledged row, or to
  blank/whitespace a `criticalNote` once acknowledged.
- **Escalating to critical is always allowed**, at any status. Refusing that
  would suppress a safety signal, which is the opposite of the intent. Editing
  the *content* of a note is likewise still allowed; only its erasure is not.
- `/acknowledge-critical` (`:2558`) now derives the acknowledger from
  `session.subjectName` only, returns 401 `acknowledger_identity_unavailable`
  with no session, 404 before writing, 409 `not_a_critical_report` when the
  report is not critical, and audits `critical_acknowledged`.
- Critical-state changes are audited as `critical_state_changed`.

---

### RR-03 — signer identity and signing instant caller-supplied → **PARTIALLY FIXED** (at `9904be9c`: instant already server-side, identity not); **ALREADY FIXED** (at `011f01a0`)

**Evidence at `origin/main` = `9904be9c`.**

`patient-reports.ts:2244-2256`, `POST /:id/sign`:

```js
let signedByName = typeof b.signedByName === "string" ? b.signedByName.trim() : "";
if (signatureId) { const [sig] = …; if (!signedByName) signedByName = sig.name; }
if (!signedByName) { 400 "signedByName or signatureId required" }
```

The **body name took precedence over the chosen signature record**. A caller
could pass Dr Rao's `signatureId` together with `signedByName: "Dr Somebody
Else"` and the report would carry Dr Rao's signature image attributed to a name
Dr Rao never wrote. No session identity was consulted for the name at all.

`patient-reports.ts:2308-2334`, `POST /:id/verify`: same shape. The
self-verification guard compared `existing.signedByName` against
`verifiedByName` — **two strings the same caller controlled**. Signing as
"Dr A" and verifying as "Dr B" from one session satisfied it, so the
two-person rule was defeatable without a second person.

The **signing instant was already server-side** on the legacy path
(`signedAt: new Date()`), which is why this finding is *partially* rather than
*still* present. No body-supplied `signedAt` existed in this router.

Two machine-key routes were worse. `internal-reporting-studio.ts:811-816` took
both the signer name and the signing instant from the request body behind a
shared `x-api-key`, and `boundary.ts` did the same with
`reportedAt ? new Date(reportedAt) : new Date()` — which pushes an **Invalid
Date** to the driver for unparseable input.

`patient-reports.d9.test.ts` asserted the vulnerable behaviour outright, in a
test titled *"(client-supplied name still honored)"* and with the inline comment
`// legacy path: client name honored`.

**Fix.**

- `resolveSignerIdentity({ sessionName, signatureName, callerSuppliedName })` —
  precedence is **signature record, then session**. The caller's value is never
  read into the report; it is returned as `rejectedCallerName` and preserved in
  the audit row, so a fabrication attempt stays visible without becoming the
  attribution.
- `/sign` (`:2302`) and `/verify` (`:2398`) both use it, and both return 400
  (`signer_identity_unavailable` / `verifier_identity_unavailable`) when neither
  source yields a name, rather than falling back to the body.
- `signedAt = new Date()` at `:2314` — server clock, unchanged in intent, now
  the only source. Verified by grep: no `b.signedAt` anywhere in the router; the
  only body-name reads left are the two `callerSuppliedName:` audit arguments.
- Legacy verify audits as `legacy_verify`, not `verify_attempt`, so a row's
  action still tells you which of the two paths produced it.
- Machine-key routes: `boundRelayedPersonName` (whitespace-collapsed, capped at
  200 chars) and `resolveRelayedInstant` (refuses unparseable or future-dated,
  falls back to the server clock, 5-minute skew tolerance). The server's own
  receipt instant is **always stored alongside** the relayed one, in
  `parameters.serverReceivedAt` and in the audit row, with
  `finalizedAtSource`/`finalizedAtRejected`/`identitySource` recorded. A shared
  key carries no person, so `identitySource: "relay"` is recorded honestly
  rather than disguised as a session.
- `boundary.ts` additionally writes `REPORT_FINAL_SUPERSEDED` preserving the
  previous `finalReportedBy`/`finalReportedAt`/`status` when a re-push replaces
  an existing final report. Those are single columns; without the row the
  superseded attribution was simply gone. The callback still returns `ok` —
  re-pushing a corrected report is that bridge's job — but it is no longer
  silent.

**Why the structured path was not the whole answer.** `performStructuredVerify`
already applied "session identity, never client input", but it is gated behind
`ff_radiology_structured_final`, whose schema default is **false**. The hardened
path is dark in production; the legacy path above is the live one. Hardening
only the structured path would have fixed a code path the clinic does not run.

---

## Phase 3 — One coherent trust model

**Invariant implemented:** SIGNED ARTIFACT = exact signed content +
authoritative signer + authoritative signing time + immutable signed state +
auditable subsequent amendment history.

A single module owns the rules, so the three findings cannot drift apart again:

`artifacts/api-server/src/lib/signedArtifactGuard.ts` (198 lines, pure)

| Export | Role |
| --- | --- |
| `isSignedArtifact(row)` | three-witness test for "is this a signed artifact" |
| `classifySignedReportPatch({…})` | may this ordinary update touch it |
| `resolveSignerIdentity({…})` | who is the signer of record |
| `boundRelayedPersonName(raw, fallback)` | bound a machine-key relay's name |
| `resolveRelayedInstant(raw, now)` | bound a machine-key relay's instant |

It is deliberately free of database, session and Express imports so the rules
are testable in isolation — and so "the guard is correct" can be established
separately from "the guard is reachable", which the HTTP suite then does.

**Routes changed** (`patient-reports.ts`): `PATCH /:id`, `POST /:id/sign`,
`POST /:id/verify`, `POST /:id/acknowledge-critical`, and one new route
`POST /:id/withdraw-signature`.

**Withdraw-signature** is the only route back to an editable draft: signer or
admin only, non-blank reason mandatory, refused once verified
(`already_verified`), refused on a structured-signed row, refused when unsigned
(`not_signed`). It clears `signedByName`/`signedAt`/`signatureId`, returns the
row to `draft`, and audits `signature_withdrawn` with the withdrawn attribution
preserved in the audit payload — so withdrawing a signature does not erase the
fact that it was given.

**Existing infrastructure reused, not reinvented:** `patient_report_amendments`
(linear chain enforced by `UNIQUE(original_report_id)` +
`UNIQUE(amended_report_id)`), `POST /:id/amend`, `radiologyReportVersion.ts`,
`buildReportArtifact`, `versionSafeguardHtml`, `freezeSignedReportPresentation`,
`structuredSignedDocOf`, `performStructuredVerify`, and the hash-chained
`audit_logs`.

**Audit action union widened** from 3 to 9 values. `audit_logs.action` is
`text NOT NULL` with **no CHECK constraint** (`lib/db/src/schema/auditLogs.ts:16-36`),
so this is not a schema change and needs no migration.

**ERP follow-through** (`ReportHub.tsx`): three controls would otherwise have
lied to the user — the two "Override name (optional)" fields and the
`window.prompt("Acknowledged by (your name)?")`. All three posted values the
server now discards, so each was removed rather than left inert. The edit gate
`report.status === "draft"` was extended to also require no signed witness; the
file already knew about that state (it suppressed the Sign button for exactly
those rows) but the edit form and Save Draft button had not caught up. That was
RR-01's reachable UI path.

---

## Phase 4 — Production data safety

### Schema and migrations changed: **NONE**

```
git diff --stat origin/main...HEAD -- lib/db migrations   →   (empty)
```

Across the whole branch: 50 files, 5656 insertions, 234 deletions — and not one
of them under `lib/db` or `migrations`. No `care-db-patch-v2` entry is needed,
no `drizzle-kit push`, no table recreation, no destructive statement, no
deletion of any report, draft or audit record, no database reset.

Everything the trust model needs already exists: `signed_at`, `signed_by_name`,
`signature_id`, `status`, `structured_json` (jsonb), `is_critical`,
`critical_note`, `critical_acknowledged_at`, `critical_acknowledged_by` on
`patient_reports`; `action` as free text on `audit_logs`; `action`/`actor`/
`details` on `radiology_audit_log`.

### Rollout and rollback

- **Backward compatible:** the change is additive to behaviour, not to shape. No
  column added, dropped, retyped, renamed, re-defaulted or constrained. No new
  NOT NULL, no new CHECK, no new unique index. Therefore **no existing row can
  violate anything** — there is nothing to violate.
- **Existing rows:** all remain readable and renderable. `GET /:id`, print, PDF,
  public link, email share and PACS archive are read paths and were not touched.
  Historical and superseded versions still resolve through the existing D8
  version machinery.
- **Rollback:** revert the commits. Because no migration exists, a revert is
  complete on its own — there is no half-applied schema state to unwind, and
  nothing written by the new code is unreadable by the old code. The new audit
  actions are ordinary text values in an existing column; old code simply never
  queries for them.
- **NULL/default behaviour:** unchanged. `signed_at` stays nullable, and a NULL
  `signed_at` on a row whose `status` is `draft` and with no signed structured
  document is still an editable draft. The guard adds witnesses; it does not
  require any of them to be non-null.

### Backfill required: **NO**

No constraint is proposed, so no preflight for constraint violations is needed.
What *is* worth measuring is the **behaviour** change on existing rows — which
rows become immutable that were previously editable. These are read-only and
safe to run on production:

**1. Landscape — how the signed witnesses distribute across statuses**

```sql
SELECT status,
       COUNT(*)                                                             AS rows,
       COUNT(*) FILTER (WHERE signed_at IS NOT NULL)                        AS with_signed_at,
       COUNT(*) FILTER (WHERE (structured_json->'audit'->'signature'->>'state') = 'final')
                                                                            AS structured_final
FROM patient_reports
GROUP BY status
ORDER BY status;
```

**2. The exact set whose editability changes** — signed witnesses at a status the
old code did not gate. Expect these to be structured-finalize rows and any
legacy row left at `pending_verification`:

```sql
SELECT id, report_number, type, status, signed_by_name, signed_at,
       (structured_json->'audit'->'signature'->>'state') AS sig_state,
       is_critical, critical_acknowledged_at
FROM patient_reports
WHERE status NOT IN ('verified', 'delivered')
  AND ( signed_at IS NOT NULL
        OR (structured_json->'audit'->'signature'->>'state') = 'final' )
ORDER BY id DESC;
```

*Expected categories:* (a) rows at `pending_verification` — already treated as
signed by the UI's Sign button logic, so locking their content matches what the
screen implied; (b) rows at `draft` with `signed_at` set — the RR-01 hole, and
the ones worth eyeballing by hand, because a genuine in-progress draft should
have no `signed_at`. **If category (b) contains rows the clinic still considers
work-in-progress, they will need `POST /:id/withdraw-signature` before they can
be edited again.** That is the intended, audited path — not a database edit.

**3. Acknowledged critical results — these become un-clearable**

```sql
SELECT COUNT(*)                                                          AS acknowledged,
       COUNT(*) FILTER (WHERE status IN ('verified','delivered'))        AS already_locked,
       COUNT(*) FILTER (WHERE status NOT IN ('verified','delivered'))    AS newly_protected
FROM patient_reports
WHERE critical_acknowledged_at IS NOT NULL;
```

**4. Signer names on record — evidence of whether RR-03 was ever exercised.**
Compare the distinct names against the people who actually hold signing rights:

```sql
SELECT COUNT(*)                                            AS signed_rows,
       COUNT(*) FILTER (WHERE signature_id IS NULL)        AS no_signature_record,
       COUNT(DISTINCT signed_by_name)                      AS distinct_names
FROM patient_reports
WHERE signed_at IS NOT NULL;

SELECT signed_by_name, COUNT(*) AS n,
       MIN(signed_at) AS first_seen, MAX(signed_at) AS last_seen
FROM patient_reports
WHERE signed_at IS NOT NULL
GROUP BY signed_by_name
ORDER BY n DESC;
```

*A name that appears once, outside anybody's working hours, and matches no
signature record is what a fabricated attribution looks like.*

**5. Boundary-mirrored studies** — the one column whose stored value changes
meaning when the caller omits a name (`NULL` → `"Radiology Service"`):

```sql
SELECT COUNT(*)                                            AS studies_with_final_report,
       COUNT(*) FILTER (WHERE final_reported_by IS NULL)   AS attribution_missing,
       COUNT(*) FILTER (WHERE final_reported_at IS NULL)   AS instant_missing
FROM radiology_studies
WHERE final_report IS NOT NULL;
```

Existing NULLs are **not** rewritten; only new callbacks store the fallback.

**Do not execute any backfill.** None is proposed.

---

## Phase 5 — Adversarial tests

Two new suites plus the existing ones. Every claim in the HTTP suite is a status
code **and a re-read of the stored row** — not an assertion that a
protective-looking string exists in a source file. That distinction is the whole
reason the suite exists: the repo already had grep-style tests that stayed green
while `POST /api/billing/save` returned HTTP 500 on every call.

**New — `artifacts/api-server/src/lib/signedArtifactGuard.test.ts`** (47 tests, pure, all green locally):
the three witnesses; non-final structured states; malformed `structuredJson`
never throws; each protected field individually; multi-field refusal ordering;
re-saving the same value still refused; `undefined` is not a change but `null`
is; critical clearing on signed and on acknowledged-draft rows; note nulling
and whitespace-only nulling; escalation always allowed; note *content* edits
still allowed; string-typed `criticalAcknowledgedAt`; signer precedence;
name bounding (`"Dr.  Rao\n\nRegistrar:\tAnyone"` → `"Dr. Rao Registrar: Anyone"`);
relayed instants — past accepted, within-skew accepted, future refused,
skew+1 ms refused, unparseable → server, absent → server, and the result is
always a valid `Date` never later than `now + skew`.

**New — `artifacts/api-server/src/routes/signedArtifactTrust.request.test.ts`** (651 lines, DB-gated, real HTTP through the production router on PostgreSQL). Marker-scoped fixtures, cleaned up in `afterAll`.

**Existing suites that cover the remaining cases** (all green locally):
`patient-reports.d7.test.ts` (17 tests — amendment atomicity, mandatory reason,
linear chain, rollback on every failure mode, concurrent double-amend),
`patient-reports.d8.test.ts` (28 tests — version resolution, print/PDF/share
artifact selection, superseded watermarks, historical access),
`patient-reports.d9.test.ts` (24 tests — countersign authority, self-verify
refusal, chain integrity, transaction rollback), `patient-reports.d5/d6/pcpndt`,
`reportPresentation.test.ts` (50), `radiologyReportVersion.test.ts` (24),
`pacsArchive.d8.test.ts`, `radiologyHardening.request.test.ts` (HOPE emission).

### The 14 required cases

| # | Case | Where it is proven |
| --- | --- | --- |
| 1 | Draft remains editable | `signedArtifactTrust` #1/#13 (HTTP PATCH → 200, row re-read); `d6` "legacy draft row still accepts body edits" |
| 2 | Unsigned workflow unchanged | `d9` "flag OFF: structured row falls through to the exact pre-D9 legacy guard"; guard suite — unsigned+unacknowledged clearing allowed |
| 3 | Finalized content not overwritable via normal PATCH | `signedArtifactTrust` #3 (409 `signed_report_immutable`, `fields:["body"]`, DB body re-read unchanged, `signed_mutation_rejected` audited); all four protected fields each refused and each naming itself with a before/after byte comparison; **a `super_admin` session is not exempt**; `d6` RR-01 witness |
| 4 | Alternate mutation routes cannot bypass | `signedArtifactTrust` #4 — `/public-link` and `/acknowledge-critical` leave body/impression/title/parameters/signedByName/signedAt untouched; re-sign → 409 `already_signed` with the original instant preserved |
| 5 | Critical state cannot be improperly cleared after verification | `signedArtifactTrust` #5 ×5 — flag not clearable on a signed report; acknowledgement not erasable **even on an unsigned draft**; escalation to critical → 200 with body untouched and `critical_state_changed` audited; unauthenticated → 401; non-critical report → 409 |
| 6 | Client cannot claim another radiologist as signer | `signedArtifactTrust` #6 — a signature record's name wins over `"Dr. Impostor"` (`identitySource:"signature_record"`); unauthenticated sign leaves `signedAt` NULL and status `draft`; `d9` both flipped tests |
| 7 | Client-supplied signing timestamp cannot become authoritative | `signedArtifactTrust` #7 — body claims `2020-01-01`, stored instant is within 120 s of now; guard suite `resolveRelayedInstant` |
| 8 | Server-authenticated identity becomes signer of record | `signedArtifactTrust` #8 — `signedByName === ` the session name, `!== "Dr. Not Me At All"`, `legacy_sign` audit carries `rejectedCallerName` and `identitySource:"session"` |
| 9 | Legitimate amendment/version workflow still works | `d7` — 17 tests: new signed row + snapshot + linkage atomically, parent never written, mandatory reason (blank → 400), typist → 403, already-amended → 409 with rollback, clinical divergence → 409, concurrent double-amend → UNIQUE fires |
| 10 | Original signed artifact still retrievable after amendment | `d8` — `?version=specific` preserves exact historical access clearly marked superseded; `?version=root` serves the chain root from the tip; `signedArtifactTrust` #10/#11/#12 GET byte-identical |
| 11 | Print/export reads the intended signed/versioned artifact | `d8` — print of a superseded id serves the LATEST version with the amended banner and targets side effects at the served row; explicit historical print carries the SUPERSEDED banner + watermark; PDF filename states the delivered revision; WhatsApp link and email body reference the latest version |
| 12 | Existing historical reports remain readable | `d8` — "old clients: existing body fields intact; new keys purely additive"; "no amendment chain: no amendment key, version says no_chain"; "malformed chain fails safe to the requested row and surfaces warnings"; "GET performs NO database writes, whatever the resolution" |
| 13 | Existing drafts remain readable/editable | `signedArtifactTrust` #1/#13; `d6` |
| 14 | HOPE/PACS/downstream not unintentionally broken | `radiologyHardening.request.test.ts` (`emitReportToHope`; sets signed fields by direct `db.update`, never through PATCH, so the guard cannot affect it); `pacsArchive.d8.test.ts`; `reportPresentation.test.ts`; `radiologyReportVersion.test.ts` |

### Five pre-existing tests had to be flipped

Each had asserted the vulnerable behaviour as a contract. Each was flipped
following its own file's documented review convention, with the reasoning inline
so the change is not silent:

- `businessTime.stage0.characterization.test.ts` ×2 — the acknowledge route
  (*"names whoever the body says and writes no audit row"*) and the Studio
  finalize path. That file's header says: *"Do NOT 'fix' a failure in this file
  by changing application code. If a test here turns red, the application
  changed its behaviour and that change has to be reviewed on its own merits."*
  This is that review, recorded.
- `patient-reports.d9.test.ts` ×2 — *"(client-supplied name still honored)"* and
  *"verifies exactly as before"* with `// legacy path: client name honored`.
- `patient-reports.d6.test.ts` ×2 — one assertion updated for the new
  machine-readable error shape (`signed_report_immutable` + separate `message`
  + `fields`, replacing prose in `error`; verified no production consumer
  matched the old string), and one fixture that had made a **signed** row assert
  its own editability.

These five are independent, pre-existing witnesses that RR-01/02/03 were real.

### Bypass surface enumerated, not assumed

Every `update(patientReportsTable)` in `api-server` was read. There are 14, and
**exactly one** writes protected signed content:

| Site | What it writes | Can it bypass the guard? |
| --- | --- | --- |
| `patient-reports.ts:2222` (`PATCH /:id`) | `title`, `body`, `impression`, `parameters`, `isCritical`, `criticalNote` | **the guarded route itself** |
| `patient-reports.ts:129`, `:158`, `:214` | `publicToken`, `publicTokenExpiresAt` | no — sharing metadata |
| `patient-reports.ts:649` (structured countersign, inside a transaction) | `verifiedBySignatureId`, `verifiedByName` (= `session.subjectName`, "never client input"), `verifiedAt`, `verifierNotes`, `status` | no — and already session-authoritative |
| `patient-reports.ts:2315` (`/sign`), `:2418` (`/verify`), `:2582` (`/acknowledge-critical`), `:2673` (`/withdraw-signature`) | signature and lifecycle fields | no — these are the guarded routes |
| `patient-reports.ts:2519`, `:3177`, `:3179`, `radiologyJobHandlers.ts:176`, `:178` | `status: "delivered"`, `deliveredAt` | no — delivery state |
| `barcode-resolver.ts:306` | `status: "delivered"`, `deliveredAt`, `deliveredBy` | no — delivery state |

On the client side, `ReportHub.tsx:736` is the **only** caller of
`PATCH /api/patient-reports/:id` in the entire ERP. There is no second UI path
and no server-to-server path.

`patient-reports.ts:222-223` also confirms `patientReportsRouter.use(requireStaffAuth)`
at router level — which is why an unauthenticated caller receives the
middleware's 401 before any handler runs.

### Local verification at head `011f01a0`

All 28 test files touching a changed surface:
**447 passed, 23 failed, 18 skipped**. Every one of the 23 failures is
`password authentication failed for user "probe"` (`28P01`) from the deliberately
nonexistent placeholder `DATABASE_URL` used to collect the DB-gated files —
**zero non-database failures**. The 3 DB-gated files
(`signedArtifactTrust.request.test.ts`, `internal-reporting-studio.request.test.ts`,
`radiologyHardening.request.test.ts`) can only be executed in CI.

`pnpm --filter @workspace/api-server exec tsc --noEmit` → **exit 0**
`pnpm --filter @workspace/diagnostic-erp exec tsc --noEmit` → **exit 0** (0 errors, better than AGENTS.md documents)

**In CI, where the DB-gated suites actually execute** (run 37099056964):
`signedArtifactGuard.test.ts` **47/47 passed**;
`signedArtifactTrust.request.test.ts` **23 tests, 22 passed, 1 failed** — and the
one failure was an over-specified assertion about *which layer* returns 401, not
about the guard (see §Phase 1). Corrected in `011f01a0`. Every substantive claim
in that suite — the 409s, the untouched rows re-read from PostgreSQL, the audit
rows, the session-derived signer names, the ignored `2020-01-01` timestamp claim
— passed on first execution against a real database.

---

## Phase 6 — Scope discipline

Not done, deliberately: the remaining P1/P2/P3/P4 findings; any UI redesign; any
rewrite of the workspace, the Zustand report-state architecture, the MRI
sub-masters or the observation ledger; any new AI system; any template change;
any cosmetic cleanup; removal of any currently-unused functionality.

The two `WhatsAppReportShareDialog` / `useWorkspaceExportShare` callers that
still post `verifiedByName` were **left alone**. Both pass
`session?.user?.name` — the logged-in user's own name — so the server ignoring
it produces an identical result. Removing the now-redundant prop would touch
three files for no functional gain.

---

## Phase 7 — Durable provenance: recommendation

**`fieldProvenance` is NOT durable today.**

It lives in the Zustand workspace store. `useReportComposer.ts:216-219` sends it
to the composer as `fieldProvenanceSummary`, and
`artifacts/api-server/src/lib/reportComposer/types.ts:97-103` declares a zod
schema for it — after which **nothing in `api-server` or `lib` ever reads it**.
It is parsed and dropped. It never reaches `structured_json`, never reaches a
column, and is not part of any signed artifact. `useDraftPersistence.ts:216`
resets it to `{}` on a refused cross-patient hydration.

**Could it be included as a small natural extension? Yes, mechanically.**
`structured_json` is a `jsonb` column and the structured finalize path already
assembles `prepared.document` at `patient-reports.ts:1106` and `:1763`. A new
key `structured_json.audit.fieldProvenance`, sitting beside the existing
`audit.signature`, is **zero schema change**, purely additive, and invisible to
every current reader (`structuredSignedDocOf` reads only
`audit.signature.state`).

**Should it go in this PR? No — and the reason is not size.**

A client-declared provenance map is *caller-supplied attribution about
authorship*. That is precisely the class of claim Phase 3 refuses to trust for
the signer's name. Persisting the browser's assertion would create a durable
record inside a signed artifact that **looks** authoritative and is not — a
strictly worse outcome than having no provenance at all, because it would be
cited. Doing it properly means deriving provenance server-side, from data the
server already owns: the AI execution/review rows (`aiExecution.ts`,
`radiologyAiReviewAudits.ts`, `aiReportComposer.ts`) and the observation ledger.
That is a design question with its own verification burden, and it is not
required by RR-01, RR-02 or RR-03.

**Recommendation:** a separate follow-up that (1) derives field provenance from
server-owned AI job and observation records rather than accepting a client map,
(2) stores it under `structured_json.audit.fieldProvenance` so no migration is
needed, and (3) surfaces it in the signed artifact's audit view. Do not widen
this PR for it.

---

## Phase 8 — Pre-adoption clinical readiness

### Acceptance test (the gate before first real clinical use)

> **One real study, end to end, signed by one person and verified by a
> different person, printed, delivered, then amended — and afterwards the
> original signed version is still retrievable byte-identical with its own
> signer and signing instant, while the amendment carries its own reason and its
> own signer. No step may require a database edit, and no step may succeed with
> a name that was typed rather than authenticated.**

If any clause fails, the workspace is not ready and the failure is a blocker,
not a known issue.

### Manual smoke-test protocol

Run on a **test** patient, on the deployed build, with two separate staff
logins available. Every step states its expected result.

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Log in as the radiologist who will sign | Staff Login at `/login` accepts username + PIN; the header shows **that** person's name |
| 2 | Open the Reporting Workspace on a study with a linked bill | Study loads; patient name, age and sex at the top match the **DICOM worklist** row |
| 3 | Compare demography against the ERP patient master where they disagree | The **worklist** value wins on screen and in the quality rules; a female-master/male-worklist mismatch does not suppress a sex-contradiction rule |
| 4 | Enter Clinical History, reload the page | Text is still there (draft autosave persisted it) |
| 5 | Enter Technique | Persists across reload; **appears in the final PDF** |
| 6 | Enter Findings | Persists; no AI text appears that was not requested |
| 7 | Generate Impression, then edit Findings | The Impression is marked **stale**; it is not silently presented as current |
| 8 | Add a Recommendation | Any orphaned or unsupported advice is **named at signing**, not dropped silently |
| 9 | Trigger Validation | The quality gate runs **once** at sign-off and reports real rule IDs; "no recommendation given" (Q005) fires if step 8 was skipped |
| 10 | Sign | Status → `pending_verification`. Signer of record = the logged-in name, or the chosen signature record's name. **There is no name field to type into.** Signing time = server clock: compare it against the workstation clock and the NAS time and confirm it is the server's |
| 11 | Re-open the signed study | Findings / Impression / Recommendation are **read-only**; no Save control, or Save is refused with a clear message |
| 12 | Attempt to un-tick Critical on a signed critical report | **Refused.** The message says the critical state is locked |
| 13 | Acknowledge a critical result as the second user | A **confirmation** dialog — not a name prompt — states the acknowledgement is permanent and attributed to the logged-in user. Afterwards the record names that user |
| 14 | Log out; log in as the second radiologist; Verify | Verifier of record = that person. **No name field.** |
| 15 | Attempt to verify your own signature (same login as signer) | **Refused** with a clear "must be a different person" message |
| 16 | Print / PDF | Contains Clinical History **and** Technique, exactly **one** Impression, both names and both timestamps. No SUPERSEDED watermark |
| 17 | Print the same report twice | **Identical output** both times |
| 18 | Check Radiology Worklist and the study record | Status shows reported/verified; the report is retrievable from the study |
| 19 | Check PACS/ERP/downstream (HOPE emission if configured) | No new errors; downstream receives the same report text |
| 20 | Amend the signed report, leaving the reason blank | **Refused** (400), nothing written |
| 21 | Amend with a reason | A **new** report row is created; the original is untouched; the reason is stored and displayed |
| 22 | Open the original version explicitly | Still retrievable, rendered **with a SUPERSEDED watermark**, carrying its original signer and signing instant |
| 23 | Print the superseded id | Serves the **latest** version, with an amended banner — never the old content presented as current |
| 24 | Amend the same original a second time | **Refused** — the chain is linear |

### Adversarial clinical tests

| # | Scenario | Expected result |
| --- | --- | --- |
| A | Start an AI draft on Study A; switch to Study B before it returns | The delayed answer does **not** land in Study B. B shows only B's own content |
| B | Undo (Ctrl+Z) after switching patients | Does **not** restore Study A's text into Study B |
| C | Change Findings after the Impression was generated | Impression marked stale; signing warns or requires regeneration |
| D | Sign while an AI proposal is still pending/unreviewed | **Refused**, or the unreviewed proposal is explicitly named — it cannot be signed silently |
| E | Critical finding: mark, sign, then try to un-mark | Un-marking **refused** (409). Acknowledgement names the logged-in user, survives re-login, and cannot be cleared |
| F | Amend a signed report | New version; original intact and retrievable with a SUPERSEDED watermark; reason mandatory; linear chain |
| G | Re-open a finalized study | Read-only. The only routes to change are **Amend** or **Withdraw signature** (signer or admin, reason required). Withdrawal returns it to an editable draft while the audit keeps the withdrawn attribution |
| H | Print after finalization, repeatedly | Byte-identical each time; superseded ids serve the latest with a banner; explicit historical access is watermarked; the PDF filename states the revision |

---

## Final deliverable

1. **Production / main / remediation comparison** — §Phase 0. `2d51e8d7` (production) → `bc8ca8c5` (`origin/main`, +110) → `011f01a0` (branch, +15, no divergence).
2. **CI status** — §Phase 1 and §CI at head `011f01a0`. At the final head `011f01a0` (run 37099518715): **both jobs `completed / success`, nothing failed** — static checks green, and **9376 passed | 3 skipped (9379 tests)** across **819 files passed | 1 skipped (820)**, plus browser smoke **4 passed**. The previous head `eb19b73e` had one failure (9375 passed / 1 failed / 3 skipped) and that failure was an over-specified assertion in a new test, not the product; corrected in `011f01a0`.
3. **DB-backed test status** — CI provisions `postgres:16-alpine`; the DB-gated files **do** run there. Migration smoke `26 passed, 0 failed`, `454` tables unchanged, `patient_reports` count unchanged, and its own `✅ SIGNED report content immutable` check green. Bootstrap: `15 drizzle applied, 184/184 feature migrations OK`. The two new suites executed against a real database and **both are fully green at head**: `signedArtifactGuard` **47/47**, `signedArtifactTrust` **23/23**.
4. **RR-01 / RR-02 / RR-03 current status** — §Phase 2. All three **STILL PRESENT** at `9904be9c`; **ALREADY FIXED** at `011f01a0` (RR-03 was *partially* fixed before: the instant was already server-side, the identity was not).
5. **Exact implementation performed** — §Phase 3.
6. **Files changed** — *by this delivery* (the last 5 commits): 11 files — `signedArtifactGuard.ts` (new, 198), `signedArtifactGuard.test.ts` (new, 363), `signedArtifactTrust.request.test.ts` (new, 651), `patient-reports.ts`, `patient-reports.d6.test.ts`, `patient-reports.d9.test.ts`, `reportQuality.demography.request.test.ts`, `internal-reporting-studio.ts`, `boundary.ts`, `businessTime.stage0.characterization.test.ts`, `ReportHub.tsx`. *Whole branch vs `origin/main`:* 50 files, 5661 insertions, 234 deletions.
7. **Schema / migrations changed** — **NONE**. §Phase 4.
8. **Existing production-data impact** — no row becomes invalid, unreadable or unrenderable. Behaviour change: rows carrying a signed witness at a status the old code did not gate become immutable, and acknowledged critical results become un-clearable. Measured by the five read-only queries in §Phase 4. One column changes meaning on **new** writes only: `radiology_studies.final_reported_by` stores `"Radiology Service"` instead of `NULL` when the boundary caller omits a name.
9. **Backfill requirement** — **NONE**. No constraint is proposed, so nothing can violate one. Preflight queries are supplied to *measure* the behaviour change, not to authorize a write. No backfill was executed.
10. **Tests added and results** — §Phase 5. 47 new pure tests + 23 new HTTP tests; 447 passed locally across the 28 changed-surface files with zero non-database failures; in CI at head **`signedArtifactGuard` 47/47 and `signedArtifactTrust` 23/23**; 5 pre-existing tests flipped with recorded reasoning.
11. **Before → after behaviour** — the table below.
12. **Remaining risks** — the list below.
13. **Durable-provenance recommendation** — §Phase 7: not durable today (parsed and dropped at `reportComposer/types.ts:97`); mechanically trivial to add under `structured_json.audit.fieldProvenance` with zero migration; **defer**, and derive it server-side rather than persisting a client claim.
14. **Manual pre-adoption clinical smoke-test protocol** — §Phase 8: 24-step protocol + 8 adversarial scenarios + one acceptance gate, each with its expected result.
15. **PR URL** — https://github.com/DrAbinash/care-on-synology1/pull/815. **Note: this PR is open, not a draft** (`draft: false` on the GitHub record). It is green and mergeable, so it is one click away from `main`. Nothing has been merged and nothing has been deployed; the branch state is reported here so the operator makes that click deliberately. Verdict A below is the recommendation about it.
16. **Final HEAD SHA** — `011f01a09db86ff9e335c1f533a9b7f15f71bce8` is the **CI-verified code head** (run 37099518715, both jobs green). Exactly one commit follows it on the branch: the docs-only commit carrying this document and its two companions. It contains no code, no schema and no migration, so it cannot change behaviour — but it is the branch head, and CI re-runs on it. Every SHA cited elsewhere in this document refers to code state and is unaffected.

### Before → after

| Action | Before (`origin/main` = `9904be9c`) | After (`011f01a0`) |
| --- | --- | --- |
| PATCH `body` on a report at `pending_verification` | **200 — content changed under an existing signature** | 409 `signed_report_immutable`, audited, nothing written |
| PATCH `body` on a row with `signed_at` set at `status: draft` | **200 — same** | 409, audited |
| PATCH `{isCritical:false}` on a **delivered** report | **200 — wiped the note, the acknowledger and the acknowledgement instant** | 409 `critical_state_immutable`, audited |
| PATCH `{criticalNote:""}` after acknowledgement | **200 — note blanked** | 409, audited |
| PATCH `{isCritical:true}` (escalate) | 200 | **200 — unchanged, at any status** |
| PATCH delivery/share metadata on a signed report | 200 | **200 — unchanged** |
| `/sign` with `signedByName: "Dr. X"` | **200 — report attributed to Dr. X** | 200 — attributed to the signature record, else the session; "Dr. X" recorded as `rejectedCallerName` in the audit row |
| `/sign` with `signedAt` in the body | already ignored | **still ignored — server clock only** |
| `/verify` signing as "Dr. A" then verifying as "Dr. B" from one session | **200 — two-person rule satisfied by two typed strings** | 409 — the verifier is the authenticated session, so self-verification is caught |
| `/acknowledge-critical` with `acknowledgedBy: "<anybody>"` | **200 — recorded that name, no audit row, no check the report was critical, write before the 404 check** | body name never read; session identity only; 401 / 404 / 409 `not_a_critical_report`; `critical_acknowledged` audited |
| Undo a signature | no route; the only way was to overwrite the content | `POST /:id/withdraw-signature` — signer or admin, reason required, refused once verified, attribution preserved in the audit row |
| Studio `/finalize` with a future `finalizedAt` | **stored as the signing instant** | refused; server clock used; `finalizedAtSource`/`Rejected` audited; `serverReceivedAt` always stored |
| Studio `/finalize` with a multi-line `radiologistName` | **stored verbatim into the signature block** | whitespace-collapsed, capped at 200 chars |
| Boundary `/studies/:acc/report` with unparseable `reportedAt` | **Invalid Date pushed to the driver** | server clock, with the rejection reason audited |
| Boundary re-push over a finalized study | **previous attribution silently overwritten — the study became a different report under a different name** | still accepted, plus a `REPORT_FINAL_SUPERSEDED` audit row preserving the prior name, instant and status |
| Report Hub sign/verify dialogs | offered an "Override name (optional)" field | field removed; a line states where the name actually comes from |
| Report Hub critical acknowledgement | `prompt("Acknowledged by (your name)?")` — the answer was discarded and the action attributed to the session | `confirm(...)` stating the acknowledgement is permanent, attributed to the logged-in user, and cannot be cleared |
| Report Hub edit gate | `status === "draft"` — offered a live Save Draft button on a signed-at-draft row | also requires no signed witness; lock notice names the signer and points at amendment |
| `auditLifecycleEvent` actions | 3 | 9 (`legacy_sign`, `legacy_verify`, `signed_mutation_rejected`, `critical_state_changed`, `critical_acknowledged`, `signature_withdrawn` added) |

### Remaining risks

1. **`ff_radiology_structured_final` defaults to `false`.** The structured countersign path — with its hash-chained document, prepare/validate steps and richer refusals — is **dark in production**. The legacy path is the live one. This work hardens **both**, so the P0 findings are closed either way, but the stronger machinery stays off until the flag is enabled. *Operator action: confirm the flag's state in Settings and decide whether to enable it before the pilot.*
2. **`signatures` has no foreign key to `users`** (`lib/db/src/schema/signatures.ts:7-17` — only `name`, `role`, `qualification`, `registrationNo`, `imageDataUrl`, `isActive`). A signature block therefore cannot be cryptographically tied to a session user. Choosing somebody else's signature record is still permitted — by design, since that is how a registrar signs for a radiologist — so the signer of record can be a name the logged-in user picked from a list. It is now bounded to active records and audited, but it is **not** equivalent to "only Dr Rao can sign as Dr Rao". Closing that needs a schema change (FK or an explicit delegation table) and is out of P0 scope.
3. **No amend action in Report Hub.** `POST /api/patient-reports/:id/amend` has no ERP caller; Report Hub has a full *read* side for amendment chains (version banners, superseded watermarks, re-delivery prompts) but no way to start one. This is **pre-existing** — verified and delivered reports were already uncorrectable from that screen — and this change extends it to signed-at-draft rows. A signed pathology report with an error currently needs an API call or the Reporting Workspace. Small follow-up, not a P0 fix.
4. **Machine-key bridges still relay a name.** The Studio and Boundary callers authenticate with a shared `x-api-key`, so there is no person to substitute. Names are now bounded, instants are validated, and the server receipt time is always stored — but a compromised key can still attribute a report to any radiologist. The real fix is per-caller credentials mapping to a service identity.
5. **`boundary.ts` has no test coverage**, before or after this change. Its hardening is verified by typecheck and by reading, not by execution. This is the weakest-evidenced change in the PR, and the federated Radiology Service it serves is a separate deployment that cannot be exercised locally.
6. **Report Hub's Critical switch is disabled on any signed report**, so escalating *to* critical — which the server explicitly permits at any status — has no UI on a signed row. Pre-existing for verified/delivered.
7. **Production is 110 commits behind `main`.** Nothing from #799–#815 is live. Merging this PR does not reach the clinic until `deploy-synology.sh` runs on the NAS, and when it does, all 110 pending commits land together. Deploying is a separate decision with its own risk, and it should not be conflated with approving this PR.
8. **Legacy-path audit writes are best-effort.** `auditLifecycleEvent` delegates to `auditLog`, which catches and swallows its own failures (`lib/audit.ts:146`). A signature withdrawal nulls `signedByName`/`signedAt`/`signatureId` and then writes the audit row that preserves them; if that write failed, the attribution would be gone. The structured countersign path does not have this property — it inserts into `audit_logs` inside the same transaction as the row update, with hash chaining, so an audit failure rolls the update back. Bringing the legacy actions onto the same transactional chain is a contained but separate change, and it was not folded into this PR. The exposure is narrow: `withdraw-signature` is the only legacy action that destroys data the audit row is the sole remaining copy of.

---

## Verdict A — SAFE / NOT SAFE TO MERGE

# **A: SAFE TO MERGE.**

Reasons, each tied to evidence above rather than to confidence:

1. **No schema change, so no migration risk.** `git diff origin/main...HEAD -- lib/db migrations` is empty. There is nothing to apply to the production database, nothing to backfill, and no table recreation. Rollback is a plain `git revert` — no data migration to unwind, which is the usual reason a production merge is hard to undo.
2. **CI is fully green at the exact head.** Run 37099518715: static checks `success` (typecheck clean in all four packages, 105/105 grounding claims, no migration-order violations) and tests `success` (**9376 passed, 3 skipped, 0 failed**, 819/820 files), migration smoke **26/26**, bootstrap **184/184 feature migrations**, browser smoke **4/4**. The single failure seen at the previous head was in my own new test, not in the product, and it is fixed.
3. **The three P0 findings are closed with executing tests, not assertions about source.** All 14 required adversarial cases are covered by HTTP-level tests against a real Postgres (§Phase 5), including the negative cases that matter most: a client naming another radiologist as signer, a client-supplied signing instant, and clearing an acknowledged critical result. 47 + 23 new tests, all green in CI.
4. **Read paths are untouched.** No change to report retrieval, PDF/print rendering, amendment-chain rendering, public-token sharing, or PACS/HOPE delivery. The migration smoke's `✅ patient_reports count unchanged (1)` and `✅ total table count unchanged (454)` corroborate that existing rows are neither rewritten nor orphaned. Existing historical reports and drafts remain readable; drafts remain editable (§Phase 5 cases 13–14).
5. **The bypass surface was enumerated, not sampled.** All 14 `update(patientReportsTable)` call sites are tabulated (§Phase 5); exactly one writes protected content, and it is now guarded. The sole ERP caller of `PATCH` was updated in the same delivery so the UI no longer offers an edit the server will refuse.
6. **Merging is not deploying.** Synology deploys from `main` only, via `deploy-synology.sh`, and production is already 110 commits behind. This PR reaching `main` changes nothing in the clinic until that script is run — which is a separate decision, covered by Verdict B.

Two caveats that do not change the verdict but should be read with it: `boundary.ts` is hardened without test coverage (remaining risk 5), and the PR is **currently not a draft**, so it can be merged with one click. Merging is safe; the click should still be deliberate.

## Verdict B — READY / NOT READY FOR FIRST CONTROLLED CLINICAL PILOT

# **B: NOT READY FOR FIRST CONTROLLED CLINICAL PILOT.**

This is a narrow "not ready", not a judgement that the code is unsafe. The integrity
model is now correct and tested. What is missing is that the pilot has never been
*run*, and two decisions only the operator can make are still open.

Blocking items, in the order they should be resolved:

1. **The pre-adoption protocol in §Phase 8 has never been executed by a human.** The 24-step smoke test and 8 adversarial scenarios are written with expected results for every step, but no clinician has sat at a deployed build and walked Patient → Demography → History → Technique → Findings → Impression → Recommendation → Validation → Sign → Re-open → Print → PACS/ERP. Automation proves the API refuses what it should refuse; it does not prove the workflow is usable under clinical time pressure. **This is the acceptance gate, and it is unrun.**
2. **`ff_radiology_structured_final` defaults to `false`.** The stronger path — hash-chained signed document, prepare/validate steps, transactional audit with rollback — is **dark in production**. Both paths are now hardened, so the P0 findings are closed either way, but the pilot would exercise the legacy path. *Operator action: confirm the flag's state in Settings and decide, deliberately, which path the pilot runs on.*
3. **A signed report with an error cannot be corrected from Report Hub.** `POST /api/patient-reports/:id/amend` has no ERP caller (remaining risk 3). This is pre-existing — verified and delivered reports were already uncorrectable from that screen — and this delivery extends it to signed-at-draft rows, because those are now correctly locked. For a pilot where a radiologist signs and then spots a mistake, the correction route has to exist in the UI they are using, or the pilot will stall on the first real amendment. **This is the one item I would fix before the pilot rather than during it.**
4. **Signer attribution is bounded and audited, but it is not non-repudiation.** `signatures` has no foreign key to `users` (remaining risk 2), so the signer of record can be a name the logged-in user picked from a list of active signature blocks. Choosing someone else's block is legitimate — that is how a registrar signs for a radiologist — and the choice is now recorded with the rejected caller-supplied value beside it. But if the pilot's acceptance criteria include "only Dr Rao can sign as Dr Rao", that needs a schema change and is out of P0 scope.
5. **Production is 110 commits behind `main`.** The build that would be piloted has never run as a whole anywhere. Merging this PR and then deploying lands all 110 pending commits at once. The pilot should follow a deployment that has itself been verified on the NAS, not be conflated with it.
6. **Machine-key bridges still relay identity** (remaining risk 4). Only relevant if the pilot includes the Reporting Studio or the federated Radiology Service; irrelevant for a Report Hub / Reporting Workspace pilot.

**What would make it ready:** enable (or knowingly leave off) the structured flag; add the
amend action to Report Hub; run the §Phase 8 protocol end to end on a deployed build and
record the actual result of all 24 steps and 8 adversarial scenarios; then pilot on a
small, chosen set of studies with the radiologist present, rather than switching routine
reporting over.

---

## Appendix — CI record at the final head `011f01a0`

Run **37099518715**, both jobs `completed / success`.

| Stage | Result |
| --- | --- |
| Migration order preflight | ✓ No ordering violations |
| Architecture grounding | ✓ All 105 architecture claims hold against the code |
| Workspace typecheck | `clinic-site`, `scripts`, `api-server`, `diagnostic-erp` — all Done |
| Migration smoke | RESULT: **26 passed, 0 failed**; ✓ SIGNED report content immutable (`69e6d8becebcba5736aaf062e00344db`); ✓ total table count unchanged (454); ✓ patient_reports count unchanged (1) |
| Bootstrap | `apply-all-migrations: 15 drizzle applied, 184/184 feature migrations OK` |
| Vitest (sequential, one shared Postgres 16) | **9376 passed \| 3 skipped (9379 tests)** — **819 passed \| 1 skipped (820 files)** — duration 231.45 s |
| New suites | `signedArtifactTrust.request.test.ts` **(23 tests)** ✓ 1743 ms; `signedArtifactGuard.test.ts` **(47 tests)** ✓ 9 ms |
| Browser smoke (`e2e:smoke`) | **4 passed (7.9 s)** |

For contrast, the previous head `eb19b73e` (run 37099056964) was
`1 failed | 9375 passed | 3 skipped (9379)` — the one failure being
`signedArtifactTrust.request.test.ts:465`, an over-specified assertion about *which
layer* returns 401, corrected in `011f01a0` (§Phase 1).
