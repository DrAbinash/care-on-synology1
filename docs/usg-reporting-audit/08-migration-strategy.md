# 08 — Migration Strategy

*Synthesis document, written by the audit author as Lead Architect. As-of commit: `15ed9dfc`.*

## The choice, as posed

- **Option A**: Leave MRI unchanged. Build USG beside it.
- **Option B**: Extract `reporting-core/`. Move MRI onto it. Then build USG.

## Recommendation: Option A, with one important qualifier

**Build USG beside MRI, using the shared mechanisms that already exist (doc 07), without a big-bang extraction or file-move of MRI's code.** The qualifier: this is not "leave everything exactly as-is" — it requires *finishing* the parts of the shared core that are currently incomplete (structured-report wiring, template-system consolidation, measurement-formula fixes) as a **prerequisite**, not a follow-up, because building USG content on top of the broken/duplicated parts of the current system would just add a third or fourth copy of the same problem.

### Why not Option B

1. **The premise of Option B — that MRI needs to be moved onto a core before USG can be built — is false for this codebase.** Doc 04 shows the workspace/workflow/template/findings/draft/finalize/print/audit/settings/worklist/DICOM layers are already 85-95% modality-agnostic *in place*. There is no meaningful architectural barrier stopping USG from using them today; the barrier is missing *content* (templates, findings, measurement formulas — doc 05, doc 06), not missing *plumbing*.
2. **Cost**: extracting and moving a 5,250-line actively-developed file plus its ~30 supporting components/lib files, with full re-verification that nothing broke, is a multi-week effort with high regression risk, for a change that (per point 1) doesn't unlock any new capability — everything USG needs is already reachable from where the code currently lives.
3. **Concurrency risk**: doc 09/doc 11 material shows this exact file received 15+ commits in the last two weeks from an actively-working second developer/agent. A large structural move started now would very likely conflict with in-flight work on every single file it touches, turning a architecture cleanup into a multi-day merge-conflict resolution exercise with no functional payoff.
4. **Governance**: the BEND-1 freeze document (doc 02) explicitly requires a formal decision before any "second/competing report lifecycle" or backend restructuring — Option B's backend implications (if it touched routes/schema, not just frontend files) would trigger that gate for a change that doesn't need to happen.

### Why Option A is safe, not just cheap

Option A isn't "do nothing and hope" — it's "use what's already proven to work." R2.0 (doc 02) already executed exactly this strategy for USG Whole Abdomen and USG KUB: it folded USG mode into the existing workspace, reused the existing template/findings/draft/finalize/settings/worklist/DICOM mechanisms unchanged, and added only USG-specific content and the one genuinely-USG-specific panel (`UsgMeasurementReviewPanel`). The two USG studies that exist today are living proof this approach works in this exact codebase, not a theoretical claim.

---

## Risk estimate

| Risk area | Option A (beside) | Option B (extract-then-migrate) |
|---|---|---|
| Regression risk to MRI reporting | Low — MRI code paths untouched except where genuinely shared (e.g. a template-system consolidation, done carefully, touches both) | High — every MRI code path physically moves and must be re-verified |
| Merge-conflict risk with concurrent radiology work | Moderate — new USG content/panels mostly land in new files, but shared-mechanism completion work (structured-report wiring, template consolidation) will touch files the other branch is also editing | Very high — a full-file move conflicts with every concurrent edit to those files |
| Risk of building on broken foundations | Real, but bounded and known (doc 06's measurement-formula bugs, doc 05's template-system duplication) — addressed as explicit prerequisite work, not silently inherited | Same underlying bugs still need fixing either way — Option B doesn't reduce this risk, it just delays addressing it behind a restructuring |
| Regulatory/compliance risk (PCPNDT) | Requires an explicit decision either way (doc 04, doc 07) — same in both options | Same |
| Effort to first working USG study type beyond the existing two | Weeks, not months (see doc 09) | Months, before any new USG content can even start, since the extraction has to complete and be re-verified first |

## Long-term maintenance impact

**Option A** keeps the codebase's actual current pattern — generic mechanisms + per-modality content rows/files, documented as a logical core (doc 07) — which is already what `CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md` prescribes and what the last month of radiology commits (Smart Findings, Structured Finding Assistant, Command Palette, CARE Copilot — all built as generic, data-driven mechanisms) already follows in practice. Continuing this pattern for USG doesn't add a second convention to maintain.

**Option B** would introduce a directory-boundary convention that the *rest* of the already-in-flight radiology work isn't using, creating exactly the kind of "two competing architectures" problem `docs/CARE_RADIOLOGY_BACKEND_V1_FREEZE.md` was written to prevent. A future, deliberate Phase-2 service split (see doc 07's closing note) is the appropriate time to formalize `modalities/` directories — not now, and not as a prerequisite for USG content work.

## Bottom line

**Option A.** Effort: moderate (content-heavy, not plumbing-heavy — see doc 09 for phasing). Risk: low-to-moderate, concentrated in the prerequisite fix-up work (doc 06's formula bugs, doc 05's template consolidation) rather than in new-feature development. Long-term maintenance: continues the pattern already governing this codebase, rather than introducing a second one.
