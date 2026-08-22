/**
 * FinalizeDialog — DISABLED.
 *
 * This component was a Z.ai workspace prototype finalize flow that bypasses the
 * canonical finalizeReport pipeline (validation, quality gates, critical-finding
 * checks, proper sign dialog, archive). The workspace's own finalizeReport +
 * useFinalizeFlow + FinalizeSignDialog is the correct path.
 *
 * Keeping this file as a stub so imports don't break, but rendering nothing.
 */
export function FinalizeDialog() {
  // No-op — the workspace's finalizeReport callback (passed to
  // ReportExportPanel via onFinalize) handles everything.
  return null;
}

