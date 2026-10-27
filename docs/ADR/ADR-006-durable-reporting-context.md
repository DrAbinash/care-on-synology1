# ADR-006: A Durable Effective Reporting Region (PRIORITY 3 design)

## Status

Proposed — **design only**. This document implements nothing: no column, no migration, no store
change, no new renderer. It states what is true today (measured at `ae7b09ed`, the head of the PR
#970/#971 stack), what the four different "regions" a report has actually mean, where each one is
stored today and where it is lost, and the migration + backward-compatibility strategy to follow if
the owner accepts it.

## Date

2026-10-13

## Context

One MRI report answers four different questions about anatomy, and CARE currently keeps the answers
in four different places, only one of which survives a reload:

| the question | who decides it | where it lives today | survives save + reload? |
| --- | --- | --- | --- |
| What was **booked**? | the centre, at billing | `radiology_worklist.study_description` (`lib/db/src/schema/radiologyWorklist.ts:22`), reached as `draft.studyName` / `catalogTestName` when printing (`artifacts/api-server/src/routes/radiology-report-generator.ts:2286-2291`) | yes — it is the database row |
| What was **imaged**? | nobody records it | nothing. `dicomBodyPart` is carried as *provenance only* (`artifacts/diagnostic-erp/src/lib/reportingStudyContext.ts:114-115`) and no table stores sequences or coverage | n/a |
| What region is the radiologist **reporting**? | the radiologist, in the Region control | `regionOverrides`, hook-local `useState` (`artifacts/diagnostic-erp/src/hooks/useReportingStudySetup.ts:164`) | **no** |
| What anatomy does the report **document**? | derived | computed at render from the booked title + the stored transition record (`radiology-report-generator.ts:2298-2301`, `lib/report-quality/src/reportingScope.ts`) and capped for automatic selection by `documentedCoverageCeiling()` (`artifacts/diagnostic-erp/src/lib/regionTransition.ts:483-495`, PR #971) | derived, so yes — from the record only |

The one region fact that does persist is the ADR-004 decision itself:
`careRegionTransitions` is written into the draft envelope
(`artifacts/api-server/src/lib/structuredJsonColumn.ts:319`) and restored before hydration
(`artifacts/diagnostic-erp/src/hooks/radiology-workspace/useDraftPersistence.ts:328-330`,
`regionTransition.ts:274-305`). The *choice that produced it* is not stored, so after a reload
`studyRegions` collapses to the automatic reading (`useReportingStudySetup.ts:241-244`) and the
provenance can only ever be `billed` / `dicom` / `auto` / `unresolved` — never `override`
(`:256-264`). That is the whole of PRIORITY 3: **the report's own record outlives the decision, and
the page therefore reads differently before and after a reload.**

Two further measured facts bound the design.

* **A signed report carries no region decision at all.** `radiologyD1FinalWriter.ts:422` fills
  `body_region` from `worklist?.studyDescription` — the booked name — and
  `careRegionTransitions` never enters the D1 document, so `extractCareRegionTransitions()` on a
  signed document returns `[]` (`structuredJsonColumn.ts:173-180`). The scope sentence PR #970 added
  is therefore printed on a *draft* page and absent from a *signed* one. The ADR-004 text says this
  plainly (`docs/ADR/ADR-004-region-transition-safety.md:388-391`): putting that line on a signed
  report is a compatibility decision, and this document is where it gets made.
* **There is no second source of truth to fall back on.** `regionOverrides`, `reportingContext`,
  `selectedTemplateId` and `activeProtocol` appear nowhere in the save body
  (`hooks/radiology-workspace/useDraftPersistence.ts:474-540`), in the request schema
  (`radiology-report-generator.ts:1636-1680`) or in the envelope (`structuredJsonColumn.ts:304-320`).
  `reportingContext` is a store field (`store.ts:710`) with exactly one writer
  (`setReportingContext`, `store.ts:3844-3855`), fed by one effect
  (`useReportingStudySetup.ts:513-517`) that recomputes it from live values.

## Decision

### 1. Four names, four owners, and only one derived value

Adopt explicit vocabulary so the four facts stop being conflated in code and on paper:

```
bookedRegion      — read-only, from the worklist/tests row. Never written by the workspace.
imagedRegion      — UNKNOWN unless a source exists. See §5; nothing invents it.
selectedRegion    — the radiologist's decision: { regions: string[], source: "override",
                    decidedBy, decidedAt, studyId }
documentedCoverage — DERIVED, never stored: f(selectedRegion ?? autoRegion, careRegionTransitions)
                     = the existing documentedCoverageCeiling(), PR #971
```

`documentedCoverage` stays derived on purpose. Storing a second copy of a value two PRs just learned
to compute would create exactly the class of defect #967/#970/#971 were about: a stored answer that
disagrees with the record that produced it. **The rule is: persist decisions, derive conclusions.**

### 2. Persist one new envelope key, add no column

Add a single optional key to the draft envelope that already carries every other reporting
provenance — `radiology_report_drafts.structured_json`:

```
careReportingContext: {
  kind: "care.reporting_context.v1",
  studyId: number,               // radiology_worklist.id — see §4
  regions: string[],             // exactly what the Region control showed
  source: "override" | "billed" | "dicom" | "auto",
  decidedBy: string | null,
  decidedAt: string | null,      // ISO, set only when source === "override"
}
```

* Writers: the same places that write `regionOverrides` today (`useReportingStudySetup.ts:362, 476,
  928, 964, 986, 1002, 1012`) and the draft save (`hooks/radiology-workspace/useDraftPersistence.ts:474-540`, one new field in
  the body it already posts).
* Readers: `studyRegions` (`:241-244`) restores from it when `regionOverrides` is `null`, and
  `documentedCoverageCeiling()` keeps taking `(source, regions, records)` unchanged — so PR #971's
  two arms need no edit, they simply receive the true source after a reload instead of `billed`.
* `source` is only ever `override` when a human acted, which is what makes requirement 8 (a stale or
  malformed record must not silently change scope) decidable: a persisted context that cannot be
  parsed is dropped, the automatic reading resumes, and the refusal path already in place reports it.

**No migration, therefore no `care-db-patch-v2` file.** JSONB keys are additive;
`db-schema-verify` compares columns, so nothing in the deploy gate changes; an unpatched clinic
database is not involved at all. This is the reason the key is preferred over a column, not merely
convenient.

### 3. The signed report: put the sentence in the body, not beside it

Two ways to make a signed page state its documented region:

* **(a) add a pointer to the hash exclusion list** — `HASH_EXCLUDED_POINTERS` today removes exactly
  two members (`artifacts/api-server/src/lib/structuredReport/hash.ts:39-42`, the self-digest and the
  signature digest). Adding a third would mean a field that can change a signed report's meaning
  while its signature still verifies. Rejected.
* **(b) render the scope sentence into the report body before hashing** (recommended). The sentence
  is a clinical statement about this report; it belongs inside what was signed, and then the existing
  `verifyContentSha256` gate (`radiologyStructuredRead.ts:212-216`) protects it rather than excusing
  it. Reports signed before the change keep their stored body bytes and render byte-identical —
  the same property PR #970 relied on for drafts ("null for every report that has never been
  re-regioned", `radiology-report-generator.ts:2294-2297`).

(b) touches the finalize body builder, so it is a separate PR from the persistence work, and it is
the one item here that changes bytes on a signed page. It needs the owner's explicit yes.

### 4. Bind the context to a study, and stop the partial reset preserving it

`clinicalStateReset.ts:18-22` states that identity and context fields are deliberately *not* in
`emptyClinicalState()` "because the PARTIAL path must preserve `reportingContext`", and
`studyTransitionReset` (applied at `hooks/radiology-workspace/useDraftPersistence.ts:220`) keeps it while `selectStudy`
clears it (`store.ts:1106`). So one of the two study-change paths carries the previous study's
region into the next one until the setup effect overwrites it — a real cross-study inheritance
window, closed today only by the ordering of that effect.

Fix shape (this is the pattern PR #834 and #905 already use): `studyId` inside the persisted context
(§2), asserted by every reader; a mismatch is treated as absent, never trusted. Then
`reportingContext` can join the clinical reset list, because the value that survives is the one
re-hydrated from the draft of the study being opened, not the one left behind.

### 5. What this deliberately does not claim

* **`imagedRegion` stays unknown.** Nothing in CARE today records which sequences were acquired or
  which anatomy they covered; `dicomBodyPart` is a study-level string used for matching, and no table
  holds per-series coverage. Inferring "imaged" from a booked name or from a template would be the
  same fabrication the coverage ceiling exists to prevent. If the clinic wants that fact, it comes
  from the DICOM/CARE-PACS side (the D2 image-identity work), not from a guess here.
* **The booked identity is never rewritten.** `study_description` stays the printed heading
  (`radiology-report-generator.ts:2286-2291`), which is what PR #970's scope note supplements rather
  than replaces.
* **No parallel engine.** One context builder (`reportingStudyContext.ts`), one ceiling
  (`documentedCoverageCeiling()`), one scope sentence (`reportingScope.ts`), one renderer per medium.
  This design adds a persisted input to the existing chain; it adds no second chain.

### 6. If a column is ever needed

Not needed for §2-§4. If a future requirement makes the region queryable (a report list filtered by
documented region, an audit export), the established recipe is the one to follow, in this order:

1. one file in `migrations/`, `ADD COLUMN IF NOT EXISTS`, nullable, **no default** —
   the exact precedent is `migrations/add_radiology_structured_json_columns.sql:15-20`, and
   `HOW_TO_ADD_DB_MIGRATIONS.md:16-28` is the contract;
2. `node scripts/check-migration-order.cjs` before commit (`HOW_TO_ADD_DB_MIGRATIONS.md:57-63`);
3. the column must appear in the Drizzle schema *and* in what `care-schema-verify` expects, because
   that gate compares expected↔live (`docker-compose.yml:164-207`) and a mismatch leaves
   `schema_deploy_state` unwritten, which blocks deploy rather than warning;
4. forward-upgrade proof on a scratch database: drop the column, write a legacy row without it, apply
   the one file, show the old report renders byte-identically;
5. never `db:push` as the deployment step — `care-db-patch-v2` is the only thing that touches the
   clinic's database.

## Consequences — against the ten requirements

Today → after §2-§4. "met" means measured, not assumed.

| # | requirement | today | after |
| --- | --- | --- | --- |
| 1 | preserve original billed region | met — it is the worklist row, and no path writes it | unchanged |
| 2 | preserve explicit region override | **not met** — `regionOverrides` is `useState` (`useReportingStudySetup.ts:164`), absent from save body, schema and envelope | met by `careReportingContext.regions` |
| 3 | preserve transition history | met — `careRegionTransitions` (`structuredJsonColumn.ts:319`) | unchanged; the new key references it, never replaces it |
| 4 | bind saved context to the right patient and study | **partly** — the draft row is per-study, but `reportingContext` is not study-stamped and the partial reset preserves it (`clinicalStateReset.ts:18-22`) | met by `careReportingContext.studyId` + §4 |
| 5 | restore the intended reporting context after reopening | **not met** — reload re-derives from the booking, so `source` can never be `override` (`useReportingStudySetup.ts:256-264`) | met; the ceiling arms receive the true source |
| 6 | Generate, Quick Select, screening, baseline ownership and rendering agree | they agree on **live** state: template pick (`:527,750,795,841`), Quick Select (`resolvedChocolateBoxSet(studyContext)`), coverage scope (`store.ts:3009-3035`), baseline ownership (`store.ts:1747,1961`), print (`radiology-report-generator.ts:2298`) — but after a reload every one of them re-agrees on the *booked* region | they agree on the restored one, because all read the same context |
| 7 | support an explicit decision to widen again | met in-session (PR #971's `override` arm caps at the chosen regions); lost on reload | met durably, with `decidedBy`/`decidedAt` naming who widened |
| 8 | prevent stale or malformed transition records silently changing scope | met for the record — an unreadable one is dropped, not coerced (`structuredJsonColumn.ts:170-172`), and `documentedCoverageCeiling` returns null without one | met for the context too: unparseable ⇒ absent ⇒ automatic reading + refusal |
| 9 | prevent cross-study context inheritance | **not met** — one of the two reset paths preserves it (§4) | met by the `studyId` stamp |
| 10 | preserve manually authored findings and abnormalities | met — fill-empty-only apply and per-row provenance; `careAppliedPatterns` / `careObservationLedger` persist (`structuredJsonColumn.ts:309,318`) | unchanged; nothing here rewrites text |

Three gaps (2, 4/9, and the signed-page half of 6) are the actual work. Everything else is already
true and must stay true, which is what the test plan pins.

## Open questions for the owner

1. §3(b) changes what a **signed** page contains for a re-regioned report (a sentence added inside
   the hashed body). Reports already signed are untouched, but this is the first item in the design
   that alters a new signature's bytes. Yes or no?
2. Should a restored explicit choice be *visibly* marked as such on the Region control ("chosen by
   you on 13 Oct, by Dr …")? The data for it exists in §2; the UI does not exist yet, and a
   radiologist who narrowed a report and came back the next day cannot currently tell whether CARE
   remembered them.
3. `imagedRegion` (§5): acceptable to leave permanently unknown, or is the clinic willing to feed
   per-series coverage in from CARE-PACS, which is where the fact actually lives?

## Test plan (for the implementation PRs, not this document)

* Red first: reopen a report whose explicit Cervical choice was saved, and assert the region control
  and `documentedCoverageCeiling` still answer `override` — today it answers `billed`.
* Red first: open study B after study A with an override, and assert B's context is B's, with A's
  `studyId` refused — the §4 window.
* Positive controls that must stay green with no edit: `N3`/`T4` (nobody re-regioned → the booking's
  own declaration), `A`/`D` of PR #971's acceptance table, every draft print page of a report that
  was never re-regioned (byte-identical), and `verifyContentSha256` on already-signed reports.
* Mutation: delete the `studyId` assertion, drop the restore path, and make an unparseable context
  fall back to the previous study's — each must be caught by a named test.
* Browser, on the synthetic fixtures: narrow → save → reload → Generate → print → PDF → sign →
  re-print, reading the page each time, because requirements 5 and 6 are only evidenced by what the
  paper says.
