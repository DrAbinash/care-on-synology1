import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, TrendingUp, Clock, CheckCircle2, FileText, AlertTriangle,
  ChevronRight, BarChart3, Users, Layers, ArrowLeft, Loader2,
} from "lucide-react";

interface DashboardData {
  windowDays: number;
  today: {
    draftsCreated: number;
    verified: number;
    finalized: number;
    amended: number;
  };
  window: {
    drafts: number;
    pending: number;
    verified: number;
    finalized: number;
    amended: number;
    archived: number;
    total: number;
  };
  measurements: {
    approved: number;
    pending: number;
    rejected: number;
  };
  doppler: {
    approved: number;
    pending: number;
  };
  criticalAlertsPending: number;
  avgTatMinutes: number | null;
}

interface RadiologistStat {
  name: string;
  finalizedCount: number;
  amendedCount: number;
  openCount: number;
  avgTatMinutes: number | null;
}

interface TemplateStat {
  templateType: string;
  total: number;
  finalized: number;
  amended: number;
  verified: number;
  draft: number;
  amendmentRate: number;
}

export default function UsgAnalytics() {
  const [, navigate] = useLocation();

  const { data: dashboard, isLoading: dLoading } = useQuery<DashboardData>({
    queryKey: ["usg-analytics-dashboard"],
    queryFn: () => fetchApi("/api/usg-analytics/dashboard?days=7"),
    staleTime: 60_000,
  });

  const { data: byRad, isLoading: rLoading } = useQuery<{ radiologists: RadiologistStat[] }>({
    queryKey: ["usg-analytics-by-radiologist"],
    queryFn: () => fetchApi("/api/usg-analytics/by-radiologist?days=7"),
    staleTime: 60_000,
  });

  const { data: byTpl, isLoading: tLoading } = useQuery<{ templates: TemplateStat[] }>({
    queryKey: ["usg-analytics-by-template"],
    queryFn: () => fetchApi("/api/usg-analytics/by-template?days=7"),
    staleTime: 60_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Analytics"
        subtitle="Workforce productivity, turnaround time, template usage, and quality metrics for ultrasound & Doppler reporting."
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={FileText} label="Finalized" value={dashboard?.window.finalized ?? 0} accent="text-emerald-600" bg="bg-emerald-50 dark:bg-emerald-950/20" />
        <KpiCard icon={Layers} label="Drafts" value={dashboard?.window.drafts ?? 0} accent="text-amber-600" bg="bg-amber-50 dark:bg-amber-950/20" />
        <KpiCard icon={Clock} label="Avg TAT" value={dashboard?.avgTatMinutes == null ? "\u2014" : `${dashboard.avgTatMinutes} min`} accent="text-violet-600" bg="bg-violet-50 dark:bg-violet-950/20" />
        <KpiCard icon={AlertTriangle} label="Critical Alerts" value={dashboard?.criticalAlertsPending ?? 0} accent="text-red-600" bg="bg-red-50 dark:bg-red-950/20" />
      </div>

      {/* Measurements + Doppler strip */}
      {dashboard && (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {dashboard.measurements.approved} measurements approved
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
            <Activity className="h-3.5 w-3.5" />
            {dashboard.doppler.approved} Doppler approved
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
            <TrendingUp className="h-3.5 w-3.5" />
            {dashboard.measurements.pending} measurements pending
          </div>
        </div>
      )}

      {/* Radiologist breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> By Radiologist (7d)
          </CardTitle>
          <CardDescription className="text-xs">Finalized, open, and average turnaround time per radiologist.</CardDescription>
        </CardHeader>
        <CardContent>
          {rLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading\u2026</div>}
          {!rLoading && byRad?.radiologists.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No finalized reports in the last 7 days.</p>
          )}
          <div className="space-y-2">
            {byRad?.radiologists.map((r) => (
              <div key={r.name} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="text-xs">
                  <span className="font-semibold">{r.name}</span>
                  <div className="text-muted-foreground mt-0.5">
                    {r.finalizedCount} finalized \u00b7 {r.openCount} open
                    {r.amendedCount > 0 && ` \u00b7 ${r.amendedCount} amended`}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  TAT {r.avgTatMinutes == null ? "\u2014" : `${r.avgTatMinutes} min`}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Template usage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Template Usage (7d)
          </CardTitle>
          <CardDescription className="text-xs">Per-template totals and amendment rate (higher = more corrections needed).</CardDescription>
        </CardHeader>
        <CardContent>
          {tLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading\u2026</div>}
          {!tLoading && byTpl?.templates.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No reports in the last 7 days.</p>
          )}
          <div className="space-y-2">
            {byTpl?.templates.map((t) => (
              <div key={t.templateType} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="text-xs">
                  <span className="font-semibold">{t.templateType}</span>
                  <div className="text-muted-foreground mt-0.5">
                    {t.total} total \u00b7 {t.finalized} finalized \u00b7 {t.verified} verified
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {t.amended > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t.amendmentRate}% amended
                    </Badge>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent, bg }: {
  icon: React.ElementType; label: string; value: string | number;
  accent: string; bg: string;
}) {
  return (
    <div className={`rounded-xl border border-border/60 p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
