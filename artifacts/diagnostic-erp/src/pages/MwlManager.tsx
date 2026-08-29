/**
 * DICOM Modality Worklist Manager — Phase 12
 * Generate MWL entries, track status, detect duplicates, resend MWL.
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
  RefreshCw, ListChecks, Send, AlertTriangle, RotateCcw, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-500",
  arrived: "bg-teal-500",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
  reported: "bg-violet-500",
  cancelled: "bg-slate-500",
};

export default function MwlManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("");
  const [filterModality, setFilterModality] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["mwl-entries", filterStatus, filterModality, filterDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterModality) params.set("modality", filterModality);
      if (filterDate) params.set("date", filterDate);
      return api.get(`/api/radiology-workflow/mwl?${params.toString()}`);
    },
    refetchInterval: 5000,
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/api/radiology-workflow/mwl/${id}/status`, { status }),
    onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: ["mwl-entries"] }); },
  });

  const resendMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/radiology-workflow/mwl/${id}/resend`, {}),
    onSuccess: () => { toast({ title: "MWL resent" }); qc.invalidateQueries({ queryKey: ["mwl-entries"] }); },
  });

  const entries = data?.entries ?? [];
  const duplicates = data?.duplicates ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Modality Worklist Manager"
            subtitle="Generate MWL entries, track status, detect duplicates"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Duplicate Alert Banner */}
        {duplicates.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-4 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-300">
              {duplicates.length} duplicate accession number(s) detected
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200">
            <option value="">All Status</option>
            <option value="scheduled">Scheduled</option>
            <option value="arrived">Arrived</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="reported">Reported</option>
          </select>
          <Input placeholder="Modality" value={filterModality} onChange={(e) => setFilterModality(e.target.value)} className="w-32 bg-slate-900 border-slate-700 text-slate-200" />
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-40 bg-slate-900 border-slate-700 text-slate-200" />
        </div>

        {/* MWL Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden min-w-0 max-w-full">
          <MobileTableScroll>
          <table className="w-full text-sm min-w-[48rem]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 text-left">
                <th className="px-4 py-3">Accession</th>
                <th className="px-4 py-3">Modality</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">AE Title</th>
                <th className="px-4 py-3">Body Part</th>
                <th className="px-4 py-3">Referring Dr</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-mono text-slate-300">{e.accessionNumber}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="border-slate-700 text-slate-300">{e.modality}</Badge></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${e.priority === "stat" ? "text-rose-400" : e.priority === "urgent" ? "text-amber-400" : "text-slate-400"}`}>
                      {e.priority.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${STATUS_COLORS[e.status] ?? "bg-slate-600"}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{e.scheduledAETitle || "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{e.bodyPart || "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{e.referringDoctor || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10" onClick={() => resendMut.mutate(e.id)}>
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                      <select
                        value=""
                        onChange={(ev) => {
                          const status = ev.target.value;
                          if (status) statusMut.mutate({ id: e.id, status });
                        }}
                        className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="">Set Status</option>
                        <option value="arrived">Arrived</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="reported">Reported</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No MWL entries</td></tr>
              )}
            </tbody>
          </table>
          </MobileTableScroll>
        </div>
      </div>
    </div>
  );
}
