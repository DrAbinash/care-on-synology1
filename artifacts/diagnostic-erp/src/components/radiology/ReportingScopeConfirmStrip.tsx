/**
 * ReportingScopeConfirmStrip — the ask CARE has to earn before it reports an
 * examination the billing label does not name.
 *
 * Owner decision 2026-11-01, filed from a real patient: an MRI booked as `MRI Brain`
 * was acquired as `MRI BRAIN + CX SCR`, and the signed report described the brain
 * alone. He asked for the disagreement to be raised with him, not resolved silently in
 * either direction, and for the billed identity to survive until he answers.
 *
 * It is mounted in the reporting canvas chrome, NOT inside the Study / Region accordion
 * section. Measured on the rig at 1536x800: with the strip rendered by
 * `StudyRegionReportFormatSection`, opening the study left `study-setup-strip` absent
 * from the DOM entirely — that section is an accordion body, and only one body is on
 * screen at a time — so the question was asked in a place the radiologist had to
 * navigate to in order to see. A confirmation nobody sees is not a confirmation; it is
 * the print-preview failure (a clinical control behind a collapsed header) in a safety
 * control.
 *
 * Deliberately absent: any claim about images. CARE reads study-level examination names
 * from the bill and the worklist, never a DICOM series description, so an ambiguous
 * series label cannot raise this strip or add a region to a report.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StudyScopeProposal } from "@/lib/studyRegion";

export function ReportingScopeConfirmStrip({
  proposal,
  testName,
  disabled,
  onConfirm,
  onDismiss,
}: {
  proposal: StudyScopeProposal;
  testName: string | null;
  disabled?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-sky-400 bg-sky-50 px-3 py-2 text-[11px] text-sky-950 shadow-sm"
      data-testid="reporting-scope-strip"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" />
        <div className="min-w-0 space-y-1.5">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-sky-800/90"
            data-testid="reporting-scope-heading"
          >
            Confirm the report scope
          </div>
          <div className="font-medium" data-testid="reporting-scope-detail">
            The examination recorded with the study covers{" "}
            <strong>{proposal.performedRegions.join(" + ")}</strong>
            {testName ? (
              <>
                ; the billed test <strong>{testName}</strong> names{" "}
                <strong>{proposal.billedRegions.join(" + ")}</strong>.
              </>
            ) : (
              <>
                ; the billed test names{" "}
                <strong>{proposal.billedRegions.join(" + ")}</strong>.
              </>
            )}{" "}
            Reporting <strong>{proposal.proposedRegions.join(" + ")}</strong> as one
            combined examination adds {proposal.addedRegions.length}{" "}
            section{proposal.addedRegions.length === 1 ? "" : "s"} and keeps one report
            number, one signature and your existing text. Nothing changes until you choose.
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={disabled}
              onClick={onDismiss}
              data-testid="reporting-scope-dismiss"
            >
              Keep {proposal.billedRegions.join(" + ")} only
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 bg-sky-600 text-[11px] hover:bg-sky-700 text-white"
              disabled={disabled}
              onClick={onConfirm}
              data-testid="reporting-scope-confirm"
            >
              Report {proposal.proposedRegions.join(" + ")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
