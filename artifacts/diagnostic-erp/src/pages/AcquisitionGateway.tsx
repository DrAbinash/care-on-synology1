/**
 * Acquisition Gateway — Phase 12
 * Track incoming DICOM studies, AE title mismatches, duplicates, quarantine, reprocess.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { MobileTableScroll } from "@/components/MobileTableScroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, HardDrive, AlertTriangle, CheckCircle2, RotateCcw,
  ShieldAlert, Filter, Download, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  receiving: "bg-blue-500",
  complete: "bg-emerald-500",
  failed: "bg-rose-500",
  quarantined: "bg-amber-500",
  reprocessed: "bg-violet-500",
  incomplete: "bg-orange-500",
};

const STATUS_LABELS: Record<string, string> = {
  receiving: "Receiving",
  complete: "Complete",
  failed: "Failed",
  quarantined: "Quarantined",
  reprocessed: "Reprocessed",
  incomplete: "Incomplete",
};

export default function AcquisitionGateway() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterModality, setFilterModality] = useState<string>("");

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["incoming-studies", filterStatus, filterModality],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterModality) params.set("modality", filterModality);
      return api.get(`/api/radiology-workflow/incoming?${params.toString()}`);
    },
    refetchInterval: 3000,
  });

  const quarantineMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/radiology-workflow/incoming/${id}/quarantine`, { reason: "manual" }),
    onSuccess: () => { toast({ title: "Quarantined" }); qc.invalidateQueries({ queryKey: ["incoming-studies"] }); },
  });

  const reprocessMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/radiology-workflow/incoming/${id}/reprocess`, {}),
    onSuccess: () => { toast({ title: "Reprocessing started" }); qc.invalidateQueries({ queryKey: ["incoming-studies"] }); },
  });

  const studies = data?.studies ?? [];
  const byModality = data?.byModality ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Acquisition Gateway"
            subtitle="Track incoming DICOM studies from all modalities"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Modality Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {byModality.map((m: any) => (
            <div key={m.modality} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
              <div className="text-xs font-bold text-slate-300">{m.modality}</div>
              <div className="text-lg font-bold text-slate-100 mt-1">{m.total}</div>
              <div className="text-[10px] text-slate-500">
                {m.receiving} recv · {m.complete} done · {m.failed} fail
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <Input
            placeholder="Filter by modality (CT, MR, US...)"
            value={filterModality}
            onChange={(e) => setFilterModality(e.target.value)}
            className="w-48 bg-slate-900 border-slate-700 text-slate-200"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200"
          >
            <option value="">All Status</option>
            <option value="receiving">Receiving</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
            <option value="quarantined">Quarantined</option>
          </select>
        </div>

        {/* Study Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden min-w-0 max-w-full">
          <MobileTableScroll>
          <table className="w-full text-sm min-w-[48rem]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 text-left">
                <th className="px-4 py-3 font-medium">Modality</th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Accession</th>
                <th className="px-4 py-3 font-medium">AE Title</th>
                <th className="px-4 py-3 font-medium">Images</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Alerts</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s: any) => (
                <tr key={s.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-slate-700 text-slate-300">{s.modality}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-200">{s.patientName || "Unknown"}</td>
                  <td className="px-4 py-3 text-slate-400">{s.accessionNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{s.aeTitle || "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{s.imageCount}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${STATUS_COLORS[s.transferStatus] ?? "bg-slate-600"}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
                      {STATUS_LABELS[s.transferStatus] ?? s.transferStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {s.aeMismatch && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">AE Mismatch</Badge>}
                      {s.duplicateStudy && <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">Duplicate</Badge>}
                      {s.incompleteStudy && <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Incomplete</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {s.transferStatus !== "quarantined" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10" onClick={() => quarantineMut.mutate(s.id)}>
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10" onClick={() => reprocessMut.mutate(s.id)}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {studies.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No incoming studies matching filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </MobileTableScroll>
        </div>
      </div>
    </div>
  );
}
