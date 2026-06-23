import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Archive, RefreshCw, HardDrive, Cloud, Database, ArrowDownToLine,
  Flame, Thermometer, Snowflake, Search, FileStack, Layers, AlertTriangle,
  CheckCircle2, Clock, X,
} from "lucide-react";

interface ArchiveEntry {
  id: number;
  studyInstanceUID: string;
  accessionNumber: string | null;
  modality: string | null;
  patientId: number | null;
  originalSizeBytes: string | null;
  compressedSizeBytes: string | null;
  compressionRatio: string | null;
  compressionMethod: string | null;
  tier: string;
  lastAccessedAt: string | null;
  movedToTierAt: string | null;
  scheduledForArchiveAt: string | null;
  archivedAt: string | null;
  restoredAt: string | null;
  restoreCount: number;
  autoCompressed: boolean;
  retentionDays: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TierCount {
  tier: string;
  count: number;
}

const TIER_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; desc: string }> = {
  hot:    { label: "Hot (SSD)",    icon: <Flame className="h-4 w-4" />,    color: "text-orange-700",    bg: "bg-orange-50 border-orange-200",    desc: "Frequently accessed, uncompressed" },
  warm:   { label: "Warm (Compressed)", icon: <Thermometer className="h-4 w-4" />, color: "text-amber-700",    bg: "bg-amber-50 border-amber-200",    desc: "JPEG2000 compressed, local storage" },
  cold:   { label: "Cold (Nearline)",   icon: <Snowflake className="h-4 w-4" />,  color: "text-slate-700",    bg: "bg-slate-50 border-slate-200",    desc: "Network-attached, slower retrieval" },
  archived: { label: "Archived",        icon: <Archive className="h-4 w-4" />,     color: "text-emerald-700",  bg: "bg-emerald-50 border-emerald-200", desc: "Off-site / tape / long-term" },
};

