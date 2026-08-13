import { useEffect, useRef, useMemo } from "react";
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { runLintRules, type LintIssue } from "@/lib/zai-workspace/types";
import {
  formatProvenanceHover,
  provenanceMapToSegments,
  provenanceVisualKind,
  sourceLabel,
  type InsertSource,
  type ProvenanceVisualKind,
} from "@/lib/reportFieldMerge";
import { QuickSelectStrip } from "./quick-select-strip";
import { cn } from "@/lib/utils";

interface Props {
  field: "findings" | "impression" | "recommendation" | "technique" | "clinicalHistory";
  label: string;
  placeholder?: string;
  minHeight?: string;
  showGhost?: boolean;
}

const G: Record<string, string> = { error: "✕", warning: "△", info: "◌" };
const C: Record<string, string> = { error: "text-rose-500", warning: "text-amber-500", info: "text-sky-500" };

const VISUAL_STYLES: Record<ProvenanceVisualKind, string> = {
  manual: "border-l-transparent bg-transparent text-muted-foreground",
  "quick-select": "border-l-sky-500 bg-sky-500/10 text-foreground",
  "quick-findings": "border-l-emerald-500 bg-emerald-500/10 text-foreground",
  merged: "border-l-amber-500 bg-amber-500/10 text-foreground",
  other: "border-l-slate-400 bg-slate-500/10 text-foreground",
};

/** Stable fallback — never use `?? {}` inside a zustand selector (new ref each read → React #185). */
const EMPTY_FIELD_PROVENANCE: Record<string, never> = {};

const LEGEND: Array<{ kind: ProvenanceVisualKind; label: string; box: string }> = [
  { kind: "quick-select", label: "Quick Select", box: "bg-sky-500/25 border-sky-500" },
  { kind: "quick-findings", label: "Quick Findings", box: "bg-emerald-500/25 border-emerald-500" },
  { kind: "merged", label: "Merged", box: "bg-amber-500/25 border-amber-500" },
  { kind: "other", label: "Other assisted", box: "bg-slate-500/25 border-slate-400" },
  { kind: "manual", label: "Manual", box: "bg-transparent border-border" },
];

function uniqueAssistedSources(segments: Array<{ sources: InsertSource[] }>): Set<ProvenanceVisualKind> {
  const kinds = new Set<ProvenanceVisualKind>();
  for (const seg of segments) {
    const kind = provenanceVisualKind(seg.sources);
    if (kind !== "manual") kinds.add(kind);
  }
  return kinds;
}

