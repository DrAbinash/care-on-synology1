# OWNER VISION — CARE Composer 99.9 (authoritative product statement)

**Status: canonical record of an owner-approved design, transcribed 2026-10-20.**
This file records what the owner has approved. It is not a plan, not an audit, and not a
measurement of the code — §4 states, element by element, what the tree at `origin/main`
`1c80f2d3` actually does against that approval.

## 0. Provenance, stated honestly

* The brief that commissioned this file asked for `CARE_COMPOSER_OWNER_VISION.md` to be read.
  **No such file exists in this repository.** `git ls-tree -r origin/main` has no match for
  `CARE_COMPOSER_OWNER_VISION`, and `git grep -i -e "CARE Composer 99.9"` returns nothing on any
  tracked path. Until this file merges, the owner's approved vision exists only in conversation
  transcripts — which is why an agent that re-derives "report structure" from the code alone can
  reach a different answer than the owner intends.
* The vision text in §1 and §2 is therefore **transcribed verbatim from the owner's own words in the
  assignment of 2026-10-20**, not paraphrased and not extended. Anything the owner did not say is
  kept out of §1–§3 on purpose. Where the implementation needs a name the owner did not give, §3
  records the code's name and marks the difference; it does not redefine the owner's term.
* "Do not invent additional requirements" is treated as binding: no new section, no new gate, no new
  workflow step appears in this file.

## 1. Approved report structure

The reporting sequence is, in the owner's order:

1. **Demography**
2. **Name of Examination**
3. **Technique**
4. **Findings**
5. **Impression**
6. **Recommendations** (when appropriate)

**NO separate Conclusion section.** The Impression *is* the clinical conclusion; a second section
with that heading is not permitted.

## 2. Approved core workflow

1. Open examination.
2. An anatomy-specific normal report appears.
3. Quick Select replaces the relevant normal findings.
4. The Impression updates automatically.
5. Unrelated normal findings remain intact.
6. Manual edits are preserved.
7. Deselecting restores the appropriate normal text safely.
8. Save / reopen / print preserve content and identity.

**USG Studio is the functional reference** for how that workflow should feel and behave.

## 3. Vocabulary bridge (owner's words → the tree's words)

The owner's labels are the product contract. The code uses different identifiers for some of them.
Both are recorded so that neither gets "fixed" into the other.

| Owner's term | Nearest thing in the tree | Notes |
|---|---|---|
| Demography | `lib/institutionalReportStyle.ts:45` `DemographyAlign`, `:138` `coerceDemographyAlign`, `:447` `style?.demographyAlign`; `lib/reportStudyIdentity.ts:55` `mergeReportDemography`; the client component named `ReportDemography` (`routes/…reportIdentityIntegrity.request.test.ts:991` refers to it) | The word **is** used, as `Demography`, in style and identity code — but `git grep -i "name of exam"` returns **zero** hits repo-wide, so no heading literally reads "Name of Examination". |
| Name of Examination | the booked test name resolved from `testsTable.name` (at `routes/internal-reporting-studio.ts:867-871` the report title is built as *"<test name> — Report"*, falling back to `study.modality`) plus `radiology_studies.studyDescription` | Rendered as the report **title** and in the examination/scope line, not under a "Name of Examination" caption. |
| Technique / Findings / Impression | `structuredReport/renderer.ts:311` / `:320` / `:241`,`:267` emit these headings, in that order | See §4. |
| Recommendations | `structuredReport/renderer.ts:365` emits the heading **`Recommendation`** (singular) | The singular/plural difference is real and unresolved; it is a wording question for the owner, not a defect claim. |
| Conclusion | **no such section exists in any emit path** — see §4.2 | |
| USG Studio | a **separate deployed application**, not part of this repo: `/volume1/docker/usg-reports` → `usg-reporting-studio` (Next) + `usg-reporting-caddy` (`https usg.caredeoghar.com`), SQLite `data/db/studio.db` via Prisma (`docs/ai-memory/workspace-analysis.md:11`, `:42`) | CARE ERP talks to it over a keyed bridge: `routes/internal-reporting-studio.ts`, mounted at `/internal/reporting-studio` (`routes/index.ts:297`), guarded by `requireStudioKey` (`internal-reporting-studio.ts:77`, `:91`), with additive v6 fields in `lib/reportingStudioContract.ts:33`. "Functional reference" therefore means *the behaviour to match*, not code to reuse. |

