---
name: AI model routing (Phase 4)
description: Per-task provider/model map and how AI callers resolve it
---

`ai_model_routes` (unique `task_key`) maps a logical AI task to a provider + optional
model. Resolution lives in `lib/ai-providers/src/index.ts`:
`resolveTaskRoute(taskKey)`, `getDefaultProviderName()`, `generateAiForTask()`.

**Precedence (must preserve):** explicit caller override → active task route → global
default provider. With no route and no override, behavior is identical to the old
direct `generateAiResponse` path — that is what makes routing non-breaking.

**Why it matters:** the main radiology drafting path (`/api/ai-reporting/query`)
does NOT use `generateAiForTask` because it needs its own provider validation
(BUILTIN_PROVIDER_NAMES + loadProviderConfig enabled check). Instead it folds the
`radiology_draft` route inline into providerName/model resolution. If you add a new
AI call, either use `generateAiForTask(taskKey,...)` or replicate this inline
precedence — do not hardcode a provider.

Task catalog (AI_TASK_CATALOG / AI_TASK_KEYS) is the source of truth for which
task keys exist; radiology_draft is the vision task.
