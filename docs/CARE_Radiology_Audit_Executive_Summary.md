# CARE Radiology Reporting Workspace — Architecture Audit

## Executive Summary

**Repository:** `DrAbinash/care-on-synology1`  
**HEAD:** `d4515dae` (PR #658 branch `fix/mri-format-crosswalk-anatomy`)  
**Audit Date:** September 2026  
**Verdict:** **NEEDS TARGETED HARDENING** (Maturity Score: 7.2/10)

---

### What is Genuinely Integrated (CONNECTED)

1. **Canonical Observation Ledger** — `appliedPathologyPatches[]` is the single authoritative observation store. All 5 major producers (Quick Select, Finding Composer, Structured Format, Voice Composer, MRI Lumbar Canvas) write through `applyPathologyOverlay` / `applyMacroBundle`.

2. **AI Composer Context** — PR #656 wired canonical `ReportingStudyContext` (modality, region, regions, bodyPart, family, spineSegment, protocol, reportTitle) into the frozen snapshot. The AI receives the same study identity the workspace uses.

3. **AI Composer Observations** — PR #654's `deriveComposeObservations()` adapter feeds canonical observations to the AI, skipping stale patches and never using `baselineReplaces` as findings text.

4. **Freshness Protection** — PR #656 dual-axis: `reportRevision` (editable state) + `inputHash` (full frozen input including study context). READY → STALE_READY on either axis mismatch.

5. **Slot Identity** — `region | concept | level | laterality` with same-slot replacement guarantees at most one active observation per clinical slot.

6. **Manual Text Protection** — Provenance-based; `patch.protected` flag; `undoLastPatch` single-level undo.

7. **Save/Reopen** — `serializeObservationLedger()` → `hydrateObservationLedger()` with `reconcilePatchAgainstNarrative`.

8. **Finalize Safety** — Finalized blocks all mutations; STALE_READY blocks blind apply.

9. **Clinical Anatomy Context** — 5 regions (Brain, LS Spine, Cervical, Dorsal, WSS) with clinic-format-driven section ordering.

10. **MRI Format Crosswalk** — 320 actual clinic Word/docx files audited; 7 EXACT MATCH + 3 CLOSE + 7 ADDED tiles.

---

### What Still Runs in Parallel / Bypasses Canonical State

1. **AI Composer apply (`applyAiComposerAccepted`)** — Writes narrative + provenance ONLY. Does NOT create, update, or remove any `appliedPathologyPatch`. The ledger becomes inconsistent when AI reorganizes observations.

2. **`voiceComposerObservations[]`** — Parallel array that mirrors voice-* patches in `appliedPathologyPatches`. Kept in sync by `applyVoiceComposerPlan`, but a secondary projection.

3. **Voice `conflictGroup` divergence** — Voice observations get level-suffixed conflictGroup (`disc_contour_L4-L5`) while structured uses plain concept (`disc_contour`). Different slotKeys → same clinical finding coexists as two observations.

4. **Structured toggle-off** — Turning off a structured format toggle strips narrative text but does NOT remove or mark stale the ledger observation.

5. **Narrative-only producers** — History/technique/recommendation tiles, snippet macros, manual typing — all bypass the ledger by design (they are not clinical observations).

---

### Top 3 P0 Blockers

| # | Issue | Fix |
|---|-------|-----|
| P0-1 | AI Composer apply bypasses ledger | Add post-apply `reconcilePatchAgainstNarrative` |
| P0-2 | Voice conflictGroup divergence | Remove `_${levelKey}` suffix from `ownershipFromObservation` |
| P0-3 | Structured toggle-off leaves orphan observations | Add structured-driven `removeObservation` or mark-stale |

---

### Key File References

| Component | File |
|-----------|------|
| ReportingStudyContext | `lib/reportingStudyContext.ts` |
| Store (ledger) | `lib/zai-workspace/store.ts` (1943 lines) |
| Slot identity | `lib/observationSlot.ts` |
| AI Composer engine | `api-server/lib/reportComposer/composeEngine.ts` |
| AI adapter | `lib/reportComposer/composeObservations.ts` |
| Freshness | `api-server/lib/reportComposer/snapshot.ts` |
| Structured → Ledger | `lib/structuredFormat/structuredObservations.ts` |
| Clinical Anatomy | `lib/clinicalAnatomy/clinicalAnatomyContext.ts` |
| Workspace (main) | `pages/RadiologyReportingWorkspace.tsx` (5712 lines) |

---

### Test Coverage

- **214 test files** / **2401 tests** in diagnostic-erp/src/lib/
- **5 test files** / **68 tests** in api-server/src/lib/reportComposer/
- All passing at HEAD `d4515dae`

---

### Verdict

**NEEDS TARGETED HARDENING** — The architecture is sound. Three P0 issues (AI apply reconciliation, voice conflictGroup unification, structured toggle-off removal) must be fixed before clinic test. Once fixed, the workspace is ready for clinic test with the existing PR #654/#656/#657/#658 integration stack.
