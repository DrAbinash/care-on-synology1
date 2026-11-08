import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { diffSentences, diffSummary, type DiffLine } from "@/lib/sentenceDiff";
import { parseStoredReportBody } from "@/lib/storedReportBody";
import { Clock, Copy, GitCompare, FileText } from "lucide-react";

/**
 * FollowUpPanel — Phase 3 follow-up mode + prior-study timeline.
 *
 * Timeline: the patient's previous radiology reports, newest first,
 * lazily fetched (only when this tab is opened) and paginated server-side
 * (limit 10). Clicking an entry expands its full text inline.
 *
 * Follow-up diff: compares the selected prior report against the CURRENT
 * draft, sentence by sentence — green = new in this draft, red struck-
 * through = present before but missing now, plain = unchanged.
 *
 * A prior report's `body` is signed report HTML, not narrative text, so it is
 * run through parseStoredReportBody() before it is displayed, diffed or copied.
 * "Copy findings" REPLACES the current Findings field with the prior study's
 * Findings section (it does not merge) and the replacement is attributed to the
 * radiologist as a manual edit, exactly as typing it would be.
 */

type PriorReport = {
  id: number;
  title: string;
  body: string;
  impression: string | null;
  createdAt: string;
  createdBy: string | null;
  parameters: string | null;
};

interface Props {
  patientId: number | null;
  currentFindings: string;
  /** The live Impression text — read only to decide whether "Copy impression"
   *  needs a confirm before it replaces a non-empty field. */
  currentImpression?: string;
  onCopyFindings: (text: string) => void;
  onCopyImpression: (lines: string[]) => void;
  disabled?: boolean;
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="text-[11px] leading-relaxed space-y-0.5">
      {lines.map((l, i) => (
        <p
          key={i}
          className={
            l.kind === "added"
              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded px-1"
              : l.kind === "removed"
                ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 line-through rounded px-1"
                : "text-muted-foreground px-1"
          }
        >
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : ""}{l.text}
        </p>
      ))}
    </div>
  );
}

