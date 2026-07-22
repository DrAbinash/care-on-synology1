/**
 * FindingsLibraryPanel — the searchable findings catalogue embedded in the
 * Reporting Workspace right rail. The radiologist searches ~3,900 de-identified
 * house findings, ticks the ones that apply, and inserts them straight into the
 * report being written: grouped findings → `rawFindings`, abnormal ones →
 * `impression`. This is what makes the Report Builder useful in-context.
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { composeFindings } from "@/lib/findingsCompose";
import { Search, Check, Plus, Trash2, FilePlus2, AlertTriangle } from "lucide-react";

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
interface Picked extends Finding { pickedAbnormal: boolean }

const MODALITY_STYLE: Record<string, string> = {
  CT: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  MRI: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  USG: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  XRAY: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
};
const CAP = 120;

export interface FindingsLibraryPanelProps {
  /** current study modality, used to pre-filter (e.g. "USG", "CT", "MR") */
  modalityHint?: string;
  /** append a grouped findings block into rawFindings */
  onInsertFindings: (text: string) => void;
  /** append impression lines */
  onInsertImpression: (lines: string[]) => void;
  /** optionally set/append technique when a template is used */
  onInsertTechnique?: (text: string) => void;
  disabled?: boolean;
}

function normalizeModality(hint?: string): string {
  const h = (hint || "").toUpperCase();
  if (h.includes("USG") || h.includes("ULTRA") || h.includes("US")) return "USG";
  if (h.includes("MR")) return "MRI";
  if (h.includes("CT") || h.includes("CECT") || h.includes("NCCT")) return "CT";
  if (h.includes("XR") || h.includes("RAY") || h.includes("DX") || h.includes("CR")) return "XRAY";
  return "";
}

