import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * @deprecated M1.1 consolidation — thin redirect wrapper.
 *
 * This was the "older simple editor" that the July 2026 cockpit unification
 * parked at /radiology/report-legacy/:studyId "for one release in case of
 * muscle-memory bookmarks" (see the routing comment in App.tsx). That grace
 * release has shipped; a repo-wide sweep found ZERO navigation references to
 * this route, and every capability it had (worklist-entry load, AI draft
 * seed, templates, critical flag, Weasis launch, finalize to patient_reports
 * + REPORT_FINAL/READY_TO_SEND) exists in the canonical Reporting Workspace,
 * which reads the same /api/internal/radiology/worklist/:id entry — so the
 * route now forwards there with the same studyId. The route itself is
 * preserved; only the duplicate editor body (541 lines, no draft save, its
 * own inline viewer-launch copy) is gone.
 */
export default function RadiologyReportEditor({ studyId }: { studyId?: number }) {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate(
      studyId ? `/radiology/report/${studyId}` : "/radiology/reporting-workspace",
      { replace: true },
    );
  }, [studyId, navigate]);

  return (
    <div className="p-6 text-sm text-muted-foreground">
      This editor has been replaced by the canonical Reporting Workspace — redirecting…
    </div>
  );
}
