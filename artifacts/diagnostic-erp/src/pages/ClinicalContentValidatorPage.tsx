/**
 * ClinicalContentValidatorPage.tsx — the Clinical Content Validator dashboard.
 *
 * Read-only analysis: aggregates the pack engine's own validation (via the
 * coverage endpoint), the Measurement Registry's own validation endpoint, and
 * the cross-registry / recommendation checks from clinicalContentValidator.ts.
 * Exportable (JSON + Markdown). Never modifies runtime behavior.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import type { CoverageRow } from "@/lib/clinicalCoverage";
import {
  validateRecommendationRegistry, validatePackRegistry,
  passthroughPackIssues, passthroughMeasurementIssues,
  buildReport, reportToMarkdown,
  type MeasurementValidationPayload, type FindingSeverity,
} from "@/lib/clinicalContentValidator";

const SEV_STYLE: Record<FindingSeverity, string> = {
  error: "bg-rose-100 text-rose-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
};

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ClinicalContentValidatorPage() {
  const [filter, setFilter] = useState<FindingSeverity | "all">("all");

  const coverage = useQuery({
    queryKey: ["kp-coverage"],
    queryFn: () => api.get<{ rows: CoverageRow[]; generatedAt: string }>("/api/radiology/knowledge-packs/coverage"),
  });
  const measurement = useQuery({
    queryKey: ["measurement-validation"],
    queryFn: () => api.get<MeasurementValidationPayload>("/api/measurement-registry/validation"),
    retry: false,
  });

  const report = useMemo(() => {
    const rows = coverage.data?.rows ?? [];
    const knownPackIds = new Set(rows.map((r) => r.packId));
    return buildReport([
      ...validateRecommendationRegistry(undefined, knownPackIds.size ? knownPackIds : undefined),
      ...validatePackRegistry(rows),
      ...passthroughPackIssues(rows),
      ...passthroughMeasurementIssues(measurement.data),
    ]);
  }, [coverage.data, measurement.data]);

  const visible = filter === "all" ? report.findings : report.findings.filter((f) => f.severity === filter);
  const generatedAt = new Date().toISOString();

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">Clinical Content Validator</h1>
          <p className="text-xs text-gray-500">
            The ESLint of the Reporting Platform — read-only content analysis across Knowledge Packs,
            Measurements and Recommendations. Pack and measurement checks are the platform's own validators,
            passed through; cross-registry checks run here. Nothing on this page changes runtime behavior.
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-extrabold ${report.healthScore >= 90 ? "text-emerald-600" : report.healthScore >= 70 ? "text-amber-600" : "text-rose-600"}`}>
            {report.healthScore}
          </div>
          <div className="text-[10px] text-gray-500 uppercase">Content health / 100</div>
        </div>
      </div>

      <div className="flex gap-2 items-center text-xs">
        {(["all", "error", "warn", "info"] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-2 py-1 rounded border ${filter === s ? "ring-2 ring-indigo-400" : ""} ${s === "all" ? "" : SEV_STYLE[s]}`}>
            {s === "all" ? `All (${report.findings.length})` : `${s} (${report.totals[s]})`}
          </button>
        ))}
        <span className="text-gray-400 ml-2">
          {Object.entries(report.byArea).map(([a, n]) => `${a}: ${n}`).join(" · ") || "no findings"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => download("care-content-validation.json", JSON.stringify({ generatedAt, ...report }, null, 2), "application/json")}>
            Export JSON
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => download("care-content-validation.md", reportToMarkdown(report, generatedAt), "text/markdown")}>
            Export Markdown
          </Button>
        </div>
      </div>

      {(coverage.isLoading || measurement.isLoading) && <div className="text-xs text-gray-400">Running validators…</div>}
      {measurement.isError && (
        <div className="text-[11px] text-amber-600">
          Measurement Registry validation endpoint unavailable — measurement checks skipped (report covers packs + recommendations).
        </div>
      )}

      <div className="rounded-lg border divide-y">
        {visible.length === 0 && <div className="p-3 text-xs text-emerald-700">No findings at this severity. Content is clean.</div>}
        {visible.map((f, i) => (
          <div key={`${f.code}-${f.subject}-${i}`} className="p-2 text-xs flex items-start gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SEV_STYLE[f.severity]}`}>{f.severity}</span>
            <div className="min-w-0">
              <div><span className="font-mono text-[10px] text-gray-400">{f.code}</span> <span className="font-semibold">{f.subject}</span></div>
              <div className="text-gray-600">{f.message}</div>
              {f.fix && <div className="text-emerald-700">Fix: {f.fix}</div>}
            </div>
            <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap">{f.area} · {f.source}</span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-gray-400">
        DB-level duplicate scans inside content tables (e.g. duplicate protocol rows) and template-placeholder
        linting require server-side queries that do not exist yet — documented as future work; this validator
        is deliberately read-only aggregation plus pure cross-registry analysis.
      </div>
    </div>
  );
}
