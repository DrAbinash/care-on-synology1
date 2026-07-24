// PathologyRegistry.tsx — admin console for the Universal Pathology Analyte &
// Panel Registry (@workspace/pathology). Read-only maintenance view of the
// registry-as-code catalog plus a coverage scan that resolves the free-text
// parameter names in historical pathology reports against the registry. Twin of
// MeasurementRegistryManager; backed by GET /api/pathology-registry(/validation,
// /coverage).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, ScanSearch } from "lucide-react";

interface Analyte {
  id: string; canonicalKey: string; displayName: string; shortName?: string;
  aliases: string[]; loinc?: string; description: string; department: string;
  resultType: string; defaultUnit: string; allowedUnits: string[]; precision: number;
  referenceIntervals: unknown[]; criticalLow?: number; criticalHigh?: number;
  deprecated?: boolean; replacedBy?: string; version: string; notes?: string;
}
interface Panel {
  id: string; displayName: string; aliases: string[]; loinc?: string; description: string;
  department: string; analytes: string[]; testCodes?: string[]; deprecated?: boolean;
  resolvedAnalytes: { id: string; displayName: string; defaultUnit: string }[];
}
interface CatalogResponse {
  catalogVersion: string; healthy: boolean; analyteCount: number; panelCount: number;
  analytes: Analyte[]; panels: Panel[];
}
interface ValidationResponse { healthy: boolean; issues: unknown[] }
interface CoverageResponse {
  catalogVersion: string; reportsScanned: number; distinctLabels: number;
  resolvedLabels: number; unresolvedLabels: number; coveragePct: number | null;
  topUnresolved: { label: string; occurrences: number }[];
  resolvedSample: { label: string; analyteId: string; occurrences: number }[];
}

const issueText = (i: unknown) => (typeof i === "string" ? i : JSON.stringify(i));

function AnalyteRow({ a }: { a: Analyte }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1 font-mono text-xs font-semibold">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {a.id}
            {a.deprecated && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">deprecated</span>}
          </div>
        </td>
        <td className="px-2 py-1.5 text-sm">{a.displayName}{a.shortName ? <span className="text-muted-foreground"> · {a.shortName}</span> : ""}</td>
        <td className="px-2 py-1.5 text-xs">{a.department}</td>
        <td className="px-2 py-1.5 text-xs">{a.resultType}</td>
        <td className="px-2 py-1.5 text-xs font-mono">{a.defaultUnit || "—"}</td>
        <td className="px-2 py-1.5 text-xs font-mono">{a.loinc || "—"}</td>
        <td className="px-2 py-1.5 text-xs text-center">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.referenceIntervals.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{a.referenceIntervals.length}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2 text-xs">
              <div>
                <p className="mb-1 text-muted-foreground">{a.description}</p>
                <p><span className="font-semibold">Canonical key:</span> <span className="font-mono">{a.canonicalKey}</span> · <span className="font-semibold">v{a.version}</span></p>
                <p className="mt-1"><span className="font-semibold">Aliases ({a.aliases.length}):</span> {a.aliases.join(" · ") || "—"}</p>
                <p className="mt-1"><span className="font-semibold">Units:</span> {a.allowedUnits.join(", ") || "—"} (default {a.defaultUnit || "—"}, precision {a.precision})</p>
                <p className="mt-1"><span className="font-semibold">Reference intervals:</span> {a.referenceIntervals.length}</p>
                {(a.criticalLow !== undefined || a.criticalHigh !== undefined) && (
                  <p className="mt-1"><span className="font-semibold">Critical:</span> {a.criticalLow !== undefined ? `≤ ${a.criticalLow}` : ""}{a.criticalLow !== undefined && a.criticalHigh !== undefined ? " / " : ""}{a.criticalHigh !== undefined ? `≥ ${a.criticalHigh}` : ""} {a.defaultUnit}</p>
                )}
                {a.replacedBy && <p className="mt-1"><span className="font-semibold">Replaced by:</span> <span className="font-mono">{a.replacedBy}</span></p>}
                {a.notes && <p className="mt-1 italic text-muted-foreground">{a.notes}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AnalytesTab({ data }: { data?: CatalogResponse }) {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const departments = useMemo(() => Array.from(new Set((data?.analytes ?? []).map((a) => a.department))).sort(), [data]);
  const filtered = useMemo(() => {
    const rows = data?.analytes ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((a) => {
      if (dept !== "all" && a.department !== dept) return false;
      if (!q) return true;
      return a.id.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q) || (a.loinc ?? "").toLowerCase().includes(q) || a.aliases.some((x) => x.toLowerCase().includes(q));
    });
  }, [data, search, dept]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search id, name, alias, LOINC…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
        <Button size="sm" variant={dept === "all" ? "default" : "outline"} onClick={() => setDept("all")}>All</Button>
        {departments.map((d) => <Button key={d} size="sm" variant={dept === d ? "default" : "outline"} onClick={() => setDept(d)}>{d}</Button>)}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Canonical ID</th><th className="px-2 py-2">Display name</th><th className="px-2 py-2">Department</th>
              <th className="px-2 py-2">Result type</th><th className="px-2 py-2">Unit</th><th className="px-2 py-2">LOINC</th><th className="px-2 py-2 text-center">Ref intervals</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => <AnalyteRow key={a.id} a={a} />)}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">{data ? "No analytes match the filter." : "Loading registry…"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelsTab({ data }: { data?: CatalogResponse }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const rows = data?.panels ?? [];
    const q = search.trim().toLowerCase();
    return q ? rows.filter((p) => p.id.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q) || p.aliases.some((x) => x.toLowerCase().includes(q))) : rows;
  }, [data, search]);
  return (
    <div className="space-y-3">
      <Input placeholder="Search panel id, name, alias…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
      <div className="space-y-2">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-xs font-semibold">{p.id} <span className="font-sans text-sm font-normal text-foreground">· {p.displayName}</span>{p.deprecated && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">deprecated</span>}</div>
              <Badge variant="outline" className="text-[10px]">{p.department}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.resolvedAnalytes.map((a) => <span key={a.id} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{a.displayName}{a.defaultUnit ? <span className="text-muted-foreground"> ({a.defaultUnit})</span> : ""}</span>)}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{data ? "No panels match the filter." : "Loading…"}</p>}
      </div>
    </div>
  );
}

