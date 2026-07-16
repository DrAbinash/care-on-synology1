# CARE Reporting Platform — Coverage Report

Per-modality coverage of the shared platform. **Platform coverage** (does the
capability exist and run for the modality) is uniformly **100%** — every
modality is a client of the same engines, proven by `platform-contract.test.ts`.
**Content coverage** (how much clinical content is authored) varies by modality
and is the only axis that differs — because content is the only thing a modality
adds.

Knowledge-Pack registry snapshot (parsed from the seed migrations):

| Modality | Packs (total) | Enabled | Content migrations |
|---|---|---|---|
| MRI | 8 | 5 | `0005_mri_protocol_specs.sql` + base seeds |
| USG | 13 | 13 | `zzz_add_usg_gold_standard_content.sql` |
| CT | 28 | 21 | `zzzz_ct_gold_standard_content.sql`, `zzzz_ct_impression_rules_knowledge.sql` |
| X-Ray | 40 | 19 | `zzzz_xr_gold_standard_content.sql` |
| **Total** | **89** | **58** | |

## Coverage matrix

Legend: **✅ full** · **◑ partial (content breadth)** · **N/A** (clinically not applicable).
Every cell is served by the *same* shared engine — differences are content, not capability.

| Capability | MRI | USG | CT | X-Ray |
|---|---|---|---|---|
| Platform (workspace + all engines run) | ✅ | ✅ | ✅ | ✅ |
| Knowledge Pack | ✅ | ✅ | ✅ | ◑ (21 placeholders across CT/XR) |
| Template | ✅ | ✅ | ◑¹ | ◑¹ |
| Protocol | ✅ | ✅ | ✅ | ✅ |
| Clinical History | ✅ | ✅ | ✅ | ◑ |
| Quick / Structured Findings | ✅ | ✅ | ◑² | ◑² |
| Measurements | ✅ | ✅ | ✅ | ✅ (descriptive; many N/A) |
| Quality Engine | ✅ | ✅ | ✅ | ✅ |
| Previous Comparison | ✅ | ✅ | ✅ | ✅ |
| Companion | N/A³ | ✅ | ✅ | N/A³ |
| Copilot | ✅ | ✅ | ✅ | ✅ |
| Print / Premium Layout | ✅ | ✅ | ✅ | ✅ |
| Admin (packs / quick-select / protocol / quality dashboard / cockpit) | ✅ | ✅ | ✅ | ✅ |

¹ **Template**: CT/XR reporting is largely protocol-`normalText` + free text;
structured `structured_report_templates` rows are not yet seeded for CT/XR, so
the pack's `template` section is either seeded later or marked
`notApplicableSections` — a content/config decision, not a platform gap.
² **Findings breadth**: CT has quick findings on 6 of 26 study tabs; XR similarly
partial — additive `radiology_quick_findings` seeds, no code.
³ **Companion** applies to ultrasound and CT (the modalities with a pre-report
machine/measurement workflow); MRI/XR are correctly excluded by the shared
`companionEligible` gate — not a missing feature.

## Per-modality summary

- **MRI** — the reference modality. Full platform + mature content. Companion N/A.
- **USG** — full platform + the deepest content library (32-study gold standard,
  13/13 packs enabled) + the Companion's richest surface.
- **CT** — full platform reuse (merged in #104); 21/28 packs enabled; content
  polish backlog in `docs/ct-reporting/CT_REPORTING_WORKSPACE.md §11`.
- **X-Ray** — full platform reuse; 40 packs (19 enabled, 21 placeholder), the
  broadest study catalogue; descriptive-modality measurements largely N/A by
  design (`notApplicableSections`).

## How this is verified

- **Structural coverage** (capability exists + is modality-agnostic + single
  implementation) — asserted by `platform-contract.test.ts` (validated offline
  against the live source, migrations and 89 pack manifests).
- **Runtime coverage** (assemble endpoints return content, dashboards compute
  readiness/health) — verified against a live deployment via
  `/api/radiology/knowledge-packs` (assemble/validate/stats). This environment
  has no DB, so the numbers above are parsed from the seed migrations; the live
  Engineering Cockpit surfaces the same figures from the assembled packs.
