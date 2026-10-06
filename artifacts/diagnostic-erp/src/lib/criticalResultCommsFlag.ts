/**
 * criticalResultCommsFlag.ts — the single read point for
 * `ff_radiology_critical_result_comms`.
 *
 * WHY ONE MODULE
 *   The critical-result COMMUNICATION workflow is spread across the pre-sign
 *   acknowledgement block, the finalize safety advisory, the SLA clock, the
 *   interrupt card, the SLA timer, the copilot advisory module, the Mark
 *   Critical Finding panel, the Critical Findings page and its three navigation
 *   surfaces. If each of those inlined its own
 *   `isFeatureEnabled("ff_radiology_…")` call, a future rename or a missed gate
 *   would be invisible. Every imperative gate imports `criticalCommsEnabled()`
 *   from here instead, and `criticalResultCommsFlag.contract.test.ts` enumerates
 *   the call sites so one cannot be added or removed silently.
 *
 *   The three NAVIGATION surfaces (Layout.tsx's sidebar leaf, the Ctrl+K entry
 *   in globalCommandCatalog.ts and the Radiology hub card) are the exception:
 *   they use the repo's existing declarative `featureFlag: "ff_…"` catalog
 *   field, exactly as every other gated nav item does, so the key appears there
 *   as data rather than as a call. The contract test pins those three literals
 *   too.
 *
 * WHAT THE FLAG COVERS (all of it, or none of it)
 *   A partially gated workflow is worse than an ungated one: the pre-sign block
 *   demands a "communicated" tick from a checklist that no longer renders, so
 *   signing becomes impossible. Every surface below therefore reads the same
 *   flag and disappears together.
 *
 * WHAT THE FLAG DELIBERATELY DOES NOT COVER
 *   The DETECTOR stays live either way — `detectCriticalFindings`
 *   (criticalResults.ts), the workspace lint rule `CRITICAL_FINDING`, and the
 *   purely informational "Critical finding detected" item that
 *   `runCopilotAnalysis` puts in the copilot rail. So does the
 *   `radiology_critical_findings` table and every row already in it, the PACS
 *   dashboard critical-alerts widget (`/api/radiology/critical-findings`), the
 *   separate Critical Alerts Manager (`/api/radiology-workflow/critical-alerts`)
 *   and RIS critical escalation. Turning this flag off hides a communication
 *   protocol this centre does not currently follow; it never blinds the
 *   detector and never deletes data.
 *
 * FAIL-CLOSED
 *   `isFeatureEnabled` is synchronous and reads the flags hydrated from
 *   GET /api/feature-flags by hooks/useServerFeatureFlags. Before that resolves
 *   it falls back to FEATURE_FLAG_DEFAULTS, where this key is `false` — so a
 *   cold start can never briefly show the workflow.
 */
import { isFeatureEnabled } from "@/lib/staffSession";

/** The flag key. Declared once; referenced by the migration, the server-side
 *  registry and every frontend gate. */
export const CRITICAL_COMMS_FLAG = "ff_radiology_critical_result_comms";

/** True only when the critical-result communication workflow is switched on. */
export function criticalCommsEnabled(): boolean {
  return isFeatureEnabled(CRITICAL_COMMS_FLAG);
}
