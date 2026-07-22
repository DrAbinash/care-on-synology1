import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgPriorComparison — P4 structured prior-comparison panel (final-integration
 * wiring). Gated by ff_radiology_usg_prior_intelligence; renders comparable
 * priors, the structured current-vs-prior deltas, and editable draft
 * suggestions. "Accept" appends the suggestion to the CURRENT draft only (via
 * onAccept) — it never mutates a prior record and never auto-inserts.
 */

interface PriorMatch {
  studyId: number | null;
  study: { studyInstanceUID: string; studyDate: string | null; studyType?: string | null };
  intervalDays: number | null;
  reasons: string[];
  hasFinalReport: boolean;
}
interface ComparisonRow {
  key: string; label: string;
  current: { value: string } | null;
  prior: { value: string } | null;
  percentChange: number | null;
  direction: string;
  intervalDays: number | null;
  note: string | null;
}
interface Suggestion { key: string; label: string; text: string; needsReview: boolean; caveat: string | null }

const DIR_COLOR: Record<string, string> = {
  increased: "text-amber-600", decreased: "text-sky-600", unchanged: "text-muted-foreground",
  new: "text-emerald-600", resolved: "text-muted-foreground", not_comparable: "text-muted-foreground",
};

export default function UsgPriorComparison({
  studyId, onAccept,
}: { studyId: number | null; onAccept: (text: string) => void }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_prior_intelligence") && !!studyId;
  const [priorId, setPriorId] = useState<number | null>(null);

  const priorsQ = useQuery<{ priors: PriorMatch[] }>({
    queryKey: ["usg-priors", studyId],
    queryFn: () => api.get(`/api/usg-prior/studies/${studyId}/priors`),
    enabled,
  });
  const cmpQ = useQuery<{ rows: ComparisonRow[]; suggestions: Suggestion[]; intervalDays: number | null }>({
    queryKey: ["usg-compare", studyId, priorId],
    queryFn: () => api.get(`/api/usg-prior/studies/${studyId}/compare/${priorId}`),
    enabled: enabled && priorId != null,
  });

  if (!enabled) return null;

  return (
    <div className="text-xs space-y-2" data-testid="usg-prior-comparison">
      <div className="font-medium text-sm">Prior comparison</div>

      {priorsQ.isLoading && <p className="text-muted-foreground">Loading priors…</p>}
      {priorsQ.isError && <p className="text-destructive">Couldn’t load priors. <button className="underline" onClick={() => priorsQ.refetch()}>Retry</button></p>}
      {priorsQ.data && priorsQ.data.priors.length === 0 && <p className="text-muted-foreground">No comparable prior studies for this patient.</p>}

      {priorsQ.data && priorsQ.data.priors.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {priorsQ.data.priors.map((p) => (
            <button
              key={p.study.studyInstanceUID}
              onClick={() => setPriorId(p.studyId)}
              className={`px-2 py-0.5 rounded border ${priorId === p.studyId ? "border-primary bg-primary/10" : "border-border"}`}
              title={p.reasons.join(", ")}
            >
              {p.study.studyDate ?? "prior"}{p.hasFinalReport ? " ✓" : ""}{p.intervalDays != null ? ` · ${p.intervalDays}d` : ""}
            </button>
          ))}
        </div>
      )}

      {priorId != null && cmpQ.isLoading && <p className="text-muted-foreground">Comparing…</p>}
      {priorId != null && cmpQ.data && (
        <div className="space-y-1.5">
          <table className="w-full">
            <thead className="text-muted-foreground">
              <tr><th className="text-left font-normal">Measure</th><th className="text-left font-normal">Prior→Current</th><th className="text-right font-normal">Δ%</th></tr>
            </thead>
            <tbody>
              {cmpQ.data.rows.filter((r) => r.direction !== "unchanged" || r.note).map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className={DIR_COLOR[r.direction] ?? ""}>{r.prior?.value ?? "—"} → {r.current?.value ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.percentChange != null ? `${r.percentChange > 0 ? "+" : ""}${r.percentChange}%` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {cmpQ.data.suggestions.length > 0 && (
            <div className="pt-1 space-y-1">
              <div className="text-muted-foreground">Draft suggestions (review before accepting):</div>
              {cmpQ.data.suggestions.map((s) => (
                <div key={s.key} className="flex items-start gap-2 p-1.5 rounded border border-border">
                  <span className="flex-1">{s.text}{s.needsReview && <span className="text-amber-600"> ⚠ review</span>}</span>
                  <button className="shrink-0 px-2 py-0.5 rounded bg-primary text-primary-foreground" onClick={() => onAccept(s.text)}>Accept</button>
                </div>
              ))}
            </div>
          )}
          {cmpQ.data.rows.length === 0 && <p className="text-muted-foreground">No numeric measurements to compare.</p>}
        </div>
      )}
    </div>
  );
}
