// MeasurementRegistryManager.tsx — admin console for the Universal Measurement
// Registry (Steps 12-13). NOT another engine: a read-only maintenance view of
// the registry-as-code catalog (lib/measurements) plus LIVE impact analysis —
// which quick measurements, protocol requirements, knowledge packs, Phase-4
// quality rules and stored rows reference each canonical measurement, and
// which content labels fail to resolve at all.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";

interface UsageRef { source: string; label: string; context: string }

interface RegistryMeasurement {
  id: string;
  canonicalKey: string;
  displayName: string;
  aliases: string[];
  description: string;
  modalities: string[];
  bodyRegion: string;
  studyTypes: string[];
  defaultUnit: string;
  allowedUnits: string[];
  precision: number;
  viewerMapping: { tool: string; dicomSrPattern?: string };
  comparisonStrategy: string;
  normalRange?: { low?: number; high?: number; unit?: string; note?: string };
  criticalRange?: { low?: number; high?: number; unit?: string; note?: string };
  refs: Record<string, string[] | undefined>;
  version: string;
  deprecated?: boolean;
  replacedBy?: string;
  notes?: string;
  usage: UsageRef[];
  usageCount: number;
  phase4Rule: string | null;
}

interface RegistryResponse {
  catalogVersion: string;
  count: number;
  measurements: RegistryMeasurement[];
  unresolvedLabels: UsageRef[];
}

const SOURCE_LABEL: Record<string, string> = {
  "quick-measurement": "Quick Measurements",
  "protocol-required": "Protocols",
  "knowledge-pack": "Knowledge Packs",
  "stored-measurement": "Stored (Assistant)",
  "viewer-measurement": "Viewer",
};

function rangeText(r?: { low?: number; high?: number; note?: string }, unit?: string): string {
  if (!r || (r.low === undefined && r.high === undefined)) return "—";
  const lo = r.low !== undefined ? `≥ ${r.low}` : "";
  const hi = r.high !== undefined ? `≤ ${r.high}` : "";
  return `${[lo, hi].filter(Boolean).join(" and ")} ${unit ?? ""}`.trim();
}

function MeasurementRow({ m }: { m: RegistryMeasurement }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1 font-mono text-xs font-semibold">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {m.id}
            {m.deprecated && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">deprecated</span>}
          </div>
        </td>
        <td className="px-2 py-1.5 text-sm">{m.displayName}</td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground">{m.modalities.join(", ")}</td>
        <td className="px-2 py-1.5 text-xs">{m.bodyRegion}</td>
        <td className="px-2 py-1.5 text-xs font-mono">{m.defaultUnit || "—"}</td>
        <td className="px-2 py-1.5 text-xs">{rangeText(m.normalRange, m.defaultUnit)}</td>
        <td className="px-2 py-1.5 text-xs text-center">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.usageCount > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {m.usageCount}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2 text-xs">
              <div>
                <p className="mb-1 text-muted-foreground">{m.description}</p>
                <p><span className="font-semibold">Canonical key:</span> <span className="font-mono">{m.canonicalKey}</span> · <span className="font-semibold">v{m.version}</span></p>
                <p className="mt-1"><span className="font-semibold">Aliases ({m.aliases.length}):</span> {m.aliases.join(" · ")}</p>
                <p className="mt-1"><span className="font-semibold">Units:</span> {m.allowedUnits.join(", ") || "—"} (default {m.defaultUnit || "—"}, precision {m.precision})</p>
                <p className="mt-1"><span className="font-semibold">Comparison:</span> {m.comparisonStrategy} · <span className="font-semibold">Viewer tool:</span> {m.viewerMapping.tool}</p>
                <p className="mt-1"><span className="font-semibold">Normal:</span> {rangeText(m.normalRange, m.defaultUnit)} {m.normalRange?.note && <span className="text-muted-foreground">({m.normalRange.note})</span>}</p>
                <p><span className="font-semibold">Critical:</span> {rangeText(m.criticalRange, m.defaultUnit)} {m.criticalRange?.note && <span className="text-muted-foreground">({m.criticalRange.note})</span>}</p>
                {m.phase4Rule && <p className="mt-1"><span className="font-semibold">Quality rule (Phase 4):</span> <span className="font-mono">{m.phase4Rule}</span></p>}
                {m.notes && <p className="mt-1 italic text-muted-foreground">{m.notes}</p>}
              </div>
              <div>
                <p className="font-semibold mb-1">Impact — used by {m.usageCount} live reference{m.usageCount === 1 ? "" : "s"}:</p>
                {m.usage.length === 0 ? (
                  <p className="text-muted-foreground">No live content references this measurement yet (code-level refs: {Object.entries(m.refs).filter(([, v]) => v?.length).map(([k, v]) => `${k}: ${v!.join(", ")}`).join(" · ") || "none"}).</p>
                ) : (
                  <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                    {m.usage.map((u, i) => (
                      <li key={i}>
                        <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">{SOURCE_LABEL[u.source] ?? u.source}</span>{" "}
                        <span className="font-mono">"{u.label}"</span> <span className="text-muted-foreground">in {u.context}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function MeasurementRegistryManager() {
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState<string>("all");

  const { data, isFetching, refetch } = useQuery<RegistryResponse>({
    queryKey: ["measurement-registry"],
    queryFn: () => api.get("/api/measurement-registry"),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const rows = data?.measurements ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (modality !== "all" && !m.modalities.includes(modality)) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.bodyRegion.toLowerCase().includes(q) ||
        m.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [data, search, modality]);

  const unresolved = data?.unresolvedLabels ?? [];

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Measurement Registry"
        subtitle={`Universal Measurement Platform — ${data?.count ?? "…"} canonical measurements, catalog v${data?.catalogVersion ?? "…"}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search id, name, alias, region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        {["all", "US", "CT", "MR", "XR"].map((mod) => (
          <Button key={mod} size="sm" variant={modality === mod ? "default" : "outline"} onClick={() => setModality(mod)}>
            {mod === "all" ? "All" : mod}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {unresolved.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> {unresolved.length} content label{unresolved.length === 1 ? "" : "s"} do not resolve to any canonical measurement:</p>
          <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
            {unresolved.map((u, i) => (
              <li key={i}><span className="font-mono">"{u.label}"</span> — {SOURCE_LABEL[u.source] ?? u.source} ({u.context})</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Add the spelling as an alias in <span className="font-mono">lib/measurements/src/catalog.ts</span>, or register a new measurement.</p>
        </div>
      ) : data ? (
        <div className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Every measurement label in live content resolves to a canonical identity.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Canonical ID</th>
              <th className="px-2 py-2">Display name</th>
              <th className="px-2 py-2">Modalities</th>
              <th className="px-2 py-2">Region</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Normal range</th>
              <th className="px-2 py-2 text-center">Used by</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => <MeasurementRow key={m.id} m={m} />)}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                {data ? "No measurements match the filter." : "Loading registry…"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
