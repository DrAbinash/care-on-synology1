/**
 * FindingsLibraryPanel — template-driven report builder embedded in the
 * Reporting Workspace right rail.
 *
 * Workflow the radiologist actually uses:
 *   1. A base normal format is auto-selected from the study (or picked here).
 *   2. Search and tick the abnormal findings that apply.
 *   3. Each abnormal REPLACES that organ's normal line in the body and adds an
 *      impression line; every other organ stays normal.
 *   4. "Apply to report" writes the composed Findings + Impression into the
 *      report being edited.
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { composeReport, type BaseSection } from "@/lib/findingsCompose";
import { Search, Check, Trash2, FileCheck2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

interface Finding {
  id: string; text: string; modality: string; region: string; section: string;
  impression: boolean; abnormal: boolean; frequency: number; keywords: string[];
}
interface TemplateSection { section: string; normal: string }
interface StudyTemplate {
  id: string; modality: string; region: string; label: string;
  technique: string; sections: TemplateSection[]; normalImpression: string;
  sampleCount: number; normalCount: number;
}
interface Library {
  modalities: string[]; regions: { key: string; label: string }[];
  stats: { findings: number; templates: number };
  templates: StudyTemplate[]; findings: Finding[];
}

const MODALITY_STYLE: Record<string, string> = {
  CT: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  MRI: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  USG: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  XRAY: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
};
const CAP = 120;

export interface FindingsLibraryPanelProps {
  modalityHint?: string;
  studyHint?: string;
  /** replace the report's Findings + Impression with the composed report */
  onApplyReport: (r: { findingsText: string; impressionLines: string[]; technique?: string }) => void;
  disabled?: boolean;
}

function normalizeModality(hint?: string): string {
  const h = (hint || "").toUpperCase();
  if (h.includes("USG") || h.includes("ULTRA") || /\bUS\b/.test(h)) return "USG";
  if (h.includes("MR")) return "MRI";
  if (h.includes("CT") || h.includes("CECT") || h.includes("NCCT")) return "CT";
  if (h.includes("XR") || h.includes("RAY") || h.includes("DX") || h.includes("CR")) return "XRAY";
  return "";
}

/** Pick the best base template for the current study. */
function pickBase(templates: StudyTemplate[], modality: string, studyHint?: string): string {
  const pool = templates.filter((t) => !modality || t.modality === modality);
  if (!pool.length) return "";
  const hint = (studyHint || "").toLowerCase();
  if (hint) {
    const byLabel = pool.find((t) => t.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && hint.includes(w)));
    if (byLabel) return byLabel.id;
  }
  return [...pool].sort((a, b) => b.sampleCount - a.sampleCount)[0].id;
}