function CoverageTab() {
  const { data, isFetching, refetch, isFetched } = useQuery<CoverageResponse>({
    queryKey: ["pathology-coverage"], queryFn: () => api.get("/api/pathology-registry/coverage"), enabled: false,
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => refetch()} disabled={isFetching}><ScanSearch className={`mr-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />{isFetching ? "Scanning…" : "Run coverage scan"}</Button>
        <p className="text-xs text-muted-foreground">Resolves historical pathology parameter names against the registry. Reads only label names, never patient values.</p>
      </div>
      {isFetched && data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Reports scanned" value={data.reportsScanned} />
            <Stat label="Distinct labels" value={data.distinctLabels} />
            <Stat label="Canonical coverage" value={data.coveragePct == null ? "—" : `${data.coveragePct}%`} />
            <Stat label="Need an alias" value={data.unresolvedLabels} highlight={data.unresolvedLabels > 0} />
          </div>
          {data.topUnresolved.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Top unresolved labels (add as aliases in lib/pathology/src/catalog.ts):</p>
              <ul className="mt-1 max-h-56 overflow-y-auto text-xs">
                {data.topUnresolved.map((u, i) => <li key={i}><span className="font-mono">"{u.label}"</span> — {u.occurrences}×</li>)}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Every historical pathology label resolves to a canonical analyte.</div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default function PathologyRegistry() {
  const { data, isFetching, refetch } = useQuery<CatalogResponse>({
    queryKey: ["pathology-registry"], queryFn: () => api.get("/api/pathology-registry"), staleTime: 60_000,
  });
  const { data: validation } = useQuery<ValidationResponse>({
    queryKey: ["pathology-validation"], queryFn: () => api.get("/api/pathology-registry/validation"), staleTime: 60_000,
  });
  const issues = validation?.issues ?? [];

  return (
    <div className="space-y-4 p-4">
      <PageHeader title="Pathology Registry" subtitle={`Universal Pathology Analyte & Panel Registry — ${data?.analyteCount ?? "…"} analytes, ${data?.panelCount ?? "…"} panels, catalog v${data?.catalogVersion ?? "…"}`} />

      <div className="flex flex-wrap items-center gap-2">
        {data && (data.healthy && issues.length === 0
          ? <div className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Registry self-validation passing</div>
          : <div className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> {issues.length} validation issue{issues.length === 1 ? "" : "s"}</div>)}
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>

      {issues.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <ul className="max-h-40 overflow-y-auto space-y-0.5">{issues.map((i, idx) => <li key={idx} className="font-mono">{issueText(i)}</li>)}</ul>
        </div>
      )}

      <Tabs defaultValue="analytes">
        <TabsList>
          <TabsTrigger value="analytes">Analytes</TabsTrigger>
          <TabsTrigger value="panels">Panels</TabsTrigger>
          <TabsTrigger value="coverage"><ScanSearch className="h-3.5 w-3.5 mr-1" />Coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="analytes" className="mt-4"><AnalytesTab data={data} /></TabsContent>
        <TabsContent value="panels" className="mt-4"><PanelsTab data={data} /></TabsContent>
        <TabsContent value="coverage" className="mt-4"><CoverageTab /></TabsContent>
      </Tabs>
    </div>
  );
}
