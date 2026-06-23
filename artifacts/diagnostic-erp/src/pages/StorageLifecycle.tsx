/**
 * PACS Storage Lifecycle Manager — Phase 12
 * SSD cache, NAS, Archive tiers. Auto-archive, compression, orphan detection.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Database, HardDrive, Archive, Trash2, AlertTriangle,
  TrendingUp, ArrowDownToLine, Gauge, Thermometer, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TIER_COLORS: Record<string, string> = {
  hot: "bg-emerald-500",
  warm: "bg-amber-500",
  cold: "bg-blue-500",
  archive: "bg-slate-500",
};

export default function StorageLifecycle() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, refetch } = useQuery<any>({
    queryKey: ["storage-lifecycle"],
    queryFn: () => api.get("/api/radiology-workflow/storage-lifecycle"),
    refetchInterval: 10000,
  });

  const tiers = data?.tiers ?? [];
  const summary = data?.summary ?? [];
  const growth = data?.growth ?? [];

  const totalSize = summary.reduce((acc: number, s: any) => acc + (s.totalSize ?? 0), 0);
  const totalCount = summary.reduce((acc: number, s: any) => acc + (s.count ?? 0), 0);
  const orphans = summary.reduce((acc: number, s: any) => acc + (s.orphans ?? 0), 0);
  const duplicates = summary.reduce((acc: number, s: any) => acc + (s.duplicates ?? 0), 0);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Storage Lifecycle Manager"
            subtitle="SSD, NAS, Archive tiers — auto-archive, compression, orphan cleanup"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Studies" value={totalCount} icon={<HardDrive className="w-5 h-5 text-slate-400" />} />
          <StatCard label="Total Size" value={`${Math.round((totalSize ?? 0) / 1024 / 1024 / 1024)} GB`} icon={<Database className="w-5 h-5 text-emerald-400" />} />
          <StatCard label="Orphans" value={orphans} icon={<AlertTriangle className="w-5 h-5 text-amber-400" />} tint={orphans > 0 ? "text-amber-400" : "text-slate-400"} />
          <StatCard label="Duplicates" value={duplicates} icon={<Trash2 className="w-5 h-5 text-rose-400" />} tint={duplicates > 0 ? "text-rose-400" : "text-slate-400"} />
        </div>

        {/* Tier Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Tier Distribution</h3>
            <div className="space-y-3">
              {summary.map((s: any) => (
                <div key={s.tier}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400 capitalize">{s.tier}</span>
                    <span className="text-slate-300">{s.count} studies · {Math.round((s.totalSize ?? 0) / 1024 / 1024)} MB</span>
                  </div>
                  <div className="h-2 rounded bg-slate-800 overflow-hidden">
                    <div className={`h-full rounded ${TIER_COLORS[s.tier] ?? "bg-slate-600"}`} style={{ width: `${totalCount > 0 ? Math.round((s.count / totalCount) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modality Growth */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">30-Day Growth by Modality</h3>
            <div className="space-y-2">
              {growth.map((g: any) => (
                <div key={g.modality} className="flex items-center justify-between text-sm">
                  <Badge variant="outline" className="border-slate-700 text-slate-300">{g.modality}</Badge>
                  <span className="text-slate-300">+{g.studiesAdded} studies</span>
                  <span className="text-slate-500">{Math.round((g.sizeAdded ?? 0) / 1024 / 1024)} MB</span>
                </div>
              ))}
              {growth.length === 0 && <span className="text-slate-500 text-sm">No growth data</span>}
            </div>
          </div>
        </div>

        {/* Tier Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
            <Archive className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-200">Recent Tier Migrations</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 text-left">
                <th className="px-4 py-3">Study ID</th>
                <th className="px-4 py-3">Modality</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Previous</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Compression</th>
                <th className="px-4 py-3">Orphan</th>
                <th className="px-4 py-3">Duplicate</th>
                <th className="px-4 py-3">Last Access</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t: any) => (
                <tr key={t.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-300">{t.studyId}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="border-slate-700 text-slate-300">{t.modality}</Badge></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${TIER_COLORS[t.currentTier] ?? "bg-slate-600"}`}>
                      {t.currentTier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{t.previousTier || "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{t.sizeBytes ? `${Math.round(t.sizeBytes / 1024 / 1024)} MB` : "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{t.compressionRatio ? `${t.compressionRatio}%` : "—"}</td>
                  <td className="px-4 py-3">{t.isOrphan ? <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Yes</Badge> : <span className="text-slate-500">No</span>}</td>
                  <td className="px-4 py-3">{t.isDuplicate ? <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">Yes</Badge> : <span className="text-slate-500">No</span>}</td>
                  <td className="px-4 py-3 text-slate-400">{t.lastAccessedAt ? new Date(t.lastAccessedAt).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
              {tiers.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">No tier migration data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, tint }: any) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div className={tint ?? "text-slate-400"}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
    </div>
  );
}
