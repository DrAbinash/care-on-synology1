import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitCompare, FileText, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import {
  INTERVAL_CHANGES, type IntervalChange, buildComparisonSentence, comparisonBanner,
  formatStudyDate, extractMeasurements, compareMeasurementRows,
} from "@/lib/radiologyComparison";
import { buildPriorStudiesPath, derivePriorPanelState } from "@/lib/priorStudiesPanelState";

/**
 * ComparisonPanel — structured previous-study comparison (MRI PR 1).
 *
 * Reuses the EXISTING prior-studies endpoint (GET /api/radiology-copilot/
 * prior-studies) and the deterministic comparison engine (lib/radiologyComparison).
 * It does not fetch or diff on its own beyond that. Everything it inserts goes
 * through the workspace's normal setters and stays editable; it never modifies a
 * prior report.
 */

interface PriorStudy {
  id: number; accessionNumber: string; modality: string; bodyPart: string | null;
  studyDate: string; testName: string; testCode: string | null; impression: string | null;
  finalReport: string | null; reportedBy: string | null; reportedAt: string | null; status: string;
  reportId?: number | null; reportStatus?: string | null;
}

export interface SelectedPrior {
  id: number; studyName: string; dateIso: string; accessionNumber: string;
  significantChanges: { label: string; deltaText: string }[];
}

interface Props {
  patientId?: number;
  /** Current study's radiology_studies id — excluded server-side so a study never compares against itself. */
  excludeStudyId?: number;
  currentModality: string;
  currentStudyDescription: string;
  currentFindings: string;
  onInsertFindings: (text: string) => void;
  onInsertImpression: (text: string) => void;
  onSelectPrior: (ref: SelectedPrior | null) => void;
}

const REGION_WORDS = ["brain", "head", "spine", "lumbar", "cervical", "dorsal", "thoracic", "knee", "shoulder", "abdomen", "pelvis", "hip", "wrist", "ankle", "orbit", "pituitary", "neck"];

function regionTokens(s: string): Set<string> {
  const lower = s.toLowerCase();
  return new Set(REGION_WORDS.filter((w) => lower.includes(w)));
}

/** Same modality family + at least one shared body-region word. */
function isCompatible(prior: PriorStudy, curMod: string, curDesc: string): boolean {
  const sameModality = (prior.modality || "").slice(0, 2).toUpperCase() === (curMod || "").slice(0, 2).toUpperCase();
  if (!sameModality) return false;
  const cur = regionTokens(curDesc);
  const pri = regionTokens(`${prior.testName} ${prior.bodyPart ?? ""}`);
  if (cur.size === 0 || pri.size === 0) return true; // can't tell → allow, radiologist decides
  for (const t of cur) if (pri.has(t)) return true;
  return false;
}