function fmtBytes(bytes: string | number | null): string {
  if (!bytes) return "\u2014";
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (isNaN(n) || n <= 0) return "\u2014";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "\u2014";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function TierBadge({ tier }: { tier: string }) {
  const cfg = TIER_META[tier] ?? { label: tier, color: "text-gray-700", bg: "bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

export function ArchiveLifecyclePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const { data, isLoading, refetch } = useQuery<{
    studies: ArchiveEntry[];
    tierCounts: TierCount[];
  }>({
    queryKey: ["pacs-archive-lifecycle", tierFilter, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tierFilter !== "all") params.set("tier", tierFilter);
      params.set("limit", String(limit));
      return api.get(`/api/radiology/archive-lifecycle?${params}`);
    },
    refetchInterval: 60_000,
  });

  const entries = data?.studies ?? [];
  const tierCounts = data?.tierCounts ?? [];

  const compressMutation = useMutation({
    mutationFn: async (id: number) => api.post(`/api/radiology/archive-lifecycle/${id}/compress`, {}),
    onSuccess: () => { toast({ title: "Compression queued" }); void qc.invalidateQueries({ queryKey: ["pacs-archive-lifecycle"] }); },
    onError: (err) => { toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" }); },
  });

  const moveTierMutation = useMutation({
    mutationFn: async ({ id, tier }: { id: number; tier: string }) => api.post(`/api/radiology/archive-lifecycle/${id}/move-tier`, { tier }),
    onSuccess: () => { toast({ title: "Tier moved" }); void qc.invalidateQueries({ queryKey: ["pacs-archive-lifecycle"] }); },
    onError: (err) => { toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" }); },
  });

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.accessionNumber ?? "").toLowerCase().includes(s) ||
      e.studyInstanceUID.toLowerCase().includes(s) ||
      (e.modality ?? "").toLowerCase().includes(s) ||
      (e.notes ?? "").toLowerCase().includes(s)
    );
  });

  const totalOriginal = entries.reduce((s, e) => s + Number(e.originalSizeBytes ?? 0), 0);
  const totalCompressed = entries.reduce((s, e) => s + Number(e.compressedSizeBytes ?? 0), 0);
  const totalSavings = totalOriginal - totalCompressed;
  const savingsPct = totalOriginal > 0 ? Math.round((totalSavings / totalOriginal) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Storage summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Database className="h-3 w-3" /> Total Studies</span>
          <span className="text-xl font-bold">{entries.length}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" /> Original Size</span>
          <span className="text-xl font-bold">{fmtBytes(totalOriginal)}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="h-3 w-3" /> Compressed</span>
          <span className="text-xl font-bold">{fmtBytes(totalCompressed)}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" /> Saved</span>
          <span className="text-xl font-bold text-emerald-700">{fmtBytes(totalSavings)} ({savingsPct}%)</span>
        </div>
      </div>

      {/* Tier distribution */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(TIER_META).map(([key, cfg]) => {
          const count = tierCounts.find((t) => t.tier === key)?.count ?? 0;
          return (
            <button
              key={key}
              onClick={() => setTierFilter(tierFilter === key ? "all" : key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border cursor-pointer transition-opacity ${cfg.bg} ${cfg.color} ${tierFilter === key ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-75 hover:opacity-100"}`}
              title={cfg.desc as string}
            >
              {cfg.icon} {cfg.label} <Badge variant="secondary" className="ml-1 text-xs">{count}</Badge>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search accession, UID, modality..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Limit" />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((l) => <SelectItem key={l} value={String(l)}>{l} rows</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Archive className="h-12 w-12" />
          <p className="text-base font-semibold">No archive entries yet</p>
          <p className="text-sm max-w-md text-center">Studies will appear here once the archive lifecycle background job processes them.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Accession</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Modality</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Tier</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Original</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Compressed</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Ratio</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Method</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Last Access</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Restores</th>
                <th className="px-3 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{e.accessionNumber ?? e.studyInstanceUID.slice(0, 16)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><Badge variant="outline" className="font-mono text-xs">{e.modality ?? "OT"}</Badge></td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><TierBadge tier={e.tier} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{fmtBytes(e.originalSizeBytes)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{fmtBytes(e.compressedSizeBytes)}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {e.compressionRatio ? <span className="text-emerald-700 font-medium">{e.compressionRatio}x</span> : "\u2014"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{e.compressionMethod ?? "\u2014"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(e.lastAccessedAt)}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{e.restoreCount}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {!e.autoCompressed && (e.tier === "hot" || e.tier === "warm") && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => compressMutation.mutate(e.id)} disabled={compressMutation.isPending}>
                          <Layers className="h-3 w-3 mr-1" /> Compress
                        </Button>
                      )}
                      {e.tier === "hot" && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => moveTierMutation.mutate({ id: e.id, tier: "warm" })} disabled={moveTierMutation.isPending}>
                          <Thermometer className="h-3 w-3 mr-1" /> Warm
                        </Button>
                      )}
                      {e.tier === "warm" && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => moveTierMutation.mutate({ id: e.id, tier: "cold" })} disabled={moveTierMutation.isPending}>
                          <Snowflake className="h-3 w-3 mr-1" /> Cold
                        </Button>
                      )}
                      {(e.tier === "cold" || e.tier === "archived") && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => moveTierMutation.mutate({ id: e.id, tier: "hot" })} disabled={moveTierMutation.isPending}>
                          <Flame className="h-3 w-3 mr-1" /> Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-muted-foreground text-right">{filtered.length} of {entries.length} entries</div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">Lifecycle Policies: </span>
          Studies move from Hot → Warm after 7 days of inactivity, Warm → Cold after 30 days, and Cold → Archived after 90 days.
          Background cron jobs run nightly. Manual tier changes via this page bypass the scheduled policy.
        </div>
      </div>
    </div>
  );
}

export default function PacsArchiveLifecycle() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Archive Lifecycle" subtitle="Study compression and tiered storage management" />
      <ArchiveLifecyclePanel />
    </div>
  );
}
