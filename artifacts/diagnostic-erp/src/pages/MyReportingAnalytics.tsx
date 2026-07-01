/**
 * MyReportingAnalytics — Phase 5
 *
 * Personal analytics dashboard for Dr. Abinash (or any logged-in radiologist).
 * Shows TAT, daily volume, modality breakdown, measurement stats,
 * QA checklist outcomes, and AI prompt usage — all scoped to the
 * currently logged-in radiologist for a configurable look-back period.
 *
 * API: GET /api/radiology/my-analytics?days=30
 * No new schema — aggregates from existing tables.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from "recharts";
import {
  ArrowLeft, Activity, Clock, Ruler, ClipboardCheck,
  Brain, TrendingUp, AlertTriangle, RefreshCw, BarChart3,
  Loader2, CheckCircle2, Stethoscope,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyticsResponse {
  radiologist: string;
  periodDays: number;
  tatStats: {
    totalSigned: number;
    avgTatMinutes: number;
    minTatMinutes: number;
    maxTatMinutes: number;
    medianTatMinutes: number;
  };
  modalityBreakdown: { modality: string; count: number }[];
  dailyVolume: { date: string; count: number }[];
  measurementStats: {
    totalSaved: number;
    studiesWithMeasurements: number;
    abnormalCount: number;
    uniqueLabelsUsed: number;
  };
  qaStats: { grade: string; count: number }[];
  aiPromptStats: { promptEdits: number; categoriesEdited: number; draftsWithAi: number; avgAiPct: number; maxAiPct: number };
  priorityBreakdown: { priority: string; count: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMinutes(mins: number): string {
  if (!mins || isNaN(mins)) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function tatColour(mins: number): string {
  if (mins <= 15) return "#34d399"; // green
  if (mins <= 30) return "#fbbf24"; // amber
  return "#f87171";                 // red
}

const MODALITY_COLOURS: Record<string, string> = {
  MRI: "#a78bfa", CT: "#38bdf8", USG: "#34d399",
  "X-RAY": "#fbbf24", MG: "#f472b6",
};

const GRADE_COLOURS: Record<string, string> = {
  acceptable: "#34d399",
  suboptimal: "#fbbf24",
  "non-diagnostic": "#f87171",
};

const PRIORITY_COLOURS: Record<string, string> = {
  stat: "#f87171", emergency: "#fb923c", urgent: "#fbbf24",
  routine: "#34d399", vip: "#a78bfa",
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, colour = "text-slate-200",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  colour?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
        <Icon size={11} />
        {label}
      </div>
      <div className={`text-xl font-bold font-mono ${colour}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "7 days",  value: 7  },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export default function MyReportingAnalytics() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState(30);
  const session = readStaffSession();
  const radiologist = session?.user.name ?? "";

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AnalyticsResponse>({
    queryKey: ["my-analytics", radiologist, days],
    queryFn: () =>
      api.get<AnalyticsResponse>(
        `/api/radiology/my-analytics?days=${days}&radiologist=${encodeURIComponent(radiologist)}`
      ),
    enabled: Boolean(radiologist),
    staleTime: 2 * 60 * 1000,
  });

  const tat = data?.tatStats;
  const ms  = data?.measurementStats;
  const ai  = data?.aiPromptStats;

  // Fill in missing daily dates so chart has no gaps
  const dailyChart = (() => {
    if (!data?.dailyVolume.length) return [];
    const map = new Map(data.dailyVolume.map((d) => [d.date, d.count]));
    const result: { date: string; label: string; count: number }[] = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({
        date: key,
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        count: map.get(key) ?? 0,
      });
    }
    return result;
  })();

  const totalQA = data?.qaStats.reduce((s, r) => s + r.count, 0) ?? 0;
  const acceptableQA = data?.qaStats.find((r) => r.grade === "acceptable")?.count ?? 0;
  const qaPassRate = totalQA > 0 ? Math.round((acceptableQA / totalQA) * 100) : null;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-16">
      <PageHeader
        title="My Reporting Analytics"
        subtitle={radiologist ? `Personal metrics for ${radiologist}` : "Personal reporting metrics"}
      />

      {/* Back + period selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/radiology")}>
          <ArrowLeft size={14} className="mr-1" /> Radiology
        </Button>
        <div className="flex items-center gap-1 ml-auto">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setDays(o.value)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                days === o.value
                  ? "bg-violet-950/40 border-violet-700/60 text-violet-300 font-semibold"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="ml-2 text-slate-500 hover:text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
          <Loader2 size={18} className="animate-spin" />
          <span>Loading your analytics…</span>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-2 text-red-400 p-4 border border-red-900/40 rounded-lg bg-red-950/20">
          <AlertTriangle size={16} />
          Could not load analytics. The analytics endpoint may need a moment to initialise.
          <button onClick={() => refetch()} className="underline ml-2">Retry</button>
        </div>
      )}

      {data && (
        <>
          {/* ── TAT summary ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Clock size={12} /> Turnaround Time
              <Badge className="ml-auto text-[9px] bg-slate-800 text-slate-400 border-slate-700">
                {days}d
              </Badge>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <StatCard
                icon={Stethoscope} label="Reports Signed"
                value={tat?.totalSigned ?? 0}
                colour="text-violet-300"
              />
              <StatCard
                icon={Clock} label="Avg TAT"
                value={formatMinutes(tat?.avgTatMinutes ?? 0)}
                sub="mean time to sign"
                colour={tat?.avgTatMinutes ? (tat.avgTatMinutes <= 20 ? "text-emerald-400" : tat.avgTatMinutes <= 40 ? "text-amber-400" : "text-red-400") : "text-slate-400"}
              />
              <StatCard
                icon={Activity} label="Median TAT"
                value={formatMinutes(tat?.medianTatMinutes ?? 0)}
                sub="50th percentile"
              />
              <StatCard
                icon={TrendingUp} label="Fastest"
                value={formatMinutes(tat?.minTatMinutes ?? 0)}
                colour="text-emerald-400"
              />
              <StatCard
                icon={AlertTriangle} label="Slowest"
                value={formatMinutes(tat?.maxTatMinutes ?? 0)}
                colour="text-amber-400"
              />
            </div>
          </section>

          {/* ── Daily volume chart ── */}
          {dailyChart.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <BarChart3 size={12} /> Daily Signing Volume
              </h2>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4" style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.floor(dailyChart.length / 8)}
                    />
                    <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                      labelStyle={{ color: "#94a3b8" }}
                      itemStyle={{ color: "#a78bfa" }}
                    />
                    <Bar dataKey="count" name="Reports" radius={[3, 3, 0, 0]}>
                      {dailyChart.map((entry, i) => (
                        <Cell key={i} fill={entry.count > 0 ? "#a78bfa" : "#1e293b"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* ── Modality + Priority side by side ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Modality breakdown */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Activity size={12} /> By Modality
              </h2>
              {data.modalityBreakdown.length === 0 ? (
                <div className="text-[10px] text-slate-500 py-4 text-center">No reports in period</div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3" style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.modalityBreakdown} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="modality" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                        itemStyle={{ color: "#94a3b8" }}
                      />
                      <Bar dataKey="count" name="Reports" radius={[0, 3, 3, 0]}>
                        {data.modalityBreakdown.map((entry, i) => (
                          <Cell key={i} fill={MODALITY_COLOURS[entry.modality] ?? "#64748b"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Priority breakdown */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <AlertTriangle size={12} /> By Priority
              </h2>
              {data.priorityBreakdown.length === 0 ? (
                <div className="text-[10px] text-slate-500 py-4 text-center">No priority data</div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
                  {data.priorityBreakdown.map((p) => {
                    const total = data.priorityBreakdown.reduce((s, r) => s + r.count, 0);
                    const pct = total > 0 ? Math.round((p.count / total) * 100) : 0;
                    return (
                      <div key={p.priority} className="flex items-center gap-2 text-[10px]">
                        <span className="w-20 text-slate-400 capitalize font-medium shrink-0">{p.priority}</span>
                        <div className="flex-1 bg-slate-800 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: PRIORITY_COLOURS[p.priority] ?? "#64748b",
                            }}
                          />
                        </div>
                        <span className="text-slate-300 font-mono w-8 text-right">{p.count}</span>
                        <span className="text-slate-600 w-8">({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ── Bottom row: Measurements + QA + AI ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Measurements */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Ruler size={12} /> Measurements
              </h2>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Total saved</span>
                  <span className="font-mono font-bold text-sky-300">{ms?.totalSaved ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Studies with measurements</span>
                  <span className="font-mono text-slate-300">{ms?.studiesWithMeasurements ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Abnormal findings</span>
                  <span className={`font-mono font-bold ${(ms?.abnormalCount ?? 0) > 0 ? "text-red-400" : "text-slate-400"}`}>
                    {ms?.abnormalCount ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Unique labels used</span>
                  <span className="font-mono text-slate-300">{ms?.uniqueLabelsUsed ?? 0}</span>
                </div>
              </div>
            </section>

            {/* QA checklist */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ClipboardCheck size={12} /> Protocol QA
              </h2>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
                {data.qaStats.length === 0 ? (
                  <p className="text-[10px] text-slate-600 text-center py-2">No QA assessments in period</p>
                ) : (
                  <>
                    {data.qaStats.map((q) => (
                      <div key={q.grade} className="flex items-center justify-between text-[10px]">
                        <span className="capitalize" style={{ color: GRADE_COLOURS[q.grade] ?? "#94a3b8" }}>
                          {q.grade}
                        </span>
                        <span className="font-mono font-bold text-slate-300">{q.count}</span>
                      </div>
                    ))}
                    {qaPassRate !== null && (
                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800 text-[10px] text-emerald-400 font-semibold">
                        <CheckCircle2 size={10} />
                        {qaPassRate}% acceptable
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* AI prompt usage */}
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Brain size={12} /> AI Prompt Activity
              </h2>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Prompt edits / saves</span>
                  <span className="font-mono font-bold text-purple-300">{ai?.promptEdits ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Categories customised</span>
                  <span className="font-mono text-slate-300">{ai?.categoriesEdited ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Reports using AI</span>
                  <span className="font-mono text-slate-300">{ai?.draftsWithAi ?? 0}</span>
                </div>
                {(ai?.avgAiPct ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500">Avg AI contribution</span>
                    <span className="font-mono font-bold text-purple-300">{ai?.avgAiPct}%</span>
                  </div>
                )}
                {(ai?.promptEdits ?? 0) === 0 && (ai?.draftsWithAi ?? 0) === 0 && (
                  <p className="text-[9px] text-slate-600 pt-1">
                    Prompt usage is tracked when you edit prompts in{" "}
                    <span className="text-slate-500">Radiology → AI Prompt Manager</span>.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* Footer */}
          <p className="text-[9px] text-slate-700 text-center">
            Data sourced from radiology_studies, radiology_measurements, mri_protocol_quality_results, ai_prompt_library_versions
            · Last {days} days · Radiologist: {radiologist}
          </p>
        </>
      )}
    </div>
  );
}
