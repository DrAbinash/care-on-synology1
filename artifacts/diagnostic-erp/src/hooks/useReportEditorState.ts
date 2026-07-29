/**
 * useReportEditorState — thin orchestrator helpers extracted from
 * RadiologyReportingWorkspace (analysis item 2). Full editor state remains
 * in the workspace page; these helpers keep dirty/snapshot logic testable
 * and importable without the 6.8k-line page.
 */
export {
  serializeReportSnapshot,
  isReportDirty,
  shouldOfferBackupRestore,
  restorableSelections,
  type FinalReportMeta,
} from "@/lib/workspaceReportState";