export default function ComparisonPanel({
  patientId, excludeStudyId, currentModality, currentStudyDescription, currentFindings, onInsertFindings, onInsertImpression, onSelectPrior,
}: Props) {
  const { data, isLoading, isError, refetch } = useQuery<{ studies: PriorStudy[] }>({
    queryKey: ["radiology-prior-studies", patientId, excludeStudyId ?? null],
    queryFn: () => api.get(buildPriorStudiesPath({ patientId: patientId!, limit: 20, excludeStudyId })),
    enabled: !!patientId,
    staleTime: 120_000,
  });

  // Compatible priors first, finalized preferred, most recent date first.
  const ranked = useMemo(() => {
    const all = data?.studies ?? [];
    const score = (s: PriorStudy) =>
      (isCompatible(s, currentModality, currentStudyDescription) ? 1000 : 0) +
      (/final/i.test(s.status) ? 100 : 0);
    return [...all].sort((a, b) => score(b) - score(a) || (b.studyDate > a.studyDate ? 1 : -1));
  }, [data, currentModality, currentStudyDescription]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [finding, setFinding] = useState("");
  const [qualifier, setQualifier] = useState("");
  const [showPrior, setShowPrior] = useState(false);

  // Auto-select the best compatible prior once results arrive.
  useEffect(() => {
    if (selectedId == null && ranked.length && isCompatible(ranked[0], currentModality, currentStudyDescription)) {
      setSelectedId(ranked[0].id);
    }
  }, [ranked, selectedId, currentModality, currentStudyDescription]);

  const prior = ranked.find((s) => s.id === selectedId) ?? null;
  const priorText = prior ? `${prior.finalReport ?? ""}\n${prior.impression ?? ""}` : "";

  const rows = useMemo(
    () => (prior ? compareMeasurementRows(extractMeasurements(priorText), extractMeasurements(currentFindings)) : []),
    [prior, priorText, currentFindings],
  );

  // Report the selection + significant changes up so the Copilot module + the
  // draft reference stay in sync. Significant = comparable, ≥20% or ≥3 mm.
  useEffect(() => {
    if (!prior) { onSelectPrior(null); return; }
    const significant = rows
      .filter((r) => r.comparable && r.delta != null && (Math.abs(r.delta) >= 3 || Math.abs(parseInt(r.percentText, 10) || 0) >= 20))
      .map((r) => ({ label: r.label, deltaText: r.deltaText }));
    onSelectPrior({ id: prior.id, studyName: prior.testName, dateIso: prior.studyDate, accessionNumber: prior.accessionNumber, significantChanges: significant });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prior?.id, rows.length]);

  const insertChange = (change: IntervalChange) => {
    onInsertFindings(buildComparisonSentence(change, {
      finding, qualifier, priorDateIso: prior?.studyDate, priorStudyName: prior?.testName,
    }));
  };

  // Four distinct user-visible states — an error must never masquerade as
  // "no prior studies" (that silence hid the dead endpoint for months).
  const panelState = derivePriorPanelState({ patientId, isLoading, isError, studyCount: ranked.length });
  if (panelState === "no-patient") return <p className="p-3 text-[11px] text-muted-foreground">No patient context for comparison.</p>;
  if (panelState === "loading") return <p className="p-3 text-[11px] text-muted-foreground" data-testid="comparison-panel-loading">Loading prior studies…</p>;
  if (panelState === "error") return (
    <div className="p-3 text-[11px] space-y-1.5" data-testid="comparison-panel-error">
      <p className="text-destructive flex items-center gap-1">
        <AlertTriangle size={12} /> Couldn't load prior studies.
      </p>
      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => refetch()}>Retry</Button>
    </div>
  );
  if (panelState === "empty") return (
    <div className="p-3 text-[11px] text-muted-foreground" data-testid="comparison-panel">
      <GitCompare size={12} className="mr-1 inline" /> No prior studies found for this patient.
    </div>
  );

  return (
    <div className="flex flex-col gap-2 p-2 text-sm" data-testid="comparison-panel">
      <div className="flex items-center gap-1.5">
        <GitCompare size={13} className="text-primary" />
        <span className="text-sm font-semibold">Previous Study</span>
      </div>

      {/* Prior selector */}
      <div className="rounded-md border p-2 space-y-1">
        <select
          className="h-8 w-full text-xs border rounded-md px-2 bg-background"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value) || null)}
        >
          <option value="">Select a prior study…</option>
          {ranked.map((s) => (
            <option key={s.id} value={s.id}>
              {formatStudyDate(s.studyDate)} · {s.testName} {isCompatible(s, currentModality, currentStudyDescription) ? "" : "(different region)"}
            </option>
          ))}
        </select>
        {prior && (
          <div className="text-[11px] text-muted-foreground">
            <div>Date: <span className="text-foreground">{formatStudyDate(prior.studyDate)}</span> · {prior.status}{prior.reportedBy ? ` · ${prior.reportedBy}` : ""}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onInsertFindings(comparisonBanner(prior.studyDate, prior.testName))}>Insert comparison banner</Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowPrior((v) => !v)}>
                {showPrior ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Prior report
              </Button>
            </div>
            {showPrior && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded bg-muted/30 p-1.5 text-[10px] whitespace-pre-wrap">
                {(prior.finalReport || prior.impression || "No report text available.").trim()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interval-change classification → editable comparison statement */}
      {prior && (
        <div className="rounded-md border p-2 space-y-1.5">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Interval change</span>
          <div className="flex gap-1">
            <Input value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="finding, e.g. the L4-L5 disc protrusion" className="h-7 text-xs" />
            <select value={qualifier} onChange={(e) => setQualifier(e.target.value)} className="h-7 text-xs border rounded-md px-1 bg-background" title="degree">
              <option value="">—</option><option value="mild">mild</option><option value="moderate">moderate</option><option value="significant">significant</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            {INTERVAL_CHANGES.map((c) => (
              <button key={c.value} onClick={() => insertChange(c.value)}
                className="rounded-full border px-2 py-0.5 text-[10px] hover:bg-primary hover:text-primary-foreground">
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Measurement comparison */}
      {prior && rows.length > 0 && (
        <div className="rounded-md border p-2">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Measurements (from reports)</span>
          <table className="mt-1 w-full text-[10px]">
            <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Measurement</th><th className="text-right font-medium">Prev</th><th className="text-right font-medium">Curr</th><th className="text-right font-medium">Δ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={r.comparable ? "" : "text-muted-foreground/70"}>
                  <td className="truncate pr-1" title={r.note}>{r.label}</td>
                  <td className="text-right">{r.previous ?? "—"}</td>
                  <td className="text-right">{r.current ?? "—"}</td>
                  <td className={`text-right ${r.delta != null && r.delta > 0 ? "text-rose-600" : r.delta != null && r.delta < 0 ? "text-emerald-600" : ""}`}>{r.comparable ? `${r.deltaText} ${r.percentText}` : r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[9px] text-muted-foreground">Extracted from report text — the viewer-measurement bridge (PR 2) will supply structured values with provenance.</p>
        </div>
      )}

      <p className="text-[9px] text-muted-foreground"><FileText size={9} className="mr-1 inline" />Inserted text stays editable. Prior reports are never modified.</p>
    </div>
  );
}
