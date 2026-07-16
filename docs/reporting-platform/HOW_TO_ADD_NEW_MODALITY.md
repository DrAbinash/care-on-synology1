# How to Add a Study or a Modality — Without Writing an Engine

The complete recipe for extending the CARE Reporting Platform with new clinical
content: a study within an existing modality (MRI/USG/CT/X-Ray) or an entirely
new modality (PET-CT, Mammography, Nuclear Medicine, Fluoroscopy, DEXA, …).

**The rule:** everything below is Knowledge Packs + data rows + tests. If a step
seems to require a new engine, workspace, Copilot, Companion, quality validator
or comparison implementation — stop, re-read
`CARE_REPORTING_PLATFORM_ARCHITECTURE_V1.md`, and use the platform instead. The
contract suite (`platform-contract.test.ts`) fails any second engine.

---

## A. Add a study to an existing modality

Worked example: adding **"CT Temporal Bone"**-style study `<Study>` to modality
`<MOD>`. Every step is an idempotent SQL seed (`ON CONFLICT DO NOTHING`) in a
`migrations/*.sql` file — auto-applied at deploy by `care-db-patch-v2`.

1. **Study tab (region)** — `radiology_study_tabs (name, sort_order)`.
   The name must appear verbatim in the study description so the resolver can
   match it; prefix with the modality for specificity (`CT Temporal Bone`,
   `X-Ray Ankle`) — the resolver picks the **most specific (longest)** match,
   so modality-prefixed names safely coexist with generic ones.
2. **Protocol** — `radiology_protocols` row keyed `study_type = <tab name>`:
   `technique_text`, `normal_text`, `recommendation_text`,
   `required_measurements` (tokens MUST be substrings of the rendered
   measurement text so the missing-measurement nudge can clear),
   `checklist_json`.
3. **Quick findings** — `radiology_quick_findings` rows with `questionsJson`
   (structured assistant `{key}` / `[optional]` templates), `suggests`
   (co-occurrence labels that exist), `conflictGroup` (mutually-exclusive
   grades).
4. **Clinical history chips** — history rows for the tab.
5. **Measurements** — `radiology_quick_measurements` rows (label + template
   text + units). Graded/qualitative values (e.g. hydronephrosis grade) are
   findings with `questionsJson`, not numeric measurements.
6. **Templates** — `structured_report_templates` rows (`modality`, bodyPart,
   sections), or mark `template` in the pack's `notApplicableSections`.
7. **Knowledge Pack** — one `knowledge_packs` row:
   `pack_id = <mod>.<slug>`, `study_type = <tab name>`, semver `version`,
   `status` (`placeholder` until content-complete, then `enabled`),
   `is_system = TRUE`, `manifest_json` using only the known keys:
   `companionRules`, `comparisonMeasurements`, `copilotModules`,
   `criticalFindings`, `notApplicableSections`, `qualityRules`,
   `recommendations`, `references`, `reportingNotes`.
8. **Quality rules** — if the study needs deterministic checks beyond the
   generic ones, add data-driven `RuleDefinition`s per the
   **Quality Rule Authoring Guide** (config over the 7 existing executors).
9. **Recommendations** — add entries to the **Clinical Recommendation
   Registry** (`clinicalRecommendations.ts`): full metadata contract, real
   measurement labels from step 5, pack ids from step 7, rule ids from step 8.
   Never hardcode advice anywhere else.
10. **Comparison** — list interval-tracked measurements in the pack's
    `comparisonMeasurements`.
11. **Test** — pack `/validate` endpoint green; registry hygiene tests pass
    (no duplicate/conflict/orphan); add fixtures if you added quality rules.
12. **Validate & deploy** — contract suite green; migrations auto-apply;
    verify on the Cockpit (readiness/health) and by opening a study of that
    description in the workspace.

That's it. The workspace, Companion, Copilot, Quality Engine, Comparison,
Voice, Palette, Print and Finalize all light up automatically because they key
off the study tab, the pack, and the registries — not off code.

## B. Add a NEW modality

Everything in section A, plus:

1. **Naming** — pick the modality token (e.g. `MG` for mammography). Content
   tables take it as plain text (`structured_report_templates.modality`,
   `knowledge_packs.modality`); there is no enum to migrate.
2. **Worklist/launch** — studies arrive with the DICOM modality; the workspace
   opens via the existing `?modality=` deep link. Add the modality to worklist
   filter options if desired (config-level UI list).
3. **Study tabs** — prefix tab names with the modality (`Mammo Bilateral`,
   `DEXA Spine`) for resolver specificity.
4. **Companion eligibility (optional)** — ONLY if the modality has a
   pre-report machine/measurement workflow, extend the one `companionEligible`
   gate in the workspace (one boolean, like CT). Do NOT create a panel.
5. **Contract suite** — add one row to `MODALITIES` in
   `platform-contract.test.ts` (modality, representative hint, region, content
   migration path, companion flag) and the modality token to the coverage
   test's list. The suite then holds the new modality to the same bar as the
   other four — this is the ONLY code change a new modality requires, and it
   is a test.
6. **Cockpit** — the pack `/stats` readiness surfaces the new modality
   automatically (proven when X-Ray needed zero cockpit changes).

## C. What you never do

- Fork `RadiologyReportingWorkspace` or add `modality === 'X'` branches.
- Create `<Mod>Copilot`, `<Mod>Companion`, `<Mod>QualityEngine`,
  `<Mod>Workspace`, `<Mod>Comparison`, a second template/protocol store, or a
  per-modality admin page.
- Hardcode a recommendation, threshold, or follow-up outside the registries.
- Bypass the Authoring Guide for quality rules.

The contract suite enforces every line of this section mechanically.
