# Background AI Report Composer — Deliverable (A–X)

**Verdict: SAFE FOR ONE-CASE CLINIC TEST** after NAS pull/rebuild + migration. Do **not** auto-merge; human review first. Overnight vision AI may remain paused.

**Canonical input model (Guard 8): Model B** — the frozen composition snapshot is the authoritative AI input. Server computes revision/hashes from that snapshot and verifies optional persisted-report tokens. The worker never re-reads the live editor. Apply is **client-side only** through Zustand (`applyAiComposerAccepted` + undo snapshot).

---

## A. Existing architecture reused
- `RadiologyReportingWorkspace.tsx` host chrome
- `zai-workspace/store.ts` undo / provenance / `applyAiComposerAccepted`
- Voice Composer preview patterns + `pathologyPatch` / `reportFieldMerge` provenance
- `resolveComposerRuntime` (`ollama_composer_*`) — text only
- `dicom_retry_queue` + `radiologyJobs` with new `ai_report_compose` on **other** consumer (never overnight tick)

## B. New components
- Schema: `ai_report_compose_jobs`, worklist `ai_compose_*`, clinic composer settings
- Server: `lib/reportComposer/*`, `routes/reportComposer.ts`, handler registration
- Client: `ReportComposerAssistant`, `useReportComposer`, worklist badges/filters, Local AI settings panel

## C. Job/queue model
Statuses: QUEUED → COMPOSING → READY | STALE_READY | FAILED | CANCELLED | OBSOLETE | DISCARDED | APPLIED  
Kinds: FULL_REPORT | IMPRESSION | SECTION_EDIT | SELECTION_EDIT | TRANSLATE | REPHRASE | SHORTEN | EXPAND  
Tracked-change reviewState (separate): PENDING | ACCEPTED | REJECTED | EDITED

## D. Snapshot/revision safety
Server hashes snapshot; freshness endpoint flips READY→STALE_READY when live editor diverges. STALE blocks blind Apply.

## E. Composer input
Structured snapshot: history/technique/findings/impression/recommendation + deduped observations + template section names. No DICOM pixels.

## F. Output validation
JSON draft + grounded abnormality check; unsupported terms → FAILED. Recommendation optional.

## G–H. QS / macro / voice
Observations from voice session + client snapshot; dedupe by concept/level/text. Apply via store, not server overwrite.

## I. Worklist
Separate `ai_compose_status` badges (1A). Filters + optional Sort AI status.

## J. Reporting Workspace UI
Compose in Background, Generate Impression, Review, Apply, Discard, Regenerate, micro-command bar.

## K. Stale-draft handling
STALE banner; Compare/Regenerate; no one-click blind apply.

## L. Model/runtime
Existing composer model/fallback/ctx/temp/timeout + Background ON / Review ON / Auto OFF / Concurrency 1.

## M. PHI/security
Logs: jobId, status, model, latency, lengths, safeError. Snapshots pruned after retention days. No HTML colors in clinical text.

## N. Tests + counts
- Unit: clinical significance, snapshot hash, validation, tracked changes, materialize — **15**
- Request: enqueue 202, synthetic test, process-now no auto-apply — **3**
- **Total 18 passing** in this suite

## O. Synthetic LS Spine walkthrough (local / deterministic)
1. Findings start: “No significant disc bulge.”
2. Observations: L4-5 bulge + L5-S1 desiccation + voice facet hypertrophy
3. Enqueue FULL_REPORT → process-now → READY with tracked REPLACE (no HTML)
4. Accept → `applyAiComposerAccepted` → one Undo restores prior
5. Mid-edit before completion → freshness → STALE_READY

## P. Synthetic Brain walkthrough
Fazekas 2 + ventricles; impression inventing hemorrhage → validation `unsupported_abnormality` → FAILED. Report unchanged.

## Q. Screenshots/video
UI wired; full GUI demo pending NAS deploy with composer model. Unit/request evidence above.

## R. DB migrations
`migrations/add_ai_report_composer.sql`

## S. Deployment steps
1. Pull branch / rebuild images  
2. `care-db-patch-v2` applies migration  
3. Restart `care-api` then `care-web`  
4. Settings → Local AI: set Report Composer model; Background ON; Review ON; Auto OFF

## T. Services to restart
`care-db-patch-v2` (once) → `care-api` → `care-web`

## U. Initial settings
Background ON, Review before apply ON, Auto compose OFF, Concurrency 1

## V. Live-only unknowns
GPU latency under load; Hindi translation quality; radiologist UX acceptance

## W. Rollback
Disable Background composer; cancel QUEUED jobs; ignore new columns

## X. Clinic gate
Run one MRI LS Spine case per Guard 14 acceptance checklist before enabling Auto Compose.
