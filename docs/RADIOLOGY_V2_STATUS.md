# Radiology V2 — Status (one page)

Branch: `radiology-v2-phase-a-b` · Updated: July 3, 2026

| Phase | What | Status |
|---|---|---|
| A | Repo cleanup, docs archived, typecheck fixed | ✅ Done |
| B | Network hosts centralized (env + admin settings, no hardcoding) | ✅ Done |
| C | ONE Worklist (`/radiology/worklist`) — UHID/Bill/Priority, 7 statuses, role actions | ✅ Done |
| D | ONE Reading Room (RadiologistCockpit) — Print + Premium added, editors redirected | ✅ Done |
| E | ONE Radiology Settings (`/radiology/settings`, owner-only tabbed hub) | ✅ Done |
| F | Template-system consolidation (data script, manual review first) | ⏳ Awaiting owner approval |
| G | Delete hidden legacy pages after 30 clean days | ⏳ Awaiting owner approval |

Key facts: zero DB migrations so far (existing columns reused) · billing/ICICI/
payments/permissions untouched · Premium Report module preserved (entry via
"Premium Preview") · SuperAdmin pen drive separate, never committed ·
295/295 tests, 0 typecheck errors.

Deploy: `git pull && docker compose build && docker compose up -d`
Rollback any phase: `git revert <commit>` (see `git log --oneline`).
