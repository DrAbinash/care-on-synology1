/**
 * RadiologyReportBuilder.tsx — template-driven report builder.
 *
 * Pick a base normal format (auto-suggested), search and tick the abnormal
 * findings that apply; each abnormal replaces that organ's normal line and adds
 * an impression line, every other organ stays normal. The composed report is
 * shown live and can be copied or carried into the reporting workspace (where
 * the same catalogue is available as the "Library" tab).
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { composeReport, type BaseSection } from "@/lib/findingsCompose";
import { Search, Check, Copy, Trash2, FileCheck2, AlertTriangle, ExternalLink } from "lucide-react";

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
  stats: { sourceReports: number; findings: number; templates: number };
  templates: StudyTemplate[]; findings: Finding[];
}

const MODALITY_STYLE: Record<string, string> = {
  CT: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  MRI: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
  USG: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  XRAY: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
};
const CAP = 160;

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

  const [modality, setModality] = useState("");
  const [baseId, setBaseId] = useState("");
  const [q, setQ] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(true);
  const [selected, setSelected] = useState<Record<string, Finding>>({});
  const [title, setTitle] = useState("");

  useEffect(() => { searchRef.current?.focus(); }, []);

  const base = useMemo(() => lib?.templates.find((t) => t.id === baseId) ?? null, [lib, baseId]);
  const effModality = base?.modality || modality;

  // when a base is chosen, sync title + modality
  function chooseBase(id: string) {
    setBaseId(id);
    const t = lib?.templates.find((x) => x.id === id);
    if (t) { setModality(t.modality); if (!title.trim()) setTitle(t.label.toUpperCase()); }
  }

  const results = useMemo(() => {
    if (!lib) return [] as Finding[];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Finding[] = [];
    for (const f of lib.findings) {
      if (effModality && f.modality !== effModality) continue;
      if (base && f.region !== base.region && !terms.length) continue;
      if (abnormalOnly && !f.abnormal) continue;
      if (terms.length) {
        const hay = `${f.text} ${f.section} ${f.keywords.join(" ")}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      out.push(f);
    }
    out.sort((a, b) => b.frequency - a.frequency);
    return out;
  }, [lib, q, effModality, base, abnormalOnly]);

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

  const impressionOut = report.impressionLines.length ? report.impressionLines : (base ? [base.normalImpression] : []);

  const plainText = useMemo(() => {
    const imp = impressionOut.length
      ? (impressionOut.length > 1 ? impressionOut.map((l, i) => `${i + 1}. ${l}`).join("\n") : impressionOut[0])
      : "";
    return [
      title ? title.toUpperCase() : null,
      base?.technique ? `\nTECHNIQUE:\n${base.technique}` : null,
      `\nFINDINGS:\n${report.findingsText || "—"}`,
      imp ? `\nIMPRESSION:\n${imp}` : null,
    ].filter(Boolean).join("\n").trim();
  }, [title, base, report.findingsText, impressionOut]);

  function toggle(f: Finding) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id]; else next[f.id] = f;
      return next;
    });
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(plainText); toast({ title: "Report copied" }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  }

  const abnormalCount = report.lines.filter((l) => l.abnormal).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Report Builder"
        subtitle={lib ? `Pick a normal format, tick the abnormal findings — they replace that organ's normal line and build the impression` : "Loading…"}
      />
      {isError && <Card><CardContent className="p-4 text-sm text-destructive">Could not load the findings library.</CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT: base + search + abnormal findings */}
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col gap-3 p-3">
            {/* base format */}
            <div className="flex flex-wrap items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium">Base normal format:</span>
              <select value={baseId} onChange={(e) => chooseBase(e.target.value)}
                className="h-8 min-w-[200px] flex-1 rounded border bg-background px-2 text-xs">
                <option value="">— select a study —</option>
                {[...(lib?.templates ?? [])].sort((a, b) => b.sampleCount - a.sampleCount).map((t) => (
                  <option key={t.id} value={t.id}>{t.label} — normal ({t.sampleCount})</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search abnormal findings — cholelithiasis, disc bulge, infarct…" className="pl-9" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button onClick={() => setAbnormalOnly((v) => !v)}
                className={`rounded px-2 py-0.5 font-medium ${abnormalOnly ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : "bg-muted"}`}>
                {abnormalOnly ? "Abnormal only" : "All findings"}
              </button>
              <span>{isLoading ? "Loading…" : `${results.length} match${results.length === 1 ? "" : "es"}${results.length > CAP ? ` · top ${CAP}` : ""}`}</span>
            </div>

            <ScrollArea className="h-[calc(100vh-340px)] min-h-[300px] pr-2">
              <div className="flex flex-col gap-3">
                {grouped.map(([section, items]) => (
                  <div key={section}>
                    <div className="sticky top-0 z-10 mb-1 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{section}</div>
                    <div className="flex flex-col gap-1">
                      {items.map((f) => {
                        const on = !!selected[f.id];
                        return (
                          <button key={f.id} onClick={() => toggle(f)}
                            className={`group flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors ${on ? "border-primary/60 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/50"}`}>
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                              {on ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="flex-1">
                              {f.text}
                              {f.abnormal && <AlertTriangle className="ml-1 inline h-3 w-3 align-text-top text-rose-500" />}
                              <span className={`ml-2 rounded px-1 py-px text-[10px] font-medium ${MODALITY_STYLE[f.modality] ?? "bg-muted"}`}>{f.modality}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!isLoading && results.length === 0 && (
                  <div className="py-10 text-center text-sm text-muted-foreground">No findings match “{q}”.</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* RIGHT: composed report */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 p-3">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title" className="h-8 text-sm font-semibold" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{report.lines.length} organs</Badge>
                {abnormalCount > 0 && <span className="text-rose-600">{abnormalCount} abnormal</span>}
                {selectedList.length > 0 && (
                  <button onClick={() => setSelected({})} className="ml-auto inline-flex items-center gap-1 hover:text-destructive"><Trash2 className="h-3 w-3" /> clear</button>
                )}
              </div>

              <ScrollArea className="max-h-[46vh] rounded-md border p-2">
                {report.lines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Select a base format and tick abnormal findings to build the report.</p>
                ) : (
                  <div className="flex flex-col gap-1 text-xs leading-relaxed">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Findings</div>
                    {report.lines.map((l, i) => (
                      <div key={i} className={l.abnormal ? "font-medium text-rose-600 dark:text-rose-300" : ""}>
                        <span className="font-semibold">{l.section}:</span> {l.text}
                      </div>
                    ))}
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Impression</div>
                    {impressionOut.map((l, i) => (
                      <div key={i}>{impressionOut.length > 1 ? `${i + 1}. ` : ""}{l}</div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              <div className="flex items-center gap-2">
                <Button onClick={copyReport} disabled={!report.findingsText} className="flex-1"><Copy className="mr-1 h-4 w-4" /> Copy report</Button>
                <Button variant="outline" onClick={() => navigate("/radiology/reporting-workspace")}><ExternalLink className="mr-1 h-4 w-4" /> Workspace</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Draft aid — de-identified house phrasing, no patient data. Tip: the same catalogue is built into the reporting workspace as the <b>Library</b> tab, where “Apply” writes straight into the report.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