export default function FollowUpPanel({ patientId, currentFindings, currentImpression = "", onCopyFindings, onCopyImpression, disabled }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  // "Copy findings/impression" is a wholesale field replacement behind one
  // click. The sticky Undo saves a mis-click, but nothing on the button said
  // so — so the click now asks first whenever it is about to replace text the
  // radiologist has on the page, and goes straight through on an empty field.
  const [confirming, setConfirming] = useState<"findings" | "impression" | null>(null);
  const guardedCopyFindings = (text: string) => {
    if (currentFindings.trim()) { setConfirming("findings"); return; }
    onCopyFindings(text);
  };
  const guardedCopyImpression = (lines: string[]) => {
    if (currentImpression.trim()) { setConfirming("impression"); return; }
    onCopyImpression(lines);
  };

  const { data, isLoading } = useQuery<{ items: PriorReport[]; total: number }>({
    queryKey: ["prior-radiology-reports", patientId],
    queryFn: () => api.get(`/api/patient-reports/patient/${patientId}?type=radiology&limit=10`),
    enabled: !!patientId, // lazy: only fetches when the tab mounts with a patient
    staleTime: 60_000,
  });

  const priors = data?.items ?? [];
  const compareReport = priors.find((p) => p.id === compareId) ?? null;

  const compared = useMemo(
    () => (compareReport
      ? parseStoredReportBody(compareReport.body, { title: compareReport.title })
      : null),
    [compareReport],
  );
  const priorFindings = useMemo(
    () => (compared?.findings || compared?.fullText || "").trim(),
    [compared],
  );

  const diff = useMemo(
    () => (compareReport ? diffSentences(priorFindings, currentFindings || "") : []),
    [compareReport, priorFindings, currentFindings],
  );
  const summary = useMemo(() => diffSummary(diff), [diff]);

  if (!patientId) {
    return <p className="text-xs text-muted-foreground p-3">No linked patient — prior reports unavailable for this study.</p>;
  }
  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-3">Loading prior reports…</p>;
  }
  if (priors.length === 0) {
    return <p className="text-xs text-muted-foreground p-3">No previous radiology reports for this patient.</p>;
  }

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-y-auto">
      {/* Comparison view */}
      {compareReport && (
        <div className="rounded-lg border bg-muted/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold flex items-center gap-1">
              <GitCompare size={10} /> vs {compareReport.title}
              <span className="text-muted-foreground font-normal">
                ({new Date(compareReport.createdAt).toLocaleDateString()})
              </span>
            </p>
            <button onClick={() => setCompareId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">close</button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            <span className="text-emerald-600">+{summary.added} new</span>
            {" · "}
            <span className="text-red-600">−{summary.removed} no longer present</span>
            {" · "}
            {summary.unchanged} unchanged
          </p>
          <DiffView lines={diff} />
          {confirming ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-1.5 space-y-1" data-testid="prior-copy-confirm">
              <p className="text-[10px] text-amber-900">
                Replace the current {confirming === "findings" ? "Findings" : "Impression"} with the prior study&apos;s text? Your present text is overwritten (Undo can bring it back).
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" className="h-6 text-[10px] bg-amber-600 hover:bg-amber-700"
                  disabled={disabled}
                  onClick={() => {
                    if (confirming === "findings") onCopyFindings(priorFindings);
                    else onCopyImpression((compareReport.impression || "").split("\n").filter(Boolean));
                    setConfirming(null);
                  }}>
                  Replace
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={disabled}
              onClick={() => guardedCopyFindings(priorFindings)}
              title={currentFindings.trim() ? "Replaces the current Findings field (asks first)" : undefined}>
              <Copy size={10} /> Copy findings
            </Button>
            {compareReport.impression && (
              <Button size="sm" variant="outline" className="h-6 text-[10px]" disabled={disabled}
                onClick={() => guardedCopyImpression((compareReport.impression || "").split("\n").filter(Boolean))}
                title={currentImpression.trim() ? "Replaces the current Impression (asks first)" : undefined}>
                <Copy size={10} /> Copy impression
              </Button>
            )}
          </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <p className="text-[9px] font-semibold uppercase text-muted-foreground flex items-center gap-1">
        <Clock size={9} /> Prior studies ({data?.total ?? priors.length})
      </p>
      <div className="flex flex-col">
        {priors.map((p, i) => {
          // Only the expanded row is parsed; the other nine stay untouched.
          const parsed = expandedId === p.id ? parseStoredReportBody(p.body, { title: p.title }) : null;
          return (
          <div key={p.id} className="relative pl-4 pb-2">
            {/* timeline spine */}
            <span className="absolute left-1 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
            {i < priors.length - 1 && <span className="absolute left-[6.5px] top-3.5 bottom-0 w-px bg-border" />}
            <button
              className="text-left w-full"
              onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
            >
              <p className="text-[11px] font-medium leading-tight hover:text-primary">{p.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(p.createdAt).toLocaleDateString()} {p.createdBy ? `· ${p.createdBy}` : ""}
              </p>
            </button>
            <div className="flex gap-1 mt-0.5">
              <button
                onClick={() => setCompareId(compareId === p.id ? null : p.id)}
                className={`text-[9px] underline ${compareId === p.id ? "text-primary font-semibold" : "text-muted-foreground hover:text-primary"}`}
              >
                compare
              </button>
              <button
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="text-[9px] text-muted-foreground hover:text-primary underline"
              >
                {expandedId === p.id ? "hide" : "view"}
              </button>
            </div>
            {parsed && (
              <div className="mt-1 rounded border bg-background p-2 text-[10px] whitespace-pre-wrap max-h-48 overflow-y-auto">
                <p className="flex items-center gap-1 font-semibold mb-1"><FileText size={9} /> Report text</p>
                {parsed.fullText.trim() || "(empty)"}
                {/* The body already carries an Impression section for every
                    writer; the column is only a fallback for rows that do not. */}
                {!parsed.impression.trim() && p.impression && (
                  <>
                    <p className="font-semibold mt-1.5 mb-0.5">Impression</p>
                    {p.impression}
                  </>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
