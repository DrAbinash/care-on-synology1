import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, TrendingUp, TrendingDown } from "lucide-react";

type Cycle = { id: number; label: string; status: string };
type StaffRow = { id: number; firstName: string; lastName: string; staffId: string };
type AppliedEvent = { id?: number | string; category: string; points: number; disqualifying: boolean; date?: string; label?: string };
type CategoryBreakdown = { key: string; label: string; strategy: string; maxMarks: number; baseline: number; eventDelta: number; score: number; appliedEvents: AppliedEvent[] };
type ScoreResult = { total: number; maxTotal: number; categories: CategoryBreakdown[]; disqualified: boolean; disqualifyingEvents: AppliedEvent[]; unapplied: unknown[] };

function gradeLabel(total: number, max: number): string {
  const pct = max ? (total / max) * 100 : 0;
  if (pct >= 90) return "Exceptional";
  if (pct >= 85) return "Excellent";
  if (pct >= 75) return "Good";
  if (pct >= 65) return "Fair";
  if (pct >= 55) return "Needs improvement";
  return "At risk";
}

export default function PerformancePage() {
  const [cycleId, setCycleId] = useState<string>("");
  const [staffId, setStaffId] = useState<string>("");

  const { data: cycles = [] } = useQuery({ queryKey: ["perf-cycles"], queryFn: () => api.get<Cycle[]>("/api/performance/cycles"), retry: false });
  const { data: staff = [] } = useQuery({ queryKey: ["perf-staff"], queryFn: () => api.get<StaffRow[]>("/api/staff?active=true") });

  const ready = cycleId && staffId;
  const { data: score, isLoading, error } = useQuery({
    queryKey: ["perf-score", cycleId, staffId],
    queryFn: () => api.get<ScoreResult>(`/api/performance/cycles/${cycleId}/staff/${staffId}/score`),
    enabled: !!ready, retry: false,
  });

  const shadow = error && ((error as Error).message.includes("disabled") || (error as Error).message.includes("503"));

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Performance" subtitle="Explainable monthly scorecard — every point is itemised" />

      <Card>
        <CardContent className="flex flex-wrap gap-3 py-4">
          <Select value={cycleId} onValueChange={setCycleId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select cycle" /></SelectTrigger>
            <SelectContent>{cycles.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.label} · {c.status}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select staff member" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {shadow && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm"><p className="font-medium">Shadow Mode</p><p className="text-muted-foreground">Enable <code>ff_hr_performance_scoring</code> to compute scores.</p></div>
          </CardContent>
        </Card>
      )}

      {ready && isLoading && <Skeleton className="h-64 w-full" />}

      {score && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Total */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-base">Monthly score</CardTitle></CardHeader>
            <CardContent className="text-center py-6">
              <div className="text-5xl font-bold tabular-nums">{score.total}<span className="text-xl text-muted-foreground">/{score.maxTotal}</span></div>
              <Badge className="mt-3" variant={score.disqualified ? "destructive" : "default"}>{score.disqualified ? "Disqualified for awards" : gradeLabel(score.total, score.maxTotal)}</Badge>
              <Progress value={score.maxTotal ? (score.total / score.maxTotal) * 100 : 0} className="mt-4" />
            </CardContent>
          </Card>

          {/* Category breakdown */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Category breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {score.categories.map((c) => (
                <div key={c.key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-1.5">{c.label}<Badge variant="outline" className="text-[10px]">{c.strategy}</Badge></span>
                    <span className="tabular-nums font-medium">{c.score}/{c.maxMarks}</span>
                  </div>
                  <Progress value={c.maxMarks ? (c.score / c.maxMarks) * 100 : 0} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Itemised events */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2"><CardTitle className="text-base">How this score was calculated</CardTitle></CardHeader>
            <CardContent>
              {score.categories.every((c) => c.appliedEvents.length === 0) ? (
                <p className="text-sm text-muted-foreground">Baseline score — no approved events applied this cycle.</p>
              ) : (
                <div className="divide-y">
                  {score.categories.flatMap((c) => c.appliedEvents.map((e, i) => (
                    <div key={`${c.key}-${i}`} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium">{e.label || e.category}</span>
                        {e.disqualifying && <Badge variant="destructive" className="ml-2 text-[10px]">disqualifying</Badge>}
                        <div className="text-xs text-muted-foreground">{c.label}{e.date ? ` · ${e.date}` : ""}</div>
                      </div>
                      <span className={`tabular-nums font-semibold flex items-center gap-1 ${e.points < 0 ? "text-red-600" : "text-green-600"}`}>
                        {e.points < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                        {e.points > 0 ? `+${e.points}` : e.points}
                      </span>
                    </div>
                  )))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