## 4. What the tree does against the approval (measured at `1c80f2d3`)

Every row is a `git grep`/read result on `origin/main`, not an inference from a PR number.

### 4.1 Section order — IMPLEMENTED, not registered

* `artifacts/api-server/src/lib/structuredReport/renderer.ts` pushes parts in this order:
  **Technique `:311` → Findings `:320` → Impression `:241`/`:267` → Recommendation `:365`**. Options
  `includeTechnique` (`:55`, default `true` `:68`) and `numberImpression` (`:53`, default `true` `:67`)
  gate the Technique block and impression numbering.
* The print/PDF path reads a stored **`sectionOrder`** preference whose default is
  `"Technique,Findings,Impression"` — `routes/radiology-report-generator.ts:1169`,
  `lib/institutionalReportStyle.ts:629`, `routes/radiology.ts:3543` — then walks it at `:1232` and
  appends Clinical History (`:1238`) and Recommendation (`:1241`) when the stored list omits them.
* **Gap:** the default `sectionOrder` string contains no Demography and no Name-of-Examination entry,
  because those are rendered as the letterhead/demography block and the title rather than as
  `sectionOrder` members. So the owner's six-part sequence is realised across **two mechanisms**, and
  **no single register in the repository defines it.** `git grep -e "sectionOrder"` finds the string
  above; nothing asserts "Demography → Name of Examination → Technique → Findings → Impression →
  Recommendations" as one ordered contract. A clinician-visible reordering bug would not be caught by
  any current test. This is the single most important sentence in this file.

### 4.2 No separate Conclusion — ENFORCED, with one documented fold

* No print, PDF or screen path emits a "Conclusion" heading: `git grep -n -i -e "Conclusion"` over
  `lib/structuredReport`, `lib/institutionalReportStyle.ts` and `diagnostic-erp/src/lib` returns only
  the fold below and the detector name in §4.3.
* Where a stored body *does* carry a Conclusion key, it is **folded into Impression rather than
  rendered separately**: `artifacts/diagnostic-erp/src/lib/storedReportBody.ts:44-45` maps
  `"CONCLUSION" → "impression"` and `"CONCLUSIONS" → "impression"`.
* A report that produced both an Impression and a Conclusion was treated as a defect class long
  enough to be named in the golden-correctness contract: `duplicateConclusion` appears in
  `artifacts/api-server/src/lib/clinicalGolden/contract.ts:121` and in the per-modality case files
  (`mriBrain.ts:83`, `mrcp.ts:151`, `ctAbdomenContrast.ts:66`, and others).
* Verdict: the owner's rule is **implemented and defended**. Nothing here needs building.

### 4.3 Workflow steps 1–8, one line each

