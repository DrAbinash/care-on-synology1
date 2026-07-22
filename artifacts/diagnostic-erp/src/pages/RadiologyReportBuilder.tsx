/**
 * RadiologyReportBuilder.tsx — searchable findings catalogue + merge-into-one.
 *
 * The radiologist searches ~3,900 house-style findings (mined & de-identified
 * from the practice archive), ticks the ones that apply across any number of
 * organs, and merges them into ONE coherent report (Findings grouped by organ
 * + a numbered Impression). Study templates pre-fill a normal report to start
 * from. The catalogue is a static asset (instant offline search); merging is a
 * server call (/api/radiology/findings-library/merge).
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search, Plus, X, Sparkles, Copy, Trash2, FileText, Layers, Check,
  AlertTriangle, CircleDot, ListChecks, Wand2, FilePlus2,
} from "lucide-react";

// ── Types (mirror the mined library JSON) ─────────────────────────────────────
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
  schemaVersion: number; source: string; modalities: string[];
  regions: { key: string; label: string }[];
  stats: { sourceReports: number; findings: number; templates: number };
  templates: StudyTemplate[]; findings: Finding[];
}
interface MergedReport {
  title: string; technique: string; findingsText: string; impressionText: string;
  plainText: string; counts: { findings: number; abnormal: number; sections: number };
  aiText?: string; aiUsed?: boolean;
}

// A selected finding carries an editable "abnormal" flag (drives the Impression).
interface Picked extends Finding { pickedAbnormal: boolean }

const MODALITY_STYLE: Record<string, string> = {
  CT: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  MRI: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  USG: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  XRAY: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
};
const RESULT_CAP = 160;

export default function RadiologyReportBuilder() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
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
  const [modality, setModality] = useState<string>("");
  const [region, setRegion] = useState<string>("");
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const [title, setTitle] = useState("");
  const [technique, setTechnique] = useState("");
  const [normalImpression, setNormalImpression] = useState("No significant abnormality detected.");
  const [aiMode, setAiMode] = useState(false);
  const [reportText, setReportText] = useState("");

  // focus search on mount
  useEffect(() => { searchRef.current?.focus(); }, []);

  const regionLabel = useMemo(() => {
    const m = new Map<string, string>();
    lib?.regions.forEach((r) => m.set(r.key, r.label));
    return (k: string) => m.get(k) ?? k;
  }, [lib]);

  // regions available for the chosen modality (from the findings themselves)
  const regionsForModality = useMemo(() => {
    if (!lib) return [] as string[];
    const set = new Set<string>();
    for (const f of lib.findings) if (!modality || f.modality === modality) set.add(f.region);
    return [...set].sort((a, b) => regionLabel(a).localeCompare(regionLabel(b)));
  }, [lib, modality, regionLabel]);

  // search + filter
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
    // rank: abnormal & query relevance first when searching, else by frequency
    out.sort((a, b) => b.frequency - a.frequency);
    return out;
  }, [lib, q, modality, region]);

  // group visible results by section for scannability
  const grouped = useMemo(() => {
    const capped = results.slice(0, RESULT_CAP);
    const map = new Map<string, Finding[]>();
    for (const f of capped) {
      const k = f.section || "General";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return [...map.entries()];
  }, [results]);

  const pickedList = useMemo(() => Object.values(picked), [picked]);

  function togglePick(f: Finding) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = { ...f, pickedAbnormal: f.abnormal };
      return next;
    });
  }
  function setPickedAbnormal(id: string, val: boolean) {
    setPicked((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], pickedAbnormal: val } } : prev));
  }
  function clearAll() {
    setPicked({}); setReportText(""); setTitle(""); setTechnique("");
  }

  function applyTemplate(t: StudyTemplate) {
    setModality(t.modality);
    setRegion(t.region);
    setTitle(t.label.toUpperCase());
    setTechnique(t.technique || "");
    setNormalImpression(t.normalImpression || "No significant abnormality detected.");
  }
  // Insert the template's normal findings as a ready-to-edit baseline.
  function insertTemplateNormals(t: StudyTemplate) {
    applyTemplate(t);
    setPicked((prev) => {
      const next = { ...prev };
      t.sections.forEach((s, i) => {
        const id = `tpl_${t.id}_${i}`;
        next[id] = {
          id, text: s.normal, modality: t.modality, region: t.region, section: s.section,
          impression: false, abnormal: false, frequency: 0, keywords: [], pickedAbnormal: false,
        };
      });
      return next;
    });
    toast({ title: "Normal template added", description: `${t.sections.length} normal findings from ${t.label}.` });
  }

  const merge = useMutation({
    mutationFn: () =>
      api.post<MergedReport>("/api/radiology/findings-library/merge", {
        findings: pickedList.map((p) => ({ text: p.text, section: p.section, abnormal: p.pickedAbnormal })),
        title, technique, normalImpression, mode: aiMode ? "ai" : "plain",
      }),
    onSuccess: (r) => {
      setReportText(r.aiText || r.plainText);
      toast({
        title: "Report merged",
        description: `${r.counts.findings} findings · ${r.counts.abnormal} in impression${r.aiUsed ? " · AI-smoothed" : ""}.`,
      });
    },
    onError: (e) => toast({ title: "Merge failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  async function copyReport() {
    if (!reportText) return;
    try { await navigator.clipboard.writeText(reportText); toast({ title: "Copied to clipboard" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  }

  const abnormalCount = pickedList.filter((p) => p.pickedAbnormal).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Report Builder"
        subtitle={lib ? `${lib.stats.findings.toLocaleString()} house findings · ${lib.stats.templates} study templates · search, tick, merge into one report` : "Loading findings…"}
      />

      {isError && (
        <Card><CardContent className="p-4 text-sm text-destructive">Could not load the findings library.</CardContent></Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* ── LEFT: search + catalogue ─────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col gap-3 p-3">
            {/* toolbar */}
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search findings — e.g. cholelithiasis, disc bulge, fatty liver, pleural effusion…"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={!modality} onClick={() => { setModality(""); setRegion(""); }}>All</FilterChip>
                {lib?.modalities.map((m) => (
                  <FilterChip key={m} active={modality === m} onClick={() => { setModality(m); setRegion(""); }}>{m}</FilterChip>
                ))}
                {modality && regionsForModality.length > 0 && (
                  <>
                    <span className="mx-1 h-4 w-px bg-border" />
                    <FilterChip active={!region} onClick={() => setRegion("")}>All regions</FilterChip>
                    {regionsForModality.map((r) => (
                      <FilterChip key={r} active={region === r} onClick={() => setRegion(r)}>{regionLabel(r)}</FilterChip>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{isLoading ? "Loading…" : `${results.length.toLocaleString()} match${results.length === 1 ? "" : "es"}${results.length > RESULT_CAP ? ` · showing top ${RESULT_CAP}` : ""}`}</span>
              {results.length > RESULT_CAP && <span>Refine your search to narrow down</span>}
            </div>

            {/* results */}
            <ScrollArea className="h-[calc(100vh-320px)] min-h-[320px] pr-2">
              <div className="flex flex-col gap-3">
                {grouped.map(([section, items]) => (
                  <div key={section}>
                    <div className="sticky top-0 z-10 mb-1 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      {section}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.map((f) => {
                        const on = !!picked[f.id];
                        return (
                          <button
                            key={f.id}
                            onClick={() => togglePick(f)}
                            className={`group flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors ${on ? "border-primary/60 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/50"}`}
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                              {on ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="flex-1">
                              <span>{f.text}</span>
                              <span className="ml-2 inline-flex items-center gap-1 align-middle">
                                <span className={`rounded px-1 py-px text-[10px] font-medium ${MODALITY_STYLE[f.modality] ?? "bg-muted"}`}>{f.modality}</span>
                                {f.abnormal
                                  ? <span className="rounded bg-rose-100 px-1 py-px text-[10px] font-medium text-rose-700 dark:bg-rose-900/50 dark:text-rose-200">abnormal</span>
                                  : <span className="rounded bg-slate-100 px-1 py-px text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">normal</span>}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!isLoading && results.length === 0 && (
                  <div className="py-10 text-center text-sm text-muted-foreground">No findings match “{q}”. Try a different term or clear filters.</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ── RIGHT: selection tray + merged report ────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* templates */}
          {lib && (
            <Card>
              <CardContent className="p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4" /> Start from a study template</div>
                <ScrollArea className="max-h-24">
                  <div className="flex flex-wrap gap-1.5 pr-2">
                    {lib.templates.slice(0, 24).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => insertTemplateNormals(t)}
                        title={`Insert ${t.sections.length} normal findings from ${t.label}`}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs hover:border-primary hover:bg-primary/5"
                      >
                        <FilePlus2 className="h-3 w-3" /> {t.label}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* selection tray */}
          <Card>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4" /> Selected findings
                  <Badge variant="secondary">{pickedList.length}</Badge>
                  {abnormalCount > 0 && <span className="text-xs font-normal text-rose-600">{abnormalCount} → impression</span>}
                </div>
                {pickedList.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs"><Trash2 className="mr-1 h-3 w-3" /> Clear</Button>
                )}
              </div>

              {pickedList.length === 0 ? (
                <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                  Tick findings on the left, or insert a normal template above.
                </div>
              ) : (
                <ScrollArea className="max-h-56 pr-2">
                  <div className="flex flex-col gap-1">
                    {pickedList.map((p) => (
                      <div key={p.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2 py-1 text-xs">
                        <span className="mt-0.5 w-24 shrink-0 truncate font-medium text-muted-foreground" title={p.section}>{p.section}</span>
                        <span className="flex-1">{p.text}</span>
                        <button
                          onClick={() => setPickedAbnormal(p.id, !p.pickedAbnormal)}
                          title={p.pickedAbnormal ? "In impression — click to make normal" : "Mark abnormal (adds to impression)"}
                          className={`shrink-0 rounded px-1 py-px text-[10px] font-medium ${p.pickedAbnormal ? "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}
                        >
                          {p.pickedAbnormal ? <span className="flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />imp</span> : "nml"}
                        </button>
                        <button onClick={() => togglePick(p)} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <Separator className="my-1" />
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title (e.g. USG WHOLE ABDOMEN)" className="h-8 text-sm" />
              <Textarea value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder="Technique (optional)" className="min-h-[42px] text-xs" />

              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setAiMode((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${aiMode ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200" : "text-muted-foreground"}`}
                  title="AI smoothing rewrites into flowing prose without adding or removing findings"
                >
                  {aiMode ? <Sparkles className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />} AI smooth {aiMode ? "on" : "off"}
                </button>
                <Button onClick={() => merge.mutate()} disabled={pickedList.length === 0 || merge.isPending} className="flex-1">
                  <Plus className="mr-1 h-4 w-4" /> Merge {pickedList.length > 0 ? pickedList.length : ""} into one report
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* merged report */}
          <Card>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4" /> Merged report</div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={copyReport} disabled={!reportText} className="h-7 text-xs"><Copy className="mr-1 h-3 w-3" /> Copy</Button>
                  <Button variant="outline" size="sm" onClick={() => navigate("/radiology/reporting-workspace")} className="h-7 text-xs">Open Workspace</Button>
                </div>
              </div>
              <Textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="Merge findings to generate the report here. It stays fully editable."
                className="min-h-[220px] font-mono text-xs leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">
                <CircleDot className="mr-1 inline h-3 w-3" />
                Draft aid only — review and sign in the reporting workspace. De-identified house phrasing; no patient data.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
    >
      {children}
    </button>
  );
}
