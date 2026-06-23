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
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, AlertTriangle, RefreshCw, Trophy, ThumbsUp, ThumbsDown,
  MessageSquare, CalendarDays,
} from "lucide-react";

interface TemplateStats {
  templateName: string;
  modality: string | null;
  totalDrafts: number;
  totalWithFeedback: number;
  helpfulCount: number;
  needsImprovementCount: number;
  inaccurateCount: number;
  qualityScore: number;
  helpfulRate: number;
}

interface EffectivenessData {
  dateFrom: string;
  dateTo: string;
  modality: string | null;
  templates: TemplateStats[];
}

const MODALITIES = ["MR", "CT", "US", "CR", "OT", "all"];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AiPromptEffectiveness() {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [modality, setModality] = useState("all");

  const { data, isLoading, isError, refetch } = useQuery<EffectivenessData>({
    queryKey: ["ai-prompt-effectiveness", from, to, modality],
    queryFn: async () => {
      const qs = new URLSearchParams({ from, to });
      if (modality !== "all") qs.append("modality", modality);
      return api.get(`/api/ai-reporting/prompt-effectiveness?${qs.toString()}`);
    },
  });

  const barData = data?.templates ?? [];
  const topTemplate = data?.templates[0];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="AI Prompt Effectiveness"
        subtitle="Phase 6: Which prompt templates produce the best radiologist feedback?"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 h-8 text-xs" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 h-8 text-xs" />
            <select
              value={modality}
              onChange={(e) => setModality(e.target.value)}
              className="h-8 text-xs rounded border px-2 bg-background"
            >
              {MODALITIES.map((m) => (
                <option key={m} value={m}>{m === "all" ? "All Modalities" : m}</option>
              ))}
            </select>
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
          <AlertTriangle className="h-4 w-4" /> Failed to load prompt effectiveness data.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Top performer */}
          {topTemplate && (
            <Card className="border-green-200 bg-green-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-700">
                  <Trophy className="h-4 w-4" /> Top Performing Template
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-lg">{topTemplate.templateName}</p>
                    <p className="text-sm text-muted-foreground">
                      {topTemplate.modality} · {topTemplate.totalWithFeedback} feedback · {topTemplate.helpfulRate}% helpful
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-bold text-green-700">{topTemplate.qualityScore}</span>
                    <span className="text-sm text-muted-foreground">/100</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Quality Score by Template
              </CardTitle>
            </CardHeader>
            <CardContent>
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="templateName" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={80} />
                    <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="qualityScore" name="Quality Score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">No template data for this period</p>
              )}
            </CardContent>
          </Card>

          {/* Leaderboard table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Trophy className="h-4 w-4" /> Template Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Template</th>
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
                    {barData.map((t, i) => (
                      <tr key={t.templateName}>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{t.templateName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.modality ?? "\u2014"}</td>
                        <td className="px-3 py-2 text-right">{t.totalDrafts}</td>
                        <td className="px-3 py-2 text-right text-green-600">{t.helpfulCount}</td>
                        <td className="px-3 py-2 text-right text-amber-600">{t.needsImprovementCount}</td>
                        <td className="px-3 py-2 text-right text-red-600">{t.inaccurateCount}</td>
                        <td className="px-3 py-2 text-right">
                          <Badge variant={t.qualityScore >= 80 ? "default" : t.qualityScore >= 60 ? "secondary" : "destructive"}>
                            {t.qualityScore}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">{t.helpfulRate}%</td>
                      </tr>
                    ))}
                    {barData.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                          No template data for the selected period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold">How it works: </span>
              Templates are ranked by Quality Score (helpful = 100, needs improvement = 50, inaccurate = 0 points).
              Data comes from radiologist feedback on drafts generated with each template.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