| Step | State on `1c80f2d3` | Evidence |
|---|---|---|
| 1 Open examination | implemented | workspace entry; `hooks/radiology-workspace/`, `workspace/ReportCanvas.tsx` |
| 2 Anatomy-specific normal appears | implemented | `zai-workspace/fullReportBaseline.ts:366` `materializeFormatBaseline` (per-slot baseline rows) + `zai-workspace/store.ts:1909` `generateProfessionalReport`, with `:2338` `composeInstantReport` as the decision wrapper |
| 3 Quick Select replaces relevant normals | implemented | `lib/quickSelectFindingsPayload.ts`, `store.ts` overlay path (`applyPathologyOverlay`), tiles server-owned via `routes/radiologyQuickFindings.ts`; rules `lib/quickSelectSlots.ts` (Billing) and `lib/quickSelectBoxRules.ts` |
| 4 Impression updates automatically | implemented | `lib/findingsImpressionDependency.test.ts`, `lib/observationLedger.ts:407` `impressionBasis`, `lib/impressionProvenance.ts` |
| 5 Unrelated normals remain intact | implemented | `lib/clinicalSelection/normalSuppression.ts` + `normalSuppression.test.ts`; one supersession rule across all four write doors (#1070/#1071/#1072) |
| 6 Manual edits preserved | implemented, **partly deferred** | `lib/reportSignatureWithdrawal.ts`, `observationPersistence.hardening.test.ts`, `lib/reportSectionCaretReveal.test.ts` (the caret-reveal behaviour was **deliberately deferred** in #1031 pending an acceptance battery — see `OPEN_WORK.md`) |
| 7 Deselect restores normal text safely | implemented | `zai-workspace/withdrawSupersededNormals.ts` + `withdrawSupersededNormalFindings.test.ts`, `lib/sharedBaselineRetirement.test.ts` |
| 8 Save / reopen / print preserve content and identity | implemented, **two gaps named, not browser-proven on the merged tree** | `routes/radiologyWorkspaceDraftRoundTrip.request.test.ts` (server round-trip over real Postgres), `lib/reportIdentityIntegrity.request.test.ts` (signer/demography identity), `pnpm preview:reports` for rendered output. **Since this row was first written:** #1085 (`47b739c8`, merged, not deployed) made a missing key image *say so* instead of printing a black square (`reportPresentation.ts:515`), which is this step's honesty half. Two gaps remain against "preserve content and identity": **save/reopen** — `serializeReportSnapshot` omits `findingsMap`, so structured Findings edits can be lost silently (`CLINICAL_SAFETY_REGISTER.md` §7); **identity** — an unsigned report can print `"Signed: Dr. …"` from the static letterhead (`reportPresentation.ts:715-717`, §9 OPEN-2), which is exactly the display-name-vs-signature confusion this vision forbids |

None of the eight is *deployed*: the clinic runs a build from 2026-10-12 whose commit identity is
unproven (`CURRENT_STATE.md` §1).

### 4.4 Where the vision and the tree are still in tension

* **Signature vs display name.** The owner's rule for this documentation pass — *never confuse a
  report display name with an authorized digital signature* — is a real distinction in the code and
  is **not** covered by any existing register. A report finalised through the USG Studio bridge stores
  `signedByName: radiologistName` where that value is **relayed in the request body** and merely
  bound/truncated by `lib/signedArtifactGuard.ts:183` `boundRelayedPersonName` (fallback: the literal
  string `"Reporting Studio"`), at `routes/internal-reporting-studio.ts:845`, `:889`, `:890`. The ERP's
  own sign path instead writes `signedByName: session.subjectName`
  (`routes/patient-reports.ts:1192`, `:1861`). Two doors, two different trust levels for the same
  printed name. Full evidence and severity in `CLINICAL_SAFETY_REGISTER.md` §9.
* **"Recommendations" vs the emitted "Recommendation"** heading (§3).
* **No single ordered definition of the six sections** (§4.1 gap).

## 5. Rules that travel with this vision

Restated because they constrain every future change to the reporting surface — they are the owner's,
not this document's inventions:

* Do not weaken clinical prose to satisfy a test: anatomy, laterality, measurements and uncertainty
  stay in the sentence. If a guard demands otherwise, the guard is the defect.
* USG Studio is the reference *behaviour*; adding a second reporting surface inside CARE ERP is the
  recurring failure mode this project has been audited for (see the B-10 family in
  `COMPLETED_WORK.md` §C).
* A merged PR is not a deployed product; a green suite is not a radiologist's acceptance.