export default function FindingsLibraryPanel({
  modalityHint, onInsertFindings, onInsertImpression, onInsertTechnique, disabled,
}: FindingsLibraryPanelProps) {
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

  const [q, setQ] = useState("");
  const [modality, setModality] = useState("");
  const [region, setRegion] = useState("");
  const [picked, setPicked] = useState<Record<string, Picked>>({});

  useEffect(() => { setModality(normalizeModality(modalityHint)); }, [modalityHint]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const regionLabel = useMemo(() => {
    const m = new Map<string, string>();
    lib?.regions.forEach((r) => m.set(r.key, r.label));
    return (k: string) => m.get(k) ?? k;
  }, [lib]);

  const regionsForModality = useMemo(() => {
    if (!lib) return [] as string[];
    const set = new Set<string>();
    for (const f of lib.findings) if (!modality || f.modality === modality) set.add(f.region);
    return [...set].sort((a, b) => regionLabel(a).localeCompare(regionLabel(b)));
  }, [lib, modality, regionLabel]);

  const results = useMemo(() => {
    if (!lib) return [] as Finding[];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Finding[] = [];
    for (const f of lib.findings) {
      if (modality && f.modality !== modality) continue;
      if (region && f.region !== region) continue;
      if (terms.length) {
        const hay = `${f.text} ${f.section} ${f.keywords.join(" ")}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      out.push(f);
    }
    out.sort((a, b) => b.frequency - a.frequency);
    return out;
  }, [lib, q, modality, region]);

  const grouped = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of results.slice(0, CAP)) {
      const k = f.section || "General";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return [...map.entries()];
  }, [results]);

  const pickedList = useMemo(() => Object.values(picked), [picked]);

  function toggle(f: Finding) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = { ...f, pickedAbnormal: f.abnormal };
      return next;
    });
  }

  function addTemplate(t: StudyTemplate) {
    setModality(t.modality); setRegion(t.region);
    if (t.technique && onInsertTechnique) onInsertTechnique(t.technique);
    setPicked((prev) => {
      const next = { ...prev };
      t.sections.forEach((s, i) => {
        const id = `tpl_${t.id}_${i}`;
        next[id] = { id, text: s.normal, modality: t.modality, region: t.region, section: s.section,
          impression: false, abnormal: false, frequency: 0, keywords: [], pickedAbnormal: false };
      });
      return next;
    });
  }

  function doInsert() {
    if (!pickedList.length) return;
    const { findingsText, impressionLines } = composeFindings(
      pickedList.map((p) => ({ text: p.text, section: p.section, abnormal: p.pickedAbnormal })),
    );
    if (findingsText) onInsertFindings(findingsText);
    if (impressionLines.length) onInsertImpression(impressionLines);
    toast({ title: "Inserted into report", description: `${pickedList.length} findings${impressionLines.length ? ` · ${impressionLines.length} to impression` : ""}.` });
    setPicked({});
  }

  const abn = pickedList.filter((p) => p.pickedAbnormal).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled}
          placeholder="Search findings — cholelithiasis, disc bulge…" className="h-8 pl-8 text-xs" />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-1">
        <Chip active={!modality} onClick={() => { setModality(""); setRegion(""); }}>All</Chip>
        {lib?.modalities.map((m) => (
          <Chip key={m} active={modality === m} onClick={() => { setModality(m); setRegion(""); }}>{m}</Chip>
        ))}
        {modality && regionsForModality.length > 0 && (
          <select
            value={region} onChange={(e) => setRegion(e.target.value)}
            className="ml-auto h-6 rounded border bg-background px-1 text-[11px]"
          >
            <option value="">All regions</option>
            {regionsForModality.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}
          </select>
        )}
      </div>

      {/* templates */}
      {lib && (
        <ScrollArea className="max-h-14 shrink-0">
          <div className="flex flex-wrap gap-1 pr-1">
            {lib.templates
              .filter((t) => !modality || t.modality === modality)
              .slice(0, 12)
              .map((t) => (
                <button key={t.id} onClick={() => addTemplate(t)} disabled={disabled}
                  title={`Add ${t.sections.length} normal findings from ${t.label}`}
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] hover:border-primary hover:bg-primary/5 disabled:opacity-50">
                  <FilePlus2 className="h-2.5 w-2.5" /> {t.label}
                </button>
              ))}
          </div>
        </ScrollArea>
      )}

      <div className="text-[10px] text-muted-foreground">
        {isLoading ? "Loading…" : isError ? "Failed to load library" : `${results.length} match${results.length === 1 ? "" : "es"}${results.length > CAP ? ` · top ${CAP}` : ""}`}
      </div>

      {/* results */}
      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div className="flex flex-col gap-2">
          {grouped.map(([section, items]) => (
            <div key={section}>
              <div className="sticky top-0 z-10 bg-background/95 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{section}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((f) => {
                  const on = !!picked[f.id];
                  return (
                    <button key={f.id} onClick={() => toggle(f)} disabled={disabled}
                      className={`flex items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11px] leading-snug transition-colors ${on ? "bg-primary/10" : "hover:bg-muted/60"}`}>
                      <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                        {on ? <Check className="h-2.5 w-2.5" /> : null}
                      </span>
                      <span className="flex-1">
                        {f.text}
                        {f.abnormal && <AlertTriangle className="ml-1 inline h-2.5 w-2.5 text-rose-500 align-text-top" />}
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

      {/* insert bar */}
      <div className="flex items-center gap-2 border-t pt-2">
        <div className="flex items-center gap-1 text-[11px]">
          <Badge variant="secondary" className="h-5">{pickedList.length}</Badge>
          {abn > 0 && <span className="text-rose-600">{abn}→imp</span>}
          {pickedList.length > 0 && (
            <button onClick={() => setPicked({})} className="text-muted-foreground hover:text-destructive" title="Clear selection"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <Button size="sm" className="ml-auto h-7 flex-1 text-xs" disabled={disabled || pickedList.length === 0} onClick={doInsert}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Insert {pickedList.length || ""} into report
        </Button>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
      {children}
    </button>
  );
}
