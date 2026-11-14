/**
 * UpstreamDriftStrip — item 23. Names what the billing desk or the acquisition
 * machine changed on this study since the radiologist opened the report.
 *
 * Mounted in the reporting canvas chrome beside `ComposerIdentityStrip`, not
 * inside an accordion section: `ReportingScopeConfirmStrip.tsx` documents the
 * measured reason (a control placed behind a collapsed header is a control the
 * radiologist has to navigate to in order to see), and drift is the same class
 * of thing — a change to the identity of the report being written.
 *
 * Deliberately absent: any effect on the draft. This strip does not re-read the
 * clinical text, does not mark the draft dirty, and does not gate signing. The
 * header values it warns about are already live — `canonicalDemography` reads
 * the same by-id record — so what is at risk is the text typed against the
 * earlier values, and only the radiologist can judge that.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  upstreamDriftHeading,
  upstreamDriftLine,
  type UpstreamDriftField,
} from "@/lib/upstreamStudyDrift";

export function UpstreamDriftStrip({
  fields,
  onAcknowledge,
}: {
  fields: UpstreamDriftField[];
  onAcknowledge: () => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[11px] text-amber-950 shadow-sm"
      data-testid="upstream-drift-strip"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <div className="min-w-0 space-y-1.5">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-amber-800/90"
            data-testid="upstream-drift-heading"
          >
            {upstreamDriftHeading(fields)}
          </div>
          <ul className="space-y-0.5" data-testid="upstream-drift-lines">
            {fields.map((field) => (
              <li
                key={field.key}
                className="truncate"
                data-testid={`upstream-drift-line-${field.key}`}
                title={upstreamDriftLine(field)}
              >
                <span className="font-medium">{field.label}: </span>
                <span className="text-amber-900/80 line-through decoration-amber-400">
                  {field.from || "not set"}
                </span>
                <span className="px-1">→</span>
                <strong>{field.to || "cleared"}</strong>
              </li>
            ))}
          </ul>
          <div className="text-amber-900/80" data-testid="upstream-drift-note">
            Your report text has not been changed. The header, the billed test and
            the MWL row now read the values above — check that what you have typed
            still describes this examination before you sign.
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              className="h-7 bg-amber-600 text-[11px] hover:bg-amber-700 text-white"
              onClick={onAcknowledge}
              data-testid="upstream-drift-acknowledge"
            >
              I have reviewed these changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpstreamDriftStrip;
