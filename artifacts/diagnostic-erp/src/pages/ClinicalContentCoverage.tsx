/**
 * ClinicalContentCoverage.tsx — the Clinical Content Coverage Dashboard.
 *
 * Management analytics over the existing platform: which studies are
 * clinically complete, what content is missing, where work should focus.
 * Data = the Knowledge Pack engine's per-pack coverage endpoint; scoring =
 * pure lib (clinicalCoverage.ts); weights = editable data (persisted locally),
 * never hardcoded. No new engine, no runtime change to reporting.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ALL_SECTIONS, DEFAULT_COVERAGE_WEIGHTS, SECTION_LABELS,
  scoreRows, modalitySummary, sectionHeatmap, priorityRank, overallScore,
  type CoverageRow, type PackSectionName,
} from "@/lib/clinicalCoverage";

const WEIGHTS_KEY = "care.clinicalCoverage.weights.v1";

function loadWeights(): Record<PackSectionName, number> {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (raw) return { ...DEFAULT_COVERAGE_WEIGHTS, ...JSON.parse(raw) };
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_COVERAGE_WEIGHTS };
}

function scoreColor(pct: number): string {
  return pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
}
function cellColor(pct: number): string {
  return pct >= 80 ? "bg-emerald-100 text-emerald-800" : pct >= 50 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800";
}

export default function ClinicalContentCoverage() {
  const [weights, setWeights] = useState<Record<PackSectionName, number>>(loadWeights);
  const [showWeights, setShowWeights] = useState(false);
  const [modalityFilter, setModalityFilter] = useState("all");
  const [openPack, setOpenPack] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kp-coverage"],
    queryFn: () => api.get<{ rows: CoverageRow[]; generatedAt: string }>("/api/radiology/knowledge-packs/coverage"),
  });

  const studies = useMemo(() => scoreRows(data?.rows ?? [], weights), [data?.rows, weights]);
  const filtered = useMemo(
    () => (modalityFilter === "all" ? studies : studies.filter((s) => s.modality === modalityFilter)),
    [studies, modalityFilter],
  );
  const summary = useMemo(() => modalitySummary(studies), [studies]);
  const heatmap = useMemo(() => sectionHeatmap(studies), [studies]);
  const priorities = useMemo(() => priorityRank(filtered, weights).slice(0, 10), [filtered, weights]);
  const overall = useMemo(() => overallScore(studies), [studies]);

  function saveWeight(section: PackSectionName, value: number) {
    const next = { ...weights, [section]: Math.max(0, value) };
    setWeights(next);
    try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
  }

  return (
    <div className="p-4 space-y-4 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">Clinical Content Coverage</h1>
          <p className="text-xs text-gray-500">
            Derived live from the Knowledge Pack engine ({data?.rows.length ?? 0} packs). Weighted scoring —
            weights are editable data, not hardcoded. Gaps deep-link to the owning admin surface.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold">{overall}%</div>
          <div className="text-[10px] text-gray-500 uppercase">Overall platform readiness</div>
        </div>
      </div>

      {/* Per-modality summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summary.map((m) => (
          <button key={m.modality} className={`rounded-lg border p-3 text-left ${modalityFilter === m.modality ? "ring-2 ring-indigo-400" : ""}`}
            onClick={() => setModalityFilter(modalityFilter === m.modality ? "all" : m.modality)}>
            <div className="flex justify-between text-sm font-semibold"><span>{m.modality}</span><span>{m.avgScore}%</span></div>
            <div className="h-1.5 mt-1 rounded bg-gray-100 overflow-hidden"><div className={`h-full ${scoreColor(m.avgScore)}`} style={{ width: `${m.avgScore}%` }} /></div>
            <div className="text-[10px] text-gray-500 mt-1">{m.enabled}/{m.packs} packs enabled</div>
          </button>
        ))}
      </div>

      {/* Heatmap */}
      <div className="rounded-lg border p-3 overflow-x-auto">
        <div className="text-xs font-semibold mb-2">Completeness heatmap (per modality × section, % of packs covering)</div>
        <table className="text-[10px]">
          <thead><tr><th className="pr-2 text-left">Modality</th>{ALL_SECTIONS.map((s) => (
            <th key={s} className="px-1 font-normal text-gray-500" style={{ writingMode: "vertical-rl" }}>{SECTION_LABELS[s]}</th>
          ))}</tr></thead>
          <tbody>{heatmap.map((row) => (
            <tr key={row.modality}>
              <td className="pr-2 font-semibold">{row.modality}</td>
              {row.cells.map((c) => (
                <td key={c.section} className={`px-1 py-0.5 text-center ${cellColor(c.pct)}`} title={`${SECTION_LABELS[c.section]}: ${c.pct}%`}>{c.pct}</td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>

      {/* Weights (configurable) */}
      <div className="rounded-lg border p-3">
        <button className="text-xs font-semibold" onClick={() => setShowWeights(!showWeights)}>
          Scoring weights {showWeights ? "▾" : "▸"} <span className="text-gray-400 font-normal">(editable — stored locally)</span>
        </button>
        {showWeights && (
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-2">
            {ALL_SECTIONS.map((s) => (
              <label key={s} className="text-[10px] text-gray-600">
                {SECTION_LABELS[s]}
                <Input type="number" min={0} className="h-6 text-xs" value={weights[s]}
                  onChange={(e) => saveWeight(s, Number(e.target.value))} />
              </label>
            ))}
            <Button variant="outline" size="sm" className="h-6 text-[10px] self-end"
              onClick={() => { setWeights({ ...DEFAULT_COVERAGE_WEIGHTS }); try { localStorage.removeItem(WEIGHTS_KEY); } catch { /* ignore */ } }}>
              Reset defaults
            </Button>
          </div>
        )}
      </div>

      {/* Top priorities */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-1">Top priority studies (need × impact — the content roadmap)</div>
        <div className="text-[10px] text-gray-400 mb-2">
          Usage frequency is not yet recorded per study, so ranking uses completeness need, enabled status,
          critical-findings impact and the weight of the largest gap — honest inputs only.
        </div>
        {priorities.map((p, i) => (
          <div key={p.packId} className="flex items-center gap-2 text-xs py-0.5 border-t first:border-0">
            <span className="text-gray-400 w-4">{i + 1}.</span>
            <span className="font-semibold">{p.name}</span>
            <span className="text-gray-400">{p.modality}</span>
            <span className="ml-auto">{p.clinicalScore}%</span>
            <span className="text-[10px] px-1 rounded bg-indigo-50 text-indigo-700">priority {p.priority}</span>
          </div>
        ))}
      </div>

      {/* Per-study table with gap analysis */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-2">Per-study coverage ({filtered.length})</div>
        {isLoading && <div className="text-xs text-gray-400">Loading coverage…</div>}
        {[...filtered].sort((a, b) => a.clinicalScore - b.clinicalScore).map((s) => (
          <div key={s.packId} className="border-t first:border-0 py-1">
            <button className="w-full flex items-center gap-2 text-xs text-left" onClick={() => setOpenPack(openPack === s.packId ? null : s.packId)}>
              <span className={`w-2 h-2 rounded-full ${scoreColor(s.clinicalScore)}`} />
              <span className="font-semibold">{s.name}</span>
              <span className="text-gray-400">{s.modality} · {s.status} · v{s.version}</span>
              <span className="ml-auto font-bold">{s.clinicalScore}%</span>
            </button>
            {openPack === s.packId && (
              <div className="mt-1 pl-4 text-[11px]">
                <div className="text-gray-500 mb-1">
                  Registry recommendations: {s.registryRecommendations} · Pack readiness: {s.readinessPercent}% · Health: {s.health}
                </div>
                {s.missing.length === 0
                  ? <div className="text-emerald-700">All sections covered.</div>
                  : (
                    <div>
                      <span className="text-gray-500">Missing ({s.missing.length}): </span>
                      {s.missing.map((m) => (
                        <Link key={m.section} href={m.link}
                          className="inline-block mr-1 mb-0.5 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 hover:bg-rose-100">
                          {m.label} (w{m.weight})
                        </Link>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-[10px] text-gray-400">
        Trend analysis (coverage over time) requires snapshot persistence, which does not exist yet —
        documented as future work; nothing here writes to the database.
      </div>
    </div>
  );
}
