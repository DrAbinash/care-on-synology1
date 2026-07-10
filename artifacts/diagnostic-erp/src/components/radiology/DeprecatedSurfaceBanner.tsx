import { Link } from "wouter";

/**
 * Ticket M1.1 — consolidation signpost for legacy radiology reporting
 * surfaces. The canonical reporting workspace is RadiologyReportingWorkspace
 * (/radiology/report/:studyId, alias /radiology/reporting-workspace). Legacy
 * pages stay routed and fully functional (nothing regresses), but every one
 * of them announces its status and points at the canonical page so new
 * habits form in one place. Deliberately one slim line — not a redesign.
 */
export default function DeprecatedSurfaceBanner({
  surface,
  canonicalRoute = "/radiology/reporting-workspace",
  canonicalLabel = "Reporting Workspace",
  note,
}: {
  surface: string;
  canonicalRoute?: string;
  canonicalLabel?: string;
  note?: string;
}) {
  return (
    <div className="w-full bg-amber-100 text-amber-900 border-b border-amber-300 px-3 py-1 text-xs font-medium flex items-center gap-2 print:hidden">
      <span className="font-bold uppercase tracking-wide">Legacy</span>
      <span>
        {surface} is deprecated — the canonical reporting page is{" "}
        <Link href={canonicalRoute} className="underline font-semibold">
          {canonicalLabel}
        </Link>
        {note ? <> · {note}</> : null}
      </span>
    </div>
  );
}
