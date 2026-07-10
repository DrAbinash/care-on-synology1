# Canonical Structured Report JSON — Schema + Validator (D1 §19 items 1–2)

Implements the first two build items D1 (`docs/STRUCTURED_REPORT_JSON_SPEC_v1.md`,
revision 2 — **frozen**) names as "what the next phase must build" (§19):

1. `schemas/structured-report-v1.schema.json` — the full normative JSON Schema.
2. A **pure validator** `(document, catalogSnapshot, contentPackRegistries) →
   {ok, errors[], warnings[]}` implementing tiers A + B (§12), with the
   draft-save/finalize severity split as a first-class parameter.

> **FOUNDATION ONLY.** Nothing in the running product reads or writes
> `structured_json` yet. No route, migration, or UI depends on this module.
> D1 §19 item 3 (writer/serializer) now also lives here (see `writer.ts`,
> `canonicalizer.ts`, `hash.ts` below). D1 §19 items 4–6 (up-migration reader,
> the additive `structured_json` migrations + `report_finding_index`, and the
> renderer switch) are **not built here** — see "Next" below.

## Files

| File | What it does |
|------|---------------|
| `types.ts` | TypeScript transcription of D1 §1–§11/§18 — the document shape, every enum, every reference namespace. |
| `schema/structured-report-v1.schema.json` | The normative JSON Schema (Draft 2020-12), D1 §1.5, fully filled out (every `$def`). |
| `validator.ts` | `validateStructuredReport(document, ctx)` — every rule R0–R18 from D1 §12, tagged by rule id, with `ctx.mode: "draft" \| "finalize"` driving the warn/reject split (R8, R15, R16 warn-on-draft/reject-on-finalize; R14/R14b/R14c and R13's signed_by-distinctness half are finalize-only). |
| `canonicalizer.ts` | RFC 8785 JSON Canonicalization Scheme (JCS) — the canonicalization half of D1 §10's hash. Pure, deterministic. (D1 §19 item 3.) |
| `hash.ts` | `content_sha256 = SHA-256( JCS(document minus /audit/content_sha256 and /audit/signature/signed_content_sha256) )`, D1 §10. Non-mutating exclusion strip + `verifyContentSha256`. (D1 §19 item 3.) |
| `writer.ts` | The writer/serializer: assembles a canonical document from its parts (findings/measurements/impression/recommendations/critical-flags/AI-provenance/catalog-snapshot/study-context/provenance/audit) in D1 §1.1 field order, reconciles `provenance.revision`↔`audit.revision` (R10b), stamps `content_sha256` (and, at finalize, `signature.signed_content_sha256`), and optionally round-trips through the validator. Pure and deterministic. (D1 §19 item 3.) |
| `catalogAccess.ts` | Read-only port over the existing B1/B2 `CatalogStore` for R1 (finding./param. global resolution) and R4/R5/R6 (severity/location/measurement/parameter bindings, which are **finding-scoped**, not global scales — §1.4). |
| `aiRulesRegistry.ts` | Port for R15/R16 (`ai_contradiction_rules`/`ai_completeness_rules`). **Honest gap, not papered over:** K1 validates these at pack-import time but no B1/B2 table persists them, so there is today no live source to query. The default port reports `available: false`; the validator then emits a structural warning instead of a false "0 rules, clean pass." Swap in a real implementation once one exists — no validator change required. |
| `goldenExamples.test.ts` | The five worked examples from D1 §17, seeded against a real (in-memory) B1/B2 catalog, validated end-to-end — the load-bearing proof that this module is actually consistent with the frozen spec's own canonical examples, not just internally self-consistent. |
| `validator.test.ts` | One positive control + targeted deliberately-broken variants per rule (R0–R18), against a minimal hand-built document + catalog. |
| `__fixtures__/` | The five golden JSON documents (verbatim from D1 §17), a matching catalog seed, and a small JSON loader. |

## Known gap, flagged not fixed

D1 §9.2's R13 text requires `signature.signed_by` to be "distinct from every
`ai.runs[].actor`/`provider`" at finalize — but the `aiRun` object (D1 §9.1) has
no `actor` field, only `provider`. This is a gap in the frozen spec itself, not
a D1-vs-code conflict. `checkR13SignedByDistinctness` checks the field that
actually exists (`provider`); see the comment at its definition.

## What deliberately is **not** implemented here

- **`meas.` unit UCUM validity** is a lightweight syntactic plausibility check
  (`looksLikeUcum`), not a full UCUM parser — a real UCUM validator is its own
  ticket-sized piece of work, not invented here.
- **R14b/R14c's live lookups** (`audit_logs` row existence; prior-amendment-chain
  state) are injected via optional `ValidationContext.auditLogLookup` /
  `amendsLookup` callbacks. Omitting them degrades to a warning rather than a
  crash or a silent pass — the same honest-gap pattern as `aiRulesRegistry.ts`.
  A future ticket wires these to the real `audit_logs` table and
  `patient_reports`/`radiology_report_drafts` amendment chain.

## Next

Per D1 §19, still to build: (4) the reader/up-migration registry (§2.3); (5) the
additive, flag-gated `structured_json` columns + expression indexes +
`report_finding_index` migrations (§13/§15); (6) the renderer switch and analytics
projection. Item (3), the writer/serializer that emits `structured_json` and
computes `content_sha256` via RFC 8785 JCS + SHA-256 with byte-for-byte golden
fixtures, is now built here (`writer.ts`/`canonicalizer.ts`/`hash.ts`); the
rendered-prose strings it stores are pinned at author time (§3.4/§7) and supplied
to the writer — synthesizing prose is the renderer's job in item (6).
