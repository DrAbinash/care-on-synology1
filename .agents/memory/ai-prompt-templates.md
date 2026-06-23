---
name: AI prompt templates (radiology)
description: How DB-backed editable AI prompt presets resolve and why name is unique
---

`ai_prompt_templates` holds editable, modality-aware AI radiology prompt presets
(replaces the old hardcoded AI_PROMPT_TEMPLATES map, which is kept only as a
back-compat fallback in aiReporting.ts).

Resolution: aiReporting.ts `/query` looks up the template BY NAME (active only),
DB first, then the legacy map. Because name is the resolution key, it must be
unique — otherwise AI could pick an arbitrary row.

**Rule:** template `name` is unique case-insensitively. Enforced three ways:
unique index on `name`, functional unique index on `lower(name)`, and API-layer
409 checks on create/update. Blank/whitespace name or content is rejected (400).
Version auto-bumps only when prompt content actually changes.

**Why:** the code review flagged non-deterministic resolution (no uniqueness, no
orderBy). `/query` now also `.orderBy(id)` as defense-in-depth.
