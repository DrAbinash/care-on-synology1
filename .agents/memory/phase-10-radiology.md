---
name: Phase 10B/10C Radiology Platform
description: Organ Intelligence + AI Research Platform routes, schema quirks, and frontend conventions.
---

## Routes (all behind requireStaffAuth)
- `/api/radiology-spine` — spine session CRUD (multi-level per session)
- `/api/radiology-brain` — brain session CRUD + history
- `/api/radiology-tumor` — tumor follow-up CRUD + timeline grouped by tumorLabel
- `/api/radiology-annotations` — image annotation metadata (not pixel edits)
- `/api/radiology-ollama` — local Ollama proxy: /findings, /test, /status

## teachingCasesTable schema quirks
- `createdById: integer NOT NULL` — cannot be null; use `userId ?? 0` as fallback.
- No `clinicalHistory`, `teachingSummary`, `orderId`, `patientId` columns.
- Use `findings` for combined clinical history + findings text.
- Use `impression` for impression text.
- The generate-from-report endpoint merges clinical history into the `findings` field.

## Ollama Settings
- Stored in `clinic_settings`: `ollama_base_url`, `ollama_model`, `ollama_local_only`.
- Drizzle schema in `lib/db/src/schema/clinicSettings.ts`.
- ALTER TABLE already run in prod DB.
- OllamaSettingsCard component lives inside Settings.tsx (before RadiologySettingsTab).

## RadiologyCopilotPanel tab gating
- "Organ" tab only shown when `spineIntelligence || brainIntelligence || tumorFollowup` feature flags are ON.
- activeTab type must include `"organ"` — always keep the union up to date when adding tabs.

**Why:** teachingCasesTable `createdById` is `NOT NULL` in the DB schema but the API may have an unauthenticated call path; always provide a safe integer fallback (0) rather than null to avoid a runtime DB error.
