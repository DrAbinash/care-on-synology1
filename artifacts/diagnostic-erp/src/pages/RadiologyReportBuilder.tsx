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
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { composeReport, type BaseSection } from "@/lib/findingsCompose";
import { useFindingsLibrary, type Finding } from "@/hooks/useFindingsLibrary";
import {
  Search, Check, Copy, Trash2, FileCheck2, AlertTriangle, ExternalLink, Settings2, X,
} from "lucide-react";

const MODALITY_STYLE: Record<string, string> = {
  CT: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
  MRI: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800",
  USG: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800",
  XRAY: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
};
const CAP = 160;

function FindingSelectButton({
  finding,
  selected,
  onToggle,
}: {
  finding: Finding;
  selected: boolean;
  onToggle: () => void;
}) {
  const keywords = (finding.keywords ?? []).filter(Boolean).slice(0, 3);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={finding.text}
      className={[
        "group relative w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
        selected
          ? "border-rose-400/70 bg-rose-50/80 shadow-sm dark:border-rose-500/50 dark:bg-rose-950/30"
          : "border-border/70 bg-card hover:border-border hover:bg-muted/40 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={[
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            selected
              ? "border-rose-500 bg-rose-500 text-white"
              : "border-muted-foreground/35 bg-background text-transparent group-hover:border-muted-foreground/55",
          ].join(" ")}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <p className={`text-[13px] leading-snug ${selected ? "font-medium text-foreground" : "text-foreground/90"}`}>
              {finding.text}
            </p>
            {finding.abnormal && (
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500"
                aria-label="Abnormal finding"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                MODALITY_STYLE[finding.modality] ?? "bg-muted text-muted-foreground border-border"
              }`}
            >
              {finding.modality}
            </span>
            {finding.region ? (
              <span className="text-[10px] text-muted-foreground">{finding.region}</span>
            ) : null}
            {finding.frequency > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground/80">
                · used {finding.frequency}×
              </span>
            )}
            {keywords.map((k) => (
              <span
                key={k}
                className="rounded bg-muted/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function RadiologyReportBuilder() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);

  const { templates, findings: allFindings, seeded, isLoading, isError } = useFindingsLibrary();

  const [modality, setModality] = useState("");
  const [baseId, setBaseId] = useState("");
  const [q, setQ] = useState("");
  const [abnormalOnly, setAbnormalOnly] = useState(true);
  const [selected, setSelected] = useState<Record<string, Finding>>({});
  const [title, setTitle] = useState("");

  useEffect(() => { searchRef.current?.focus(); }, []);

  const base = useMemo(() => templates.find((t) => t.id === baseId) ?? null, [templates, baseId]);
  const effModality = base?.modality || modality;

  function chooseBase(id: string) {
    setBaseId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setModality(t.modality); if (!title.trim()) setTitle(t.label.toUpperCase()); }
  }

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Finding[] = [];
    for (const f of allFindings) {
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
  }, [allFindings, q, effModality, base, abnormalOnly]);

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
      `\nIMPRESSION:\n${imp || "—"}`,
    ].filter(Boolean).join("\n");
  }, [title, base, report.findingsText, impressionOut]);

  function toggle(f: Finding) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = f;
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
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Report Builder"
          subtitle={isLoading ? "Loading…" : `Pick a normal format, tick the abnormal findings — they replace that organ's normal line and build the impression`}
        />
        <Button variant="outline" size="sm" onClick={() => navigate("/radiology/findings-manager")} className="mt-1 shrink-0">
          <Settings2 className="mr-1 h-4 w-4" /> Manage findings
          {!seeded && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">starter</span>}
        </Button>
      </div>
      {isError && <Card><CardContent className="p-4 text-sm text-destructive">Could not load the findings library.</CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT: base + search + abnormal findings */}
        <Card className="overflow-hidden border-border/80 shadow-sm">
          <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
            {/* base format */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <FileCheck2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">Base normal format</span>
              <select value={baseId} onChange={(e) => chooseBase(e.target.value)}
                className="h-8 min-w-[200px] flex-1 rounded-md border border-border bg-background px-2 text-xs shadow-sm">
                <option value="">— select a study —</option>
                {[...templates].sort((a, b) => b.sampleCount - a.sampleCount).map((t) => (
                  <option key={t.id} value={t.id}>{t.label} — normal ({t.sampleCount})</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search abnormal findings — cholelithiasis, disc bulge, infarct…" className="h-9 pl-9" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setAbnormalOnly(true)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    abnormalOnly
                      ? "bg-rose-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Abnormal only
                </button>
                <button
                  type="button"
                  onClick={() => setAbnormalOnly(false)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    !abnormalOnly
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All findings
                </button>
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {isLoading ? "Loading…" : `${results.length} match${results.length === 1 ? "" : "es"}${results.length > CAP ? ` · showing ${CAP}` : ""}`}
              </span>
            </div>

            {/* Selected chips strip */}
            {selectedList.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-rose-200/80 bg-rose-50/50 px-2.5 py-2 dark:border-rose-900/50 dark:bg-rose-950/20">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  Selected ({selectedList.length})
                </span>
                {selectedList.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f)}
                    className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-rose-300/80 bg-background px-2 py-0.5 text-[11px] text-foreground hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-950/40"
                    title="Click to remove"
                  >
                    <span className="truncate">{f.text.length > 42 ? `${f.text.slice(0, 42)}…` : f.text}</span>
                    <X className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" /> Clear all
                </button>
              </div>
            )}

            <ScrollArea className="h-[calc(100vh-380px)] min-h-[300px] pr-2">
              <div className="flex flex-col gap-4">
                {grouped.map(([section, items]) => (
                  <div key={section} className="space-y-2">
                    <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 py-1 backdrop-blur">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {section}
                      </h3>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                      <div className="h-px flex-1 bg-border/70" />
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {items.map((f) => (
                        <FindingSelectButton
                          key={f.id}
                          finding={f}
                          selected={!!selected[f.id]}
                          onToggle={() => toggle(f)}
                        />
                      ))}
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
          <Card className="border-border/80 shadow-sm">
            <CardContent className="flex flex-col gap-2 p-3 sm:p-4">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title" className="h-9 text-sm font-semibold" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{report.lines.length} organs</Badge>
                {abnormalCount > 0 && (
                  <Badge variant="outline" className="border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300">
                    {abnormalCount} abnormal
                  </Badge>
                )}
                {selectedList.length > 0 && (
                  <button type="button" onClick={() => setSelected({})} className="ml-auto inline-flex items-center gap-1 hover:text-destructive">
                    <Trash2 className="h-3 w-3" /> clear
                  </button>
                )}
              </div>

              <ScrollArea className="max-h-[46vh] rounded-lg border bg-muted/20 p-3">
                {report.lines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Select a base format and tick abnormal findings to build the report.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Findings</div>
                    {report.lines.map((l, i) => (
                      <div
                        key={i}
                        className={
                          l.abnormal
                            ? "rounded-md border border-rose-200/70 bg-rose-50/60 px-2 py-1 font-medium text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300"
                            : "px-2 py-0.5"
                        }
                      >
                        <span className="font-semibold">{l.section}:</span> {l.text}
                      </div>
                    ))}
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Impression</div>
                    {impressionOut.map((l, i) => (
                      <div key={i} className="px-2">{impressionOut.length > 1 ? `${i + 1}. ` : ""}{l}</div>
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