export default function FindingsLibraryPanel({ modalityHint, studyHint, onApplyReport, disabled }: FindingsLibraryPanelProps) {
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: lib, isLoading, isError } = useQuery<Library>({
    queryKey: ["radiology-findings-library"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/radiology-findings-library.json`);
      if (!res.ok) throw new Error(`Failed to load findings library (${res.status})`);
      return res.json() as Promise<Library>;
    },
    staleTime: Infinity,
  });

  const hintModality = normalizeModality(modalityHint);
  const [baseId, setBaseId] = useState("");
  const [q, setQ] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(true);
  const [selected, setSelected] = useState<Record<string, Finding>>({});
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => { searchRef.current?.focus(); }, []);
  // auto-select the base format once the library is available
  useEffect(() => {
    if (lib && !baseId) setBaseId(pickBase(lib.templates, hintModality, studyHint));
  }, [lib, baseId, hintModality, studyHint]);

  const base = useMemo(() => lib?.templates.find((t) => t.id === baseId) ?? null, [lib, baseId]);
  const modality = base?.modality || hintModality;

  const regionLabel = useMemo(() => {
    const m = new Map<string, string>();
    lib?.regions.forEach((r) => m.set(r.key, r.label));
    return (k: string) => m.get(k) ?? k;
  }, [lib]);

  const results = useMemo(() => {
    if (!lib) return [] as Finding[];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Finding[] = [];
    for (const f of lib.findings) {
      if (modality && f.modality !== modality) continue;
      if (base && f.region !== base.region && !terms.length) continue; // scope to study region when just browsing
      if (abnormalOnly && !f.abnormal) continue;
      if (terms.length) {
        const hay = `${f.text} ${f.section} ${f.keywords.join(" ")}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      out.push(f);
    }
    out.sort((a, b) => b.frequency - a.frequency);
    return out;
  }, [lib, q, modality, base, abnormalOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of results.slice(0, CAP)) {
      const k = f.section || "General";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return [...map.entries()];
  }, [results]);

  const selectedList = useMemo(() => Object.values(selected), [selected]);

  const report = useMemo(() => {
    const baseSections: BaseSection[] | undefined = base?.sections.map((s) => ({ section: s.section, normal: s.normal }));
    return composeReport(baseSections, selectedList.map((f) => ({ text: f.text, section: f.section, abnormal: f.abnormal })));
  }, [base, selectedList]);

  // When nothing abnormal is selected, fall back to the base's normal impression.
  const impressionOut = report.impressionLines.length
    ? report.impressionLines
    : (base ? [base.normalImpression] : []);

  function toggle(f: Finding) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = f;
      return next;
    });
  }

  function apply() {
    if (!report.findingsText) return;
    onApplyReport({ findingsText: report.findingsText, impressionLines: impressionOut, technique: base?.technique });
    const abn = report.lines.filter((l) => l.abnormal).length;
    toast({ title: "Applied to report", description: `${report.lines.length} organs · ${abn} abnormal · ${impressionOut.length} impression line${impressionOut.length === 1 ? "" : "s"}.` });
  }

  const abnormalCount = report.lines.filter((l) => l.abnormal).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      {/* base format */}
      <div className="flex items-center gap-1.5">
        <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <select
          value={baseId} onChange={(e) => setBaseId(e.target.value)} disabled={disabled}
          className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-[11px]"
          title="Base normal format"
        >
          <option value="">No base (compose from selection)</option>
          {(lib?.templates ?? [])
            .filter((t) => !modality || t.modality === modality)
            .sort((a, b) => b.sampleCount - a.sampleCount)
            .map((t) => <option key={t.id} value={t.id}>{t.label} — normal</option>)}
        </select>
      </div>

      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled}
          placeholder="Search abnormal findings — cholelithiasis, infarct…" className="h-8 pl-8 text-xs" />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <button onClick={() => setAbnormalOnly((v) => !v)} className={`rounded px-1.5 py-0.5 font-medium ${abnormalOnly ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : "bg-muted"}`}>
          {abnormalOnly ? "Abnormal only" : "All findings"}
        </button>
        <span>{isLoading ? "Loading…" : isError ? "load failed" : `${results.length} match${results.length === 1 ? "" : "es"}`}</span>
      </div>

      {/* results */}
      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div className="flex flex-col gap-2">
          {grouped.map(([section, items]) => (
            <div key={section}>
              <div className="sticky top-0 z-10 bg-background/95 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{section}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((f) => {
                  const on = !!selected[f.id];
                  return (
                    <button key={f.id} onClick={() => toggle(f)} disabled={disabled}
                      className={`flex items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11px] leading-snug transition-colors ${on ? "bg-primary/10" : "hover:bg-muted/60"}`}>
                      <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                        {on ? <Check className="h-2.5 w-2.5" /> : null}
                      </span>
                      <span className="flex-1">
                        {f.text}
                        {f.abnormal && <AlertTriangle className="ml-1 inline h-2.5 w-2.5 align-text-top text-rose-500" />}
                      </span>
                      <span className={`shrink-0 rounded px-1 text-[9px] font-medium ${MODALITY_STYLE[f.modality] ?? "bg-muted"}`}>{f.modality}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!isLoading && !isError && results.length === 0 && (
            <div className="py-6 text-center text-[11px] text-muted-foreground">No findings match “{q}”.</div>
          )}
        </div>
      </ScrollArea>

      {/* live preview of the composed report */}
      <div className="shrink-0 rounded-md border">
        <button onClick={() => setPreviewOpen((v) => !v)} className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-medium">
          <span className="flex items-center gap-1">
            Report preview
            {abnormalCount > 0 && <span className="rounded bg-rose-100 px-1 text-[9px] text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">{abnormalCount} abnormal</span>}
          </span>
          {previewOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        {previewOpen && (
          <ScrollArea className="max-h-40 border-t px-2 py-1">
            {report.lines.length === 0 ? (
              <p className="py-2 text-[10px] text-muted-foreground">Pick a base format and tick abnormal findings to preview the report.</p>
            ) : (
              <div className="flex flex-col gap-0.5 text-[10.5px] leading-snug">
                {report.lines.map((l, i) => (
                  <div key={i} className={l.abnormal ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground"}>
                    <span className="font-semibold">{l.section}:</span> {l.text}
                  </div>
                ))}
                {impressionOut.length > 0 && (
                  <div className="mt-1 border-t pt-1">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Impression</span>
                    {impressionOut.map((l, i) => (
                      <div key={i} className="text-foreground">{impressionOut.length > 1 ? `${i + 1}. ` : ""}{l}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        )}
      </div>

      {/* apply bar */}
      <div className="flex items-center gap-2 border-t pt-2">
        <div className="flex items-center gap-1 text-[11px]">
          <Badge variant="secondary" className="h-5">{selectedList.length}</Badge>
          {selectedList.length > 0 && (
            <button onClick={() => setSelected({})} className="text-muted-foreground hover:text-destructive" title="Clear abnormal selection"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <Button size="sm" className="ml-auto h-7 flex-1 text-xs" disabled={disabled || !report.findingsText} onClick={apply}
          title="Replaces the report's Findings and Impression with the composed report">
          <FileCheck2 className="mr-1 h-3.5 w-3.5" /> Apply to report
        </Button>
      </div>
    </div>
  );
}
