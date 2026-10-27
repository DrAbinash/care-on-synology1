# AI integration handover — 2026-10-21 (Qoder → Z.ai)

Scope of this file: the CARE AI→report work I owned, what is now on `main`, what is still
open, where my remaining changes collide with Z.ai's Composer branch, and the exact patch
for the one defect I could not close inside someone else's ownership.

Verified against, measured 2026-10-21: `origin/main` = `22ee3a59`; Z.ai's open PR #1105 head
= `7927f8da` (base `5ebc88f3`); my branch `feat/ai-output-shape-guard` carries item B as
`5bd2404a` with the commit that adds this file on top of it. After this handover I start no
further development, merge nothing, and deploy nothing; Z.ai owns Composer, PACS and Smart
Dictation implementation.

---

## A. Completed work, and where it actually is

**Merged into `main`.** Each was squash-merged, so the PR head SHA is not an ancestor of
`main`; verify by tree, never by SHA. Measured: `git diff --stat f76069f2 22ee3a59` is **empty**
— `main`'s tree is byte-identical to PR #1116's head, so nothing from that PR was dropped or
partially taken.

| PR | Squash on main | What it is |
| --- | --- | --- |
| #1111 | `b1b4dc1a` | The AI doors stopped trusting the browser about which patient a study belongs to: every identity the door files is read from this clinic's own billed row. |
| #1113 | `2d7d654b` | One clinician's saved AI draft could be replaced by another's, silently. The save door now verifies the row it is about to overwrite. |
| #1115 | `9b54f9c6` | The viewer's "Insert Into Report" answered success and put the text nowhere. The door now queues into the reporting workspace's own review path. |
| #1116 | `22ee3a59` | The owner's three rulings of 2026-10-21 (below). |

**#1116, ruling by ruling** — all three browser-proven against the local rig before merge:

1. *Accepted AI Findings must not silently conclude an Impression.* `store.ts:3721-3732`: the
   automatic pass computes `authoredByAiAlone` per sentence and splits `withheld` /
   `remaining`, and a withheld sentence arms the "needs refresh" pairing instead of passing in
   silence (`refusedAutomaticSentences(…) || withheld.length > 0`). Pressed controls pass no
   `automatic`, so they still do what the radiologist asked.
2. *A refused send must leave a trace.* `aiReporting.ts` `auditInsertRefusal(user, facts)` plus
   six refusal call sites. The row is the examination, the reason and the actor. Read back off
   this rig after a real click on a signed report:
   `1087 | user=Dr. Aria Synth | draft=849 | ok=false | prompt=null | imgs=0 | demographics=false | inserted=false | msg=REPORT_LOCKED: …`.
3. *Accepting AI text must not relabel the clinician's own sentences.* `applyAiComposerAccepted`
   (`store.ts:4768`) stamps `ai-draft` on the sentences it wrote, sentence by sentence
   (`already.has(key)` skip at `markField`), not on the field.

**This branch (`5bd2404a`, item B of the assignment): AI output is validated before it can be
inserted.** 8 files, +510/−4. A successful model response is no longer the gate:

- `lib/report-quality/src/aiDraftShape.ts` (new, 109 lines) — shape-only classifier.
  `findAiReportTextDefects(text)` (`:69`) reports at most one defect per kind with the offending
  line; `describeAiReportTextRefusal(defects)` (`:102`) is the clinician's sentence. Three kinds:
  `conversational` (a preamble, self-reference, or advice about the report), `markdown`
  (bullets/headings/blockquote/bold/code, line-anchored plus an inline test), `structured`
  (a JSON/YAML body, quoted `"key": value` lines, XML tags). It never rewrites, trims or
  reinterprets a sentence.
- `artifacts/api-server/src/routes/aiReporting.ts:2629-2641` — the door refuses: HTTP 409,
  `code: "AI_TEXT_NOT_REPORT_PROSE"`, `defects` in the body, `auditInsertRefusal(...)` filed,
  draft row untouched.
- `artifacts/diagnostic-erp/src/lib/aiDraftBinding.ts:109-136` — the workspace's queue read
  filters the same rule (`pendingReportInserts`) and exposes the withheld rows
  (`unfitReportInserts`), so a draft stamped `inserted` before the guard existed cannot reach
  Findings through Apply.
- `useWorkspaceClinicalUi.tsx:2609-2622` — withheld rows are named on screen. A silent drop
  would look like a saved draft that vanished.

