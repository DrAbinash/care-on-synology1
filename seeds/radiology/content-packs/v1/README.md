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

Remaining v1 studies (USG KUB, HRCT Chest, Chest X-ray, Lower Limb Doppler, Mammography)
are specified in the annex and convert next using the same pack shape.

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
