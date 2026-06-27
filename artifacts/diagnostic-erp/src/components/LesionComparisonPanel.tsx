/**
 * LesionComparisonPanel — Phase 4
 *
 * Fetches all saved measurements for this patient from
 * /api/radiology-lesions/measurements?patientId=X
 * then groups them by label across studies/dates to show
 * progression or regression for each measured parameter.
 *
 * Current study measurements are highlighted separately.
 * Radiologist can insert a formatted comparison note into
 * the findings draft with one click.
 *
 * Reuses: /api/radiology-lesions/measurements (existing, no new API needed)
 * No schema changes. No new backend routes.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw,
  GitCompare, Loader2, AlertTriangle, ClipboardList,
  ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SavedMeasurement {
  id: number;
  patientId: number;
  studyId: number | null;
  modality: string;
  bodyPart: string;
  label: string;
  value: string;
  unit: string | null;
  normalRangeLow: number | null;
  normalRangeHigh: number | null;
  isAbnormal: boolean | null;
  reportedBy: string | null;
  createdAt: string;
}

interface StudyGroup {
  studyId: number | null;
  date: string;          // ISO string from createdAt
  displayDate: string;   // formatted for UI
  measurements: SavedMeasurement[];
  isCurrentStudy: boolean;
}

interface LabelSeries {
  label: string;
  unit: string | null;
  normalRangeLow: number | null;
  normalRangeHigh: number | null;
  // Ordered oldest → newest
  points: Array<{
    date: string;
    displayDate: string;
    value: number;
    rawValue: string;
    studyId: number | null;
    isCurrentStudy: boolean;
    isAbnormal: boolean | null;
  }>;
  latestValue: number | null;
  previousValue: number | null;
  delta: number | null;          // latest - previous
  deltaPct: number | null;       // % change
  trend: "up" | "down" | "stable" | "unknown";
  isCurrentAbnormal: boolean;
}

interface Props {
  patientId: number;
  currentStudyId: number | null | undefined;
  currentModality: string;
  onInsertFindings: (text: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function isNumeric(v: string): boolean {
  return !isNaN(parseFloat(v)) && isFinite(Number(v));
}

function trendIcon(trend: LabelSeries["trend"], isAbnormal: boolean) {
  if (trend === "up") return <TrendingUp size={11} className={isAbnormal ? "text-red-400" : "text-emerald-400"} />;
  if (trend === "down") return <TrendingDown size={11} className={isAbnormal ? "text-red-400" : "text-emerald-400"} />;
  if (trend === "stable") return <Minus size={11} className="text-slate-400" />;
  return null;
}

function normalStatus(value: number, low: number | null, high: number | null): boolean {
  if (low !== null && value < low) return true;   // abnormal
  if (high !== null && value > high) return true; // abnormal
  return false;
}

// ── Build comparison series from flat measurements list ───────────────────────

function buildSeries(
  measurements: SavedMeasurement[],
  currentStudyId: number | null | undefined,
): LabelSeries[] {
  // Group by label
  const byLabel = new Map<string, SavedMeasurement[]>();
  for (const m of measurements) {
    const key = m.label.trim().toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(m);
  }

  const series: LabelSeries[] = [];

  for (const [, group] of byLabel) {
    // Only include labels with numeric values
    const numeric = group.filter((m) => isNumeric(m.value));
    if (numeric.length === 0) continue;

    // Sort oldest first
    const sorted = [...numeric].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const points = sorted.map((m) => ({
      date: m.createdAt,
      displayDate: formatDate(m.createdAt),
      value: parseFloat(m.value),
      rawValue: m.value,
      studyId: m.studyId,
      isCurrentStudy: m.studyId === currentStudyId && currentStudyId != null,
      isAbnormal: m.isAbnormal,
    }));

    const latest = points[points.length - 1];
    const previous = points.length >= 2 ? points[points.length - 2] : null;

    const delta = previous != null ? latest.value - previous.value : null;
    const deltaPct = previous != null && previous.value !== 0
      ? Math.round((delta! / Math.abs(previous.value)) * 1000) / 10
      : null;

    let trend: LabelSeries["trend"] = "unknown";
    if (delta != null) {
      if (Math.abs(delta) < 0.5) trend = "stable";
      else if (delta > 0) trend = "up";
      else trend = "down";
    }

    const sample = group[0];
    const isCurrentAbnormal = normalStatus(
      latest.value,
      sample.normalRangeLow,
      sample.normalRangeHigh
    );

    series.push({
      label: sample.label,
      unit: sample.unit,
      normalRangeLow: sample.normalRangeLow,
      normalRangeHigh: sample.normalRangeHigh,
      points,
      latestValue: latest.value,
      previousValue: previous?.value ?? null,
      delta,
      deltaPct,
      trend,
      isCurrentAbnormal,
    });
  }

  // Sort: abnormal first, then by label
  return series.sort((a, b) => {
    if (a.isCurrentAbnormal && !b.isCurrentAbnormal) return -1;
    if (!a.isCurrentAbnormal && b.isCurrentAbnormal) return 1;
    return a.label.localeCompare(b.label);
  });
}

// ── Format comparison text for findings insertion ─────────────────────────────

function buildComparisonText(
  series: LabelSeries[],
  currentModality: string,
): string {
  const changed = series.filter((s) => s.delta != null && Math.abs(s.delta) >= 0.5);
  const stable = series.filter((s) => s.delta != null && Math.abs(s.delta) < 0.5);
  const newOnly = series.filter((s) => s.points.length === 1);

  const lines: string[] = [`COMPARISON WITH PRIOR ${currentModality} MEASUREMENTS:`];

  if (changed.length > 0) {
    lines.push("Changed:");
    for (const s of changed) {
      const dir = s.delta! > 0 ? "increased" : "decreased";
      const pct = s.deltaPct != null ? ` (${Math.abs(s.deltaPct)}%)` : "";
      const abn = s.isCurrentAbnormal ? " [ABNORMAL]" : "";
      lines.push(
        `  - ${s.label}: ${s.previousValue} → ${s.latestValue} ${s.unit ?? ""}` +
        ` — ${dir} by ${Math.abs(s.delta!).toFixed(1)} ${s.unit ?? ""}${pct}${abn}`
      );
    }
  }

  if (stable.length > 0) {
    lines.push("Stable (no significant change):");
    for (const s of stable) {
      lines.push(`  - ${s.label}: ${s.latestValue} ${s.unit ?? ""} (unchanged)`);
    }
  }

  if (newOnly.length > 0) {
    lines.push("New measurements (no prior for comparison):");
    for (const s of newOnly) {
      const abn = s.isCurrentAbnormal ? " [ABNORMAL]" : "";
      lines.push(`  - ${s.label}: ${s.latestValue} ${s.unit ?? ""}${abn}`);
    }
  }

  return lines.join("\n");
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LesionComparisonPanel({
  patientId,
  currentStudyId,
  currentModality,
  onInsertFindings,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<"all" | "changed" | "abnormal">("all");

  const { data, isLoading, isError, refetch } = useQuery<{ measurements: SavedMeasurement[] }>({
    queryKey: ["lesion-measurements-all", patientId],
    queryFn: () => api.get(`/api/radiology-lesions/measurements?patientId=${patientId}`),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });

  const allMeasurements = data?.measurements ?? [];

  const series = useMemo(
    () => buildSeries(allMeasurements, currentStudyId),
    [allMeasurements, currentStudyId]
  );

  const visibleSeries = useMemo(() => {
    if (filter === "changed") return series.filter((s) => s.delta != null && Math.abs(s.delta) >= 0.5);
    if (filter === "abnormal") return series.filter((s) => s.isCurrentAbnormal);
    return series;
  }, [series, filter]);

  const changedCount = series.filter((s) => s.delta != null && Math.abs(s.delta) >= 0.5).length;
  const abnormalCount = series.filter((s) => s.isCurrentAbnormal).length;
  const studyCount = new Set(allMeasurements.map((m) => m.studyId ?? "null")).size;

  if (!patientId) return null;

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-950/60 hover:bg-slate-900/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold text-violet-400 font-mono">
          <GitCompare size={12} />
          Measurement Comparison
        </span>
        <div className="flex items-center gap-2">
          {changedCount > 0 && (
            <Badge className="text-[8px] bg-amber-950/40 text-amber-400 border-amber-900/40">
              {changedCount} changed
            </Badge>
          )}
          {abnormalCount > 0 && (
            <Badge className="text-[8px] bg-red-950/40 text-red-400 border-red-900/40">
              {abnormalCount} abnormal
            </Badge>
          )}
          {studyCount > 1 && (
            <Badge className="text-[8px] bg-violet-950/40 text-violet-400 border-violet-900/40">
              {studyCount} studies
            </Badge>
          )}
          {expanded ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="p-3 flex flex-col gap-2">

          {/* Loading / Error */}
          {isLoading && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 py-2">
              <Loader2 size={11} className="animate-spin" /> Loading measurement history…
            </div>
          )}
          {isError && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400">
              <AlertTriangle size={11} /> Could not load measurements.{" "}
              <button onClick={() => refetch()} className="underline">Retry</button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && series.length === 0 && (
            <div className="text-center py-4 text-slate-500">
              <ClipboardList size={24} className="mx-auto opacity-30 mb-2" />
              <p className="text-[10px]">No saved measurements for this patient.</p>
              <p className="text-[9px] text-slate-600 mt-1">
                Enter values in the Measurements tab and save them to enable comparison.
              </p>
            </div>
          )}

          {/* Single study — no comparison possible yet */}
          {!isLoading && series.length > 0 && studyCount === 1 && (
            <div className="bg-slate-900/40 border border-slate-800 rounded p-2 text-[9px] text-slate-400 flex items-start gap-1.5">
              <AlertTriangle size={10} className="shrink-0 mt-0.5 text-amber-500" />
              Measurements found for 1 study only. Comparison will appear when prior measurements are saved across multiple visits.
            </div>
          )}

          {/* Filter tabs */}
          {!isLoading && series.length > 0 && (
            <div className="flex gap-1">
              {(["all", "changed", "abnormal"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors capitalize ${
                    filter === f
                      ? "bg-violet-950/40 border-violet-800/50 text-violet-300 font-semibold"
                      : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {f}
                  {f === "changed" && changedCount > 0 && ` (${changedCount})`}
                  {f === "abnormal" && abnormalCount > 0 && ` (${abnormalCount})`}
                  {f === "all" && ` (${series.length})`}
                </button>
              ))}
              <button
                onClick={() => refetch()}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={11} />
              </button>
            </div>
          )}

          {/* Series rows */}
          {!isLoading && visibleSeries.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {visibleSeries.map((s) => {
                const hasComparison = s.delta != null;
                const significant = hasComparison && Math.abs(s.delta!) >= 0.5;
                return (
                  <div
                    key={s.label}
                    className={`rounded border p-2 text-[10px] ${
                      s.isCurrentAbnormal
                        ? "border-red-900/40 bg-red-950/10"
                        : significant
                        ? "border-amber-900/30 bg-amber-950/10"
                        : "border-slate-800 bg-slate-900/40"
                    }`}
                  >
                    {/* Label row */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold ${s.isCurrentAbnormal ? "text-red-300" : "text-slate-200"}`}>
                        {s.label}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.normalRangeHigh != null && (
                          <span className="text-[8px] text-slate-600">
                            normal ≤{s.normalRangeHigh}{s.unit ?? ""}
                          </span>
                        )}
                        {s.normalRangeLow != null && s.normalRangeHigh == null && (
                          <span className="text-[8px] text-slate-600">
                            normal ≥{s.normalRangeLow}{s.unit ?? ""}
                          </span>
                        )}
                        {s.isCurrentAbnormal && (
                          <Badge className="text-[7px] bg-red-950/40 text-red-400 border-red-900/40 px-1">Abnormal</Badge>
                        )}
                      </div>
                    </div>

                    {/* Value timeline */}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {s.points.map((pt, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          <span className={`font-mono text-[10px] ${
                            pt.isCurrentStudy ? "text-violet-300 font-bold" : "text-slate-400"
                          }`}>
                            {pt.value}{s.unit ? ` ${s.unit}` : ""}
                          </span>
                          <span className="text-[8px] text-slate-600">
                            ({pt.displayDate}{pt.isCurrentStudy ? " ★" : ""})
                          </span>
                          {i < s.points.length - 1 && (
                            <ArrowRight size={9} className="text-slate-700 mx-0.5" />
                          )}
                        </span>
                      ))}
                    </div>

                    {/* Delta row */}
                    {hasComparison && (
                      <div className="flex items-center gap-1 mt-1">
                        {trendIcon(s.trend, s.isCurrentAbnormal)}
                        <span className={`text-[9px] ${
                          significant
                            ? s.isCurrentAbnormal ? "text-red-400" : "text-amber-400"
                            : "text-slate-500"
                        }`}>
                          {s.delta! > 0 ? "+" : ""}{s.delta!.toFixed(1)}{s.unit ?? ""}
                          {s.deltaPct != null && (
                            <span className="ml-1 text-slate-600">
                              ({s.deltaPct > 0 ? "+" : ""}{s.deltaPct}%)
                            </span>
                          )}
                          {!significant && <span className="text-slate-600 ml-1">— no significant change</span>}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Insert into findings */}
          {!isLoading && series.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] border-violet-800/50 text-violet-400 hover:bg-violet-950/20 mt-1"
              onClick={() => {
                const text = buildComparisonText(series, currentModality);
                onInsertFindings(text);
              }}
            >
              <ClipboardList size={9} className="mr-1" />
              Insert comparison into findings
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
