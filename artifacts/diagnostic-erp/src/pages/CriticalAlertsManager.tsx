/**
 * Critical Finding Alert Engine — Phase 12
 * Brain bleed, midline shift, pneumothorax, cord compression, free air, stroke, PE.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, AlertOctagon, Bell, Clock, UserCheck, Send,
  HeartPulse, Brain, Wind, Bone, Droplets, Activity, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_ICONS: Record<string, any> = {
  brain_bleed: Brain,
  midline_shift: Activity,
  pneumothorax: Wind,
  cord_compression: Bone,
  free_air: Droplets,
  stroke: HeartPulse,
  pulmonary_embolism: Activity,
  acute_hemorrhage: Droplets,
};

const SEVERITY_COLORS = {
  critical: "bg-rose-500 text-white",
  urgent: "bg-amber-500 text-white",
  significant: "bg-blue-500 text-white",
};

export default function CriticalAlertsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, refetch } = useQuery<any>({
    queryKey: ["critical-alerts"],
    queryFn: () => api.get("/api/radiology-workflow/critical-alerts"),
    refetchInterval: 5000,
  });

  const ackMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/radiology-workflow/critical-alerts/${id}/acknowledge`, {}),
    onSuccess: () => { toast({ title: "Acknowledged" }); qc.invalidateQueries({ queryKey: ["critical-alerts"] }); },
  });

  const openFindings = data?.openFindings ?? [];
  const ackMetrics = data?.ackMetrics ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Critical Finding Alert Engine"
            subtitle="Escalation workflow for life-threatening radiological findings"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* TAT Metrics */}
        {ackMetrics.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 mb-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Time-to-Acknowledge by Category</h3>
            <div className="flex gap-4 flex-wrap">
              {ackMetrics.map((m: any) => (
                <div key={m.category} className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2">
                  <div className="text-[10px] uppercase text-slate-500">{m.category.replace(/_/g, " ")}</div>
                  <div className="text-lg font-bold text-slate-200">
                    {m.avg_seconds ? Math.round(Number(m.avg_seconds)) : "—"}s
                  </div>
                  <div className="text-[10px] text-slate-500">{m.count} alerts</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open Alerts */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
            <Bell className="w-4 h-4 text-rose-400" />
            <span className="text-sm font-semibold text-slate-200">Pending Critical Findings ({openFindings.length})</span>
          </div>
          <div className="divide-y divide-slate-800/60">
            {openFindings.map((f: any) => {
              const Icon = CATEGORY_ICONS[f.category] ?? AlertOctagon;
              return (
                <div key={f.id} className="p-4 flex items-start gap-4 hover:bg-slate-800/30">
                  <div className={`mt-0.5 p-2 rounded-lg ${f.severity === "critical" ? "bg-rose-500/15" : f.severity === "urgent" ? "bg-amber-500/15" : "bg-blue-500/15"}`}>
                    <Icon className={`w-5 h-5 ${f.severity === "critical" ? "text-rose-400" : f.severity === "urgent" ? "text-amber-400" : "text-blue-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SEVERITY_COLORS[f.severity as keyof typeof SEVERITY_COLORS] ?? "bg-slate-600 text-white"}`}>
                        {f.severity.toUpperCase()}
                      </span>
                      <Badge variant="outline" className="border-slate-700 text-slate-300 text-xs">{f.category?.replace(/_/g, " ") ?? "Critical"}</Badge>
                    </div>
                    <p className="text-sm text-slate-200 mt-1.5">{f.finding}</p>
                    <p className="text-xs text-slate-500 mt-1">Study #{f.studyId} · {f.createdAt ? new Date(f.createdAt).toLocaleString() : ""}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" onClick={() => ackMut.mutate(f.id)}>
                      <UserCheck className="w-3.5 h-3.5 mr-1" />
                      Ack
                    </Button>
                    <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10">
                      <Send className="w-3.5 h-3.5 mr-1" />
                      Notify
                    </Button>
                  </div>
                </div>
              );
            })}
            {openFindings.length === 0 && (
              <div className="px-4 py-12 text-center text-slate-500 flex flex-col items-center gap-2">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
                <span>No critical findings pending — all clear.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
