import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertTriangle, Clock, FileCheck, BrainCircuit, ShieldAlert, AlertCircle } from "lucide-react";

interface CommandCenterData {
  today: string;
  dailyVolume: number;
  aiUsageToday: number;
  pendingPeerReview: number;
  openAnomalies: number;
  pendingCriticalFindings: number;
  failedQualityGates: number;
  avgTurnaroundMinutes: number;
}

export default function CommandCenter() {
  const { data, isLoading } = useQuery({
    queryKey: ["commandCenter"],
    queryFn: async () => {
      return await api.get<CommandCenterData>("/api/ai-reporting/command-center");
    },
  });

  const cards = [
    { label: "Daily Volume", value: data?.dailyVolume ?? 0, icon: Activity, color: "text-blue-500" },
    { label: "AI Usage Today", value: data?.aiUsageToday ?? 0, icon: BrainCircuit, color: "text-purple-500" },
    { label: "Avg TAT (min)", value: data?.avgTurnaroundMinutes ?? 0, icon: Clock, color: "text-green-500" },
    { label: "Pending Peer Review", value: data?.pendingPeerReview ?? 0, icon: FileCheck, color: "text-orange-500" },
    { label: "Open Anomalies", value: data?.openAnomalies ?? 0, icon: ShieldAlert, color: "text-yellow-500" },
    { label: "Pending Critical", value: data?.pendingCriticalFindings ?? 0, icon: AlertCircle, color: "text-red-500" },
    { label: "Failed Quality Gates", value: data?.failedQualityGates ?? 0, icon: AlertTriangle, color: "text-red-500" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Radiology Command Center" subtitle="Phase 23 — Consolidated KPI dashboard: daily volume, TAT, AI usage, quality scores, anomalies, peer review backlog." />
      {isLoading && <div className="text-muted-foreground">Loading KPIs…</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <Icon className={`w-8 h-8 ${c.color}`} />
                <div>
                  <div className="text-2xl font-bold">{c.value}</div>
                  <div className="text-sm text-muted-foreground">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="text-sm text-muted-foreground">
        Data for: {data?.today ? new Date(data.today).toLocaleDateString() : "—"}
      </div>
    </div>
  );
}