Why the rule sits in `@workspace/report-quality`: it is the repo's one canonical report-quality
layer, imported by the ERP and by `api-server/src/lib/ai/rulesBeforeAi.ts`, and it is not a file
#1105 touches. Server and client cannot drift, and no second AI engine was created.

**Evidence grades.** Browser-proven on the rig (Playwright Chromium, API 8080 on scratch DB
`care_draft_br`, Vite 5199, local `gemma3:12b`, synthetic study `1.2.840.113619.2.99.70001` /
`ACC-20261021-MR-003`, no real patient data): refusal of chat wording with the toast and the
audit row; the same draft cleaned to prose accepted and staged; the withheld-legacy toast; the
Impression hold and the pressed refresh; the signed-report refusal. Test-proven only: the
identity refusals (`aiPatientIdentityFlow.request.test.ts`, 24 request-level tests over real
PostgreSQL + Express 5). Not proven at all: see B5.

---

## B. Outstanding defects

**B1. Sentence provenance has no column — the reopen half is still broken.** Nothing stores who
wrote which sentence. `useDraftPersistence.ts:259` sets `fieldProvenance: {}` on hydration, and
the three `setEditorContent(…)` calls at `:273`, `:633`, `:647` pass no second argument, so
after Save → Close → Reopen every sentence reads as clinician-authored again. This is pinned,
not assumed: `aiAttributionRestoreJourney.hardening.test.ts:107-119` ("the defect as it stands
on main") asserts `toEqual(["manual"])` for a sentence the AI wrote. Consequence for ruling 1
and ruling 3: on a reopened report the hold cannot tell AI wording from the doctor's own, so
the protection only works within one editing session. The exact patch is D1. It is Z.ai's to
apply, because three of the five files it touches are in #1105.

**B2. Chat wording that is already inside a saved report stays there.** The guard refuses new
sends; it does not edit a report body. Measured on this rig right now: `radiology_report_drafts`
id 2 carries `Here's a two-sentence report based on your dictated findings and clinical
history:` in `raw_findings`, applied before the guard existed. I did not remove it, because
deleting a sentence from a clinical document without the radiologist reviewing that deletion is
the failure the owner has ruled against twice. The safe shape is a *review affordance* — list
sentences whose stored provenance is `ai-draft` and let the clinician accept or strike them —
which needs B1 first.

**B3. The withheld notice fires per study-open.** It lives in the workspace's queue-read effect.
If Z.ai moves or re-times hydration (it is moving it, in #1105), the notice has to move with it
or the row becomes invisible again. `useDraftBinding`'s filter is the safety; the toast is only
the visibility.

**B4. `was_inserted_to_report` is stamped per draft, so a later success rewrites an earlier
refusal.** The success path ends with
`UPDATE ai_reporting_audit_logs SET was_inserted_to_report = true WHERE draft_id = …`, which is
every row that names the draft, including the refusals. Measured on this rig: the same chat draft
was refused (`1768`, `1769`, `msg=AI_TEXT_NOT_REPORT_PROSE…`) and then, after the clinician
cleaned it in the drawer and sent it successfully, both refusal rows read `inserted=true`. The
column answers "did this draft ever reach a report", not "did this request insert", which is
what ruling 2's trail needs it to mean when someone asks how often a study was sent into a signed
report. Suggested shape of the fix, not applied here: scope that update to the request rows —
`and(errorMessage is null)` — so a refusal keeps saying it was a refusal. A refusal created before
any success is unaffected (`1087` still reads `inserted=false`), which is why this only bites in
the correct-the-wording flow the new guard deliberately invites.

**B5. Not proven, and I am not claiming it.** The OHIF image-selection leg (no PACS on this
box, so no browser run has ever pressed it). The Quick Select → ledger → normal-retirement leg
*after* an AI insertion is covered by tests (`aiAcceptanceBoundary.hardening.test.ts`, Z.ai's
`quickSelectRetirementPreview.test.ts`, `observationOwnership.phase12.test.ts`) but was not
browser-verified in this round. The print/PDF of a report whose Findings came from an accepted
AI draft was verified in the earlier save/reopen phase, not re-run today.

---

## C. Integration with Z.ai #1105 — measured, not assumed

**One overlapping file.** `useWorkspaceClinicalUi.tsx`. Z.ai's hunks are at 802 (+7), 1128 (+10)
and 1230 (+4) — the by-id worklist-detail read and the study-context fallback. Mine are at
144 (import) and 2609-2622 (the queue-read effect), roughly 1,400 lines below. Nothing else
collides: #1105 does not touch `aiReporting.ts`, `aiDraftBinding.ts`, `stagedAiProposals.ts`,
or `lib/report-quality/**`.

**Both merge orders are clean and produce the same tree.** Measured in a throwaway worktree at
`22ee3a59`: `main → #1105 → 5bd2404a` exits 0, `main → 5bd2404a → #1105` exits 0, and the two
resulting trees are the identical object `715c3aa1de714078ef56b408bb9796dc2213e235`.

**The safeguards compose rather than compete.** In the merged tree: my `authoredByAiAlone` hold
at `store.ts:3721-3732`, Z.ai's `previewImpressionFromLedger` at `:3955` and
`markImpressionReviewed` at `:3947` (which carries its own `refuseSignedMutation` guard at
`:3952`). Z.ai's Phase-3 preview is read-only — it proposes without writing — so it cannot
silently conclude AI wording, which is what ruling 1 forbids; the pressed control still passes
through the ownership rules. Merged-tree verification run: 138 tests across the two PRs'
safeguard suites (`aiDraftShape` 20, `stagedAiProposals` 14, `aiDraftBinding` 4,
`aiAcceptanceBoundary` 40, `impressionManualProsePreservation` 20, `askFirstHoldSemantics` 11,
`impressionRefreshPreview` 5, `aiPatientIdentityFlow.request` 24 against PostgreSQL), and
`tsc --noEmit` for `diagnostic-erp` clean at the merged tree.

---

## D. Recommended final implementation

### D1. Persistent sentence provenance — smallest reliable way, for Z.ai to apply

**No migration is required.** Provenance is per-draft state of the same kind the report already
keeps in `radiology_report_drafts.structured_json`, which has exactly one server writer and a
declared, tested envelope. Adding a column would mean a forward-only migration, a second writer
of the draft row, and a new reader — three places to drift. This route touches five existing
places and reuses an existing store API.

The envelope's four-member measurement group is deliberately *not* where this goes: two tests
pin that group's patch list and must be widened together whenever a member is added
(`radiology-report-generator.formatState.test.ts:168`). Provenance gets its own single-member
term.

1. **Server, write** — `artifacts/api-server/src/lib/structuredJsonColumn.ts`: add an
   `editorProvenance?: unknown` term to `composeStructuredJsonColumn` (`:284`), the matching
   `if (prov) env.careEditorProvenance = prov;` line, an `extractCareEditorProvenance(existing)`
   reader for the keep-what-is-stored branch, and its key in `StructuredJsonPatchInput`
   (`:356-378`). Add it to the "nothing to write" guard on the same terms the other keys are
   there. In `buildCareStructuredJsonPatch` (`:400`) use `!= null` (absent means *keep stored*,
   like `observationLedger`) — not `!== undefined`, which would let an autosave that carries no
   provenance wipe the stored map.
2. **Server, request** — `routes/radiology-report-generator.ts`: one declared zod field beside
   `canalApProvenance` (`:1645`). Undeclared fields are dropped by `SaveDraftBody` (`:1599`) and
   that silent strip is exactly how `spineReporting` was lost once before.
3. **Client, payload** — `useDraftPersistence.ts` payload builder (`:470-485`, next to
   `rawFindings: live.findingsText`): send `editorProvenance` from the live store
   (`readWorkspaceClinicalTexts()` already reads the texts; provenance is
   `useWorkspace.getState().fieldProvenance`). Bound it the way measurements are bound
   (`boundCareViewerMeasurements`, `structuredJsonColumn.ts:95`): a sentence→sources map for a
   long report is a few hundred small keys, and an unbounded payload into `structured_json` is a
   regression risk on its own.
4. **Client, hydration** — a new `@/lib/editorProvenanceRoundTrip.ts` in the image of
   `structuredViewerMeasurements.ts:300-308` (`extractCareCanalApProvenance`) that reads the key
   back, and the three `setEditorContent(…)` call sites (`:273`, `:633`, `:647`) pass it as the
   existing second argument. The signature already exists — `store.ts:967` takes
   `preserved?: PreservedRestoreProvenance`, implemented at `:1600`, type at
   `aiAttributionRestore.ts:37-40` — which is why this is five small edits rather than a new
   mechanism. Only `WorkspaceOverlays.tsx:819` (the Restore button) uses it today.
5. **Legacy and unknown text — fail the same way the product already does.** A draft with no
   stored `careEditorProvenance` must hydrate to `manual` for every sentence, i.e. today's
   behaviour and `RESTORE_FALLBACK_SOURCE` (`aiAttributionRestore.ts:49`). The comment there is
   the rule to keep: `manual` is "the answer to *unknown*, not evidence of authorship". Never
   infer `ai-draft` from wording, from a provider column, or from the presence of a draft row —
   that would relabel a radiologist's dictation as machine text, which is the opposite of the
   owner's ruling 3 and the reason `contributionProtected()` exists. Absence of evidence means
   absence of an AI claim.

**What this buys:** rulings 1 and 3 survive a save/reopen; `authoredByAiAlone` can withhold AI
wording on a reopened report, not only within one session; and B2's review affordance becomes
possible without guessing.

**Regressions that must land with it** (write them first, they are the acceptance test):
- Seam, not ends: `workspaceDraftEnvelopeRoundTrip.test.ts` already imports the real api-server
  module by relative path from an ERP test — extend it with `editorProvenance` so a spelling
  mismatch between writer and reader goes red. A test that hand-copies the compose cannot fail.
- Flip `aiAttributionRestoreJourney.hardening.test.ts:119` from `toEqual(["manual"])` to the
  stored `["ai-draft"]`, keep `:156` (a hand-written line stays `manual`) and add the
  mixed-field case: one accepted AI sentence plus two typed ones → only the first is `ai-draft`.
- Full chain on the rig, synthetic only: Insert → Save → Close → Reopen → Edit → Save → Print,
  asserting the AI sentence is still `ai-draft` after reopen, the edited clinician sentence is
  `manual`, and the print body is unchanged by any of it.
- Mutation-proof the two directions: one mutant that drops the write, one that breaks the
  reader's key spelling, one that swaps the fallback to `ai-draft` (that one must fail loudly —
  it is the false-accusation direction).

### D2. Item B's fold-in

Nothing to reconcile: it merges clean in both orders (C). Two things to preserve if Composer
persistence is rewritten — (a) `POST /insert-to-report` must keep answering 409 with `error`,
`code` and `defects`, because that body is the clinician's whole correction path in the
viewer's drawer (`DicomViewer.tsx:283` `insertMutation`, refusal toast at `:301-308`); and (b)
if the queue read moves out of `useWorkspaceClinicalUi.tsx`, move the `unfitReportInserts` toast
with it rather than dropping it.

---

## E. Tests to keep

| Suite | Count | What it pins |
| --- | --- | --- |
| `lib/report-quality/src/aiDraftShape.test.ts` | 20 | ten accepting prose cases (numbered conclusions, `Findings: …`, `Note the …`, measurements, laterality), the measured local-model chatter, fenced JSON, XML, one-report-per-kind, and that a refusal sentence names the shape, says nothing changed, and points at Saved Drafts. |
| `artifacts/diagnostic-erp/src/lib/stagedAiProposals.test.ts` | 14 | the queue: prose offered, chat withheld and reported, a cleaned draft taken back. |
| `…/aiPatientIdentityFlow.request.test.ts` | 24 | the door over real HTTP + PostgreSQL: identity, empty, no-worklist, signed, refusal-audit content, shape refusal, and that the signed report outranks the draft's own wording. |
| `…/aiAcceptanceBoundary.hardening.test.ts` | 40 | ruling 3's sentence-scoped stamping, A13 group at `:780`. |
| `…/impressionManualProsePreservation.test.ts` | 20 | ruling 1 and 3 on the store side: `manual` Findings prose survives the automatic refresh byte-for-byte (`:261`), a hand-authored Impression is not touched by it (`:369`), an automatic refresh leaves no draft identity behind for a reopen to lose (`:383`); `acceptIntoFindings` is the shared setup (`:135`). |
| Z.ai #1105 | 11 + 5 | `askFirstHoldSemantics`, `impressionRefreshPreview` — pass in the merged tree. |

### E.1 The required matrix, and how far each row is actually proven

Rig = synthetic study only, `1.2.840.113619.2.99.70001` / `ACC-20261021-MR-003`, scratch DB
`care_draft_br`, local `gemma3:12b`. Browser = clicked in Playwright Chromium and recorded in
`tmp/insert-browser-evidence.<phase>.json` with screenshots in `tmp/shots/`.

| # | Scenario | Grade | Artifact |
| --- | --- | --- | --- |
| 1 | Valid AI findings accepted reach the report | browser + test | `send` phase, `queue-visible`/`after-apply`; `stagedAiProposals.test.ts` |
| 2 | Manual Findings unchanged unless the clinician edits them | browser + test | `hand` phase then `send` (`handLineKept: true`); `aiAcceptanceBoundary.hardening.test.ts` A13 |
| 3 | Manual Impression never silently overwritten | browser + test | `send-impression-after-apply.png` (byte-identical, zero applied sentences inside it, `impression-needs-refresh` on screen) |
| 4 | AI-only Findings produce no automatic Impression | browser + test | same phase; `store.ts:3726-3732`, mutants R1/R1b/R2 killed |
| 5 | The explicit refresh press still works under ownership rules | browser | `send-impression-after-press.png` ("Impression refreshed from findings") |
| 6 | Save → Close → Reopen keeps authorship accurate | **not achieved** | B1; `aiAttributionRestoreJourney.hardening.test.ts:107-119` pins the loss; D1 is the patch |
| 7 | Conversational preamble rejected before insertion | browser + test | `shape` phase (409, `defects:["conversational","markdown"]`, refusal toast, `stayedOnViewer: true`, `shape-shape-refused.png`); 20 classifier tests, 5 route tests |
| 8 | Markdown commentary rejected or safely handled | browser + test | same rows; withheld-with-a-notice path in `shape-legacy-withheld.png` |
| 9 | Signed-report insertion refused **and** audited | browser + test | `refuse-send` (409) and audit row `1087`; today the precedence is pinned twice — the `REPORT_LOCKED` test at request level, and rig row `1765`, a chat-shaped draft sent into the signed study that was refused for the lock (`REPORT_LOCKED`) rather than for its wording |
| 10 | Wrong patient / wrong study insertion refused | test | `aiPatientIdentityFlow.request.test.ts` (`STUDY_NOT_IN_CLINIC`, `NO_STUDY_UID`, `DRAFT_NOT_FOUND`, cross-clinician overwrite) |
| 11 | Quick Select after an AI insertion keeps ledger and normal retirement correct | test only | B5; `aiAcceptanceBoundary`, `quickSelectRetirementPreview.test.ts`, `observationOwnership.phase12.test.ts` |

One honesty note about the evidence files themselves: `insert-browser-evidence.refuse.json` ends
in a `HARNESS-ERROR` — its last DB read used `string_agg(… ) … order by id` without a
`GROUP BY`, which PostgreSQL rejects. The records before it (`refuse-send`, `sign-dialog`) are
real and are what row `1087` above is taken from; the phase simply never wrote its own audit
summary. That aggregate is fixed in the harness now.

Mutation battery for the insertion door: `tmp/mutate-insert-door.cjs`, 32 mutants across the
route, the queue reader, the store hold and the shape classifier — **31 killed, 0 survivors, 1
documented equivalent** (`R3b`: the tag-preserving merge in `markField` is unreachable because
no store writer leaves a provenance key for a sentence the field no longer says — measured via
`setField` and `reconcileProvenanceAfterManualEdit`). All five files restored byte-identically.
It is in gitignored `tmp/`, not in the PR; run it from this worktree before changing the door.

---

## F. Merge recommendation

1. **Order: Z.ai's #1105 first, then `feat/ai-output-shape-guard` (`5bd2404a`).** Both orders
   merge and both produce the same tree, so this is about review load, not correctness: #1105 is
   the large Composer change and touches the one shared file, so the smaller PR should rebase
   onto the larger, not the other way round. If #1105 lands first, `git rebase origin/main` on
   `5bd2404a` should apply without manual resolution.
2. **No cherry-picks and no manual incorporation** — the overlap is one file with regions 1,400
   lines apart, and the merged tree passes both PRs' safeguard suites and the ERP typecheck.
3. **Blockers and open items.** (a) `main`'s "Tests + migration smoke (real Postgres)" check was
   still `in_progress` when I measured it; the other two jobs were success. Re-read the check
   runs on `22ee3a59` before merging anything else. (b) D1 is unimplemented, and until it is,
   B1 stands: reopening a report loses sentence authorship again. (c) Nothing has been deployed.
   `main` reaching the clinic requires someone to run `deploy-synology.sh` on the NAS, which is
   the owner's call; until then these merges are invisible at the desk. (d) `#1116` is closed
   because it merged, so the remaining work of this assignment is the PR for `5bd2404a` — I am
   not opening anything further.

One housekeeping note for whoever picks this up: the primary checkout's local `main` sits on
`e0991715`, whose content is on GitHub as the squash `55db036f` (#929). Nothing is lost; that
branch has simply not been updated since. Always re-fetch before comparing SHAs.