export function FindingsEditor({ field, label, placeholder, minHeight = "200px", showGhost = false }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = useWorkspaceSelector(s => s[`${field}Text` as "findingsText"] as string);
  const setField = useWorkspaceSelector(s => s.setField);
  const provenance = useWorkspaceSelector(s => s.fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE);
  const gt = useWorkspaceSelector(s => showGhost ? s.ghostText : null);
  const gTarget = useWorkspaceSelector(s => showGhost ? s.ghostTextTarget : null);
  const accept = useWorkspaceSelector(s => s.acceptGhostText);
  const setGhost = useWorkspaceSelector(s => s.setGhostText);
  const sid = useWorkspaceSelector(s => s.activeStudyId);
  const studies = useWorkspaceSelector(s => s.studies);
  const issues: LintIssue[] = useMemo(() => {
    if (!value) return [];
    const st = studies.find(s => s.id === sid);
    return runLintRules(value, { modality: st?.modality ?? "XR", sex: st?.patient?.sex });
  }, [value, sid, studies]);

  const segments = useMemo(
    () => provenanceMapToSegments(typeof value === "string" ? value : "", provenance),
    [value, provenance],
  );
  const assistedKinds = useMemo(() => uniqueAssistedSources(segments), [segments]);
  const showProvenanceUi = assistedKinds.size > 0;

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.max(parseInt(minHeight), ref.current.scrollHeight) + "px";
    }
  }, [value, minHeight]);
  useEffect(() => {
    if (gTarget === field && gt && ref.current) {
      ref.current.focus();
      const e = ref.current.value.length;
      ref.current.setSelectionRange(e, e);
    }
  }, [gTarget, gt, field]);

  const hk = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && gt && gTarget === field) { e.preventDefault(); accept(); return; }
    if (e.key === "Escape" && gt) { e.preventDefault(); setGhost(null, null); return; }
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); sg(); return; }
  };
  const sg = () => {
    let s: string | null = null;
    if (field === "impression") s = /mass|lesion|tumor/.test(value) ? "Findings are concerning for malignancy. Recommend tissue diagnosis." : /normal|unremarkable/.test(value) ? "No acute abnormality. Clinical correlation advised." : "Clinical correlation and follow-up.";
    else if (field === "findings") s = /measur/.test(value) ? "measuring approximately ___ × ___ × ___ cm." : /normal$/.test(value) ? "in size and configuration. No acute abnormality." : /mass|lesion|tumor/.test(value) ? "with irregular margins and heterogeneous enhancement." : "No evidence of acute infarct, hemorrhage, or mass lesion.";
    else if (field === "recommendation") s = "Clinical correlation advised. Follow-up as clinically indicated.";
    setGhost(s, s ? field : null);
  };
  const lines = (typeof value === "string" ? value : "").split("\n");

  return (
    <div className="relative w-full" data-report-field={field} data-testid={`findings-editor-${field}`}>
      <QuickSelectStrip field={field} />
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {issues.length > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{issues.length} lint</span>}
          <button onClick={sg} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition" title="AI ghost (Ctrl+Enter)"><span className="font-mono text-[10px]">⌃↵</span> AI</button>
        </div>
      </div>

      {showProvenanceUi && (
        <div
          className="mb-1.5 flex flex-wrap items-center gap-2"
          data-testid={`provenance-legend-${field}`}
          data-editor-only="provenance"
        >
          <span className="text-[10px] font-bold uppercase tracking-wide text-foreground">Sources</span>
          {LEGEND.filter((item) => item.kind === "manual" || assistedKinds.has(item.kind)).map((item) => (
            <span
              key={item.kind}
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-bold",
                item.box,
              )}
              title={item.label}
            >
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm border", item.box)} aria-hidden />
              {item.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative flex">
        <div className="flex-none w-8 select-none border-r border-border bg-muted/30 text-right text-[10px] leading-[1.6] font-mono pt-2.5 text-muted-foreground/70" aria-hidden>
          {lines.map((_, i) => {
            const ln = i + 1;
            const li = issues.find(x => x.line === ln);
            return (
              <div key={i} className="h-[1.6em] pr-1.5 relative">
                {li && (
                  <span
                    className={`absolute right-0.5 top-0 cursor-pointer ${C[li.severity]}`}
                    title={li.message}
                    onClick={() => {
                      if (ref.current) {
                        const la = value.split("\n");
                        let pos = 0;
                        for (let k = 0; k < i; k++) pos += la[k].length + 1;
                        ref.current.focus();
                        ref.current.setSelectionRange(pos, pos + la[i].length);
                      }
                    }}
                  >
                    {G[li.severity]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="relative flex-1">
          <textarea
            ref={ref}
            value={value}
            onChange={e => setField(field, e.target.value)}
            onKeyDown={hk}
            placeholder={placeholder ?? "Begin typing..."}
            spellCheck={false}
            className="w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-[1.6] text-foreground outline-none placeholder:text-muted-foreground/50"
            style={{ minHeight }}
            data-testid={`canonical-${field}-editor`}
          />
          {gt && gTarget === field && (
            <div className="pointer-events-none absolute inset-0 px-3 py-2.5 text-sm leading-[1.6] whitespace-pre-wrap">
              <span className="invisible">{value}{value.endsWith("\n") ? "" : " "}</span>
              <span className="italic text-emerald-600/60">{gt}</span>
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-mono text-emerald-700 not-italic">Tab</span>
            </div>
          )}
        </div>
      </div>

      {showProvenanceUi && (
        <div
          className="mt-1.5 space-y-1"
          data-testid={`provenance-map-${field}`}
          data-editor-only="provenance"
          aria-label="Source provenance (editor only)"
        >
          {segments.map((seg, i) => {
            const kind = provenanceVisualKind(seg.sources);
            if (kind === "manual") return null;
            return (
              <div
                key={`${seg.key}-${i}`}
                className={cn(
                  "border-l-2 px-2 py-1 text-[11px] leading-snug underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                  VISUAL_STYLES[kind],
                )}
                title={formatProvenanceHover(seg.sources)}
                data-provenance-kind={kind}
              >
                <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wide opacity-80">
                  {kind === "merged"
                    ? seg.sources.filter((s) => s !== "manual").map(sourceLabel).join(" + ")
                    : sourceLabel(seg.sources.find((s) => s !== "manual") ?? seg.sources[0]!)}
                </span>
                <span className="text-foreground/80">{seg.text.length > 120 ? `${seg.text.slice(0, 117)}…` : seg.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {issues.slice(0, 3).map(i => (
            <div key={`${i.line}-${i.column}-${i.code}`} className="flex items-start gap-2 text-[10px]">
              <span className={`font-mono ${C[i.severity]}`}>{G[i.severity]}</span>
              <span className="text-muted-foreground"><span className="font-mono">L{i.line}</span> · {i.message}</span>
            </div>
          ))}
          {issues.length > 3 && <div className="text-[10px] text-muted-foreground/70 pl-5">+{issues.length - 3} more</div>}
        </div>
      )}
    </div>
  );
}
