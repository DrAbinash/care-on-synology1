# Radiology Content Packs — v1

Production seed assets for the CARE ERP radiology reporting knowledge system.
These are **content data**, not application code. They are imported (JSON/YAML → seeds)
by the engineering team; nothing here prescribes schema, API, or UI.

## Authority

- **Design authority:** [`CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md`](../../../../CARE_RADIOLOGY_MASTER_DESIGN_SPEC.md) (repo root).
- **Data annex / conventions:** [`RADIOLOGY_KNOWLEDGE_SEED_SPEC.md`](../../../../RADIOLOGY_KNOWLEDGE_SEED_SPEC.md).
- These packs are the machine-convertible realization of that annex for the first five studies.

## Files

| File | Contents |
|---|---|
| `_shared_libraries.yaml` | Parameter, severity, laterality, location, measurement, recommendation, critical-registry, normal-template, and alias-rule libraries. **Load first** — every study pack binds to these keys. |
| `mri_brain.yaml` | MRI Brain — 17 findings |
| `mri_ls_spine.yaml` | MRI LS Spine — 17 findings |
| `mri_c_spine.yaml` | MRI Cervical Spine — 9 findings |
| `ct_brain.yaml` | CT Brain (NCCT Head) — 15 findings |
| `usg_abdomen.yaml` | USG Whole Abdomen — 27 findings |

Remaining first-tranche studies (USG KUB, HRCT Chest, Chest X-ray, Lower Limb Doppler, Mammography)
are specified in the annex and convert next using the same pack shape.

### Neuro / spine-screening / MSK / orbit packs (v1.1)

Added on top of the first five, binding to `_shared_libraries.yaml` **and** the additive
`_shared_libraries_v1_1.yaml` extension:

| File | Study | Notes |
|---|---|---|
| `_shared_libraries_v1_1.yaml` | shared extension | new params, severities, dorsal/MSK/orbit locations, measurements, recommendations, critical registry, normal templates (additive; v1 keys untouched) |
| `_screening_whole_spine.yaml` | reusable group | whole-spine screening findings (`screen.*`) + numbering rule + screening impression rules; included by both spine-screening packs |
| `mri_ls_spine_screening.yaml` | MRI LS Spine + whole-spine screening | reuses `mrls.*` + `screen.*` by reference; adds `mrls_scr.*` |
| `mri_c_spine_screening.yaml` | MRI Cervical Spine + whole-spine screening | reuses `mrcs.*` + `screen.*`; adds `mrcs_scr.*` |
| `mri_brain.yaml` | MRI Brain | refreshed to nested `ai:` format (same `mrbr.*` keys) |
| `mri_brain_epilepsy.yaml` | MRI Brain — Epilepsy protocol | extends `mri_brain`; adds `mreps.*` |
| `mri_brain_trigeminal.yaml` | MRI Brain — Trigeminal Neuralgia protocol | extends `mri_brain`; adds `mrtn.*` |
| `mri_pituitary.yaml` | MRI Pituitary | `mrpit.*` |
| `mra_brain.yaml` | MR Angiography Brain | `mra.*` |
| `mri_posterior_fossa_cpangle.yaml` | MRI Posterior Fossa / CP Angle | `mrpf.*` |
| `mri_dorsal_spine.yaml` | MRI Dorsal Spine | `mrds.*` |
| `mri_spine_tuberculosis.yaml` | MRI Spine Tuberculosis (Koch's/Pott's) | `mrtb.*` |
| `mri_knee.yaml` / `mri_shoulder.yaml` / `mri_wrist.yaml` / `mri_ankle.yaml` | MSK joints | `mrkn.* / mrsh.* / mrwr.* / mrak.*` |
| `mri_orbits.yaml` | MRI Orbits | `mrorb.*` |

**Format note.** v1.1 packs use the nested `ai:` block requested for this tranche —
`ai: { completeness_checks, contradiction_checks, differential, follow_up }` — which adds
`differential` and `follow_up` that the flat first-five format lacked. Both forms carry the same
semantic fields; a future harmonization pass can align the first five. All 22 files validated:
parse cleanly, pass the no-prefix alias rule per study, and every `param./sev./lat./loc./meas./rec./crit./tpl.`
reference resolves against the shared libraries.

**Load order:** `_shared_libraries.yaml` → `_shared_libraries_v1_1.yaml` → `_screening_whole_spine.yaml`
→ study packs. Packs with `extends:` / `include_group:` / `included_findings_ref:` reuse keys from
the referenced packs by reference — the importer must resolve them, not redefine them.

## Finding shape

Each finding carries the fields requested for production content:

```
id_key · display_name · category · synonyms · default_sentence · impression_fragment
recommendation_code · parameters · severity · laterality · location_options · measurements
keyboard_alias · combo_tiles · criticality · normal_variant
ai_contradiction_rules · ai_completeness_rules
```

- `{slot}` names in sentences/fragments match bound `param.*` / `meas.*` / `lat.*` keys, or
  the singular derived value (`{severity}`, `{laterality}`, `{location}`, `{root}`).
- `{{tpl.normal.*}}` expands the referenced normal template.
- Empty/`null` fields take master-spec defaults (`criticality: none`, `normal_variant: false`, `[]`).

## AI rules

- **`ai_contradiction_rules`** — drive gutter marks. `severity: block` → ✕ (blocks sign-off,
  internal falsity); `severity: warn` → △ (non-blocking, dismiss-with-reason). Each has a stable
  `id`, a plain-language `rule` string (evaluated by the copilot — not formalized here per master
  spec §15.2), a `glyph`, and a `message`.
- **`ai_completeness_rules`** — drive ◌ marks (non-blocking). `normal_variant` findings never raise ◌.
- Study-level rules live under `study_ai_rules` (per-study checks + impression-suggestion hints).

## Import-time validation (required)

The importer MUST enforce, and **fail loudly** on violation:

1. **Reference integrity** — every `param./sev./lat./loc./meas./rec./crit./tpl.` reference resolves
   in `_shared_libraries.yaml`.
2. **Alias rules** — 2–4 chars, unique within study, **no alias is a prefix of another in the same
   study**, reserved-global names not shadowed. Level-slotted stems (`db pv ex cs fn lith doc cpv uv cfn`)
   expand per disc level before this check. *(This directory passes; the `hmg`→`lhem` fix in
   `usg_abdomen` was made to satisfy the no-prefix rule — see git history.)*
3. **Slot integrity** — every `{slot}` maps to a bound parameter/measurement/derived value.
4. **Scale binding** — management-bound scales (BI-RADS class, in later packs) never seed a category
   without its management line.
5. **id_key immutability** — keys are API; retire-and-add, never rename (master spec P13 / §15.4).

## Versioning

Semantic per pack (`pack.version`): MINOR = additive (new findings/values), PATCH = wording/rank.
A MAJOR bump (key removal/semantic change) is a governance event, not a routine edit.
