import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, ThumbsUp, ThumbsDown, MessageSquare,
  CalendarDays, RefreshCw,
} from "lucide-react";

interface QualityScoreData {
  scope: string;
  dateFrom: string;
  dateTo: string;
  overall: {
    totalDrafts: number;
    totalWithFeedback: number;
    helpfulCount: number;
    needsImprovementCount: number;
    inaccurateCount: number;
    qualityScore: number;
    helpfulRate: number;
  };
  byModality: Array<{
    modality: string;
    totalWithFeedback: number;
    helpfulCount: number;
    needsImprovementCount: number;
    inaccurateCount: number;
    qualityScore: number;
    helpfulRate: number;
  }>;
}

const PIE_COLORS = ["#22c55e", "#f59e0b", "#ef4444"];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AiQualityScores() {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, isError, refetch } = useQuery<QualityScoreData>({
    queryKey: ["ai-quality-scores", from, to],
    queryFn: async () => {
      const qs = new URLSearchParams({ from, to, scope: "overall" });
      return api.get(`/api/ai-reporting/quality-scores?${qs.toString()}`);
    },
  });

  const pieData = data?.overall
    ? [
        { name: "Helpful", value: data.overall.helpfulCount, color: PIE_COLORS[0] },
        { name: "Needs Improvement", value: data.overall.needsImprovementCount, color: PIE_COLORS[1] },
        { name: "Inaccurate", value: data.overall.inaccurateCount, color: PIE_COLORS[2] },
      ].filter((d) => d.value > 0)
    : [];

  const barData = data?.byModality ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="AI Quality Scores"
        subtitle="Phase 5: Measure AI draft accuracy against radiologist feedback"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 h-8 text-xs" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 h-8 text-xs" />
            <Button variant="outline" size="sm" className="gap-1" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="h-4 w-4" /> Failed to load quality scores.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Top metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Quality Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{data.overall.qualityScore.toFixed(0)}</span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <Progress value={data.overall.qualityScore} className="mt-2 h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {data.overall.qualityScore >= 80 ? "Excellent" : data.overall.qualityScore >= 60 ? "Good" : "Needs Improvement"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Drafts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{data.overall.totalDrafts}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.overall.totalWithFeedback} with feedback
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Helpful Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-green-600">{data.overall.helpfulRate.toFixed(1)}%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.overall.helpfulCount} thumbs up
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Feedback Coverage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">
                    {data.overall.totalDrafts > 0
                      ? ((data.overall.totalWithFeedback / data.overall.totalDrafts) * 100).toFixed(1)
                      : "0"}
                  </span>
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <Progress
                  value={data.overall.totalDrafts > 0 ? (data.overall.totalWithFeedback / data.overall.totalDrafts) * 100 : 0}
                  className="mt-2 h-2"
                />
              </CardContent>
            </Card>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Quality by Modality
                </CardTitle>
              </CardHeader>
              <CardContent>
                {barData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="modality" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="qualityScore" name="Quality Score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No modality data for this period</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <PieChart className="h-4 w-4" /> Feedback Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                        {pieData.map((entry, index) => (
                          <Cell key={entry.name} fill={PIE_COLORS[index]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No feedback data for this period</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Modality breakdown table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Modality Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Modality</th>
                      <th className="px-3 py-2 text-right font-medium">Drafts</th>
                      <th className="px-3 py-2 text-right font-medium">Helpful</th>
                      <th className="px-3 py-2 text-right font-medium">Needs Work</th>
                      <th className="px-3 py-2 text-right font-medium">Inaccurate</th>
                      <th className="px-3 py-2 text-right font-medium">Quality Score</th>
                      <th className="px-3 py-2 text-right font-medium">Helpful Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {barData.map((m) => (
                      <tr key={m.modality}>
                        <td className="px-3 py-2 font-medium">{m.modality}</td>
                        <td className="px-3 py-2 text-right">{m.totalWithFeedback}</td>
                        <td className="px-3 py-2 text-right text-green-600">{m.helpfulCount}</td>
                        <td className="px-3 py-2 text-right text-amber-600">{m.needsImprovementCount}</td>
                        <td className="px-3 py-2 text-right text-red-600">{m.inaccurateCount}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          <Badge variant={m.qualityScore >= 80 ? "default" : m.qualityScore >= 60 ? "secondary" : "destructive"}>
                            {m.qualityScore}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">{m.helpfulRate}%</td>
                      </tr>
                    ))}
                    {barData.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                          No data for the selected period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Footer note */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold">How it works: </span>
              Quality Score = (Helpful × 100 + Needs Improvement × 50) / Total Feedback. Inaccurate counts as 0.
              Higher scores mean radiologists found the AI draft more useful.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
