import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { AnchorRail } from "./AnchorRail";
import { MriLumbarCanvas } from "./MriLumbarCanvas";
import {
  CanvasViewModeToggle,
  ObservationLedgerPanel,
  type CanvasViewMode,
} from "./ObservationLedgerPanel";
import { CoverageCockpit } from "./CoverageCockpit";
import { ContradictionBanner, ImpressionStaleBanner } from "./ContradictionBanner";
import { GhostLayer } from "./GhostLayer";
import { defaultCoverageMarks, markRegionViewed } from "@/lib/coverageMarks";
import {
  composeLumbarLevelNarrative,
  isMriLumbarReportingContext,
  type LumbarLevelSelection,
} from "@/lib/mriLumbarRegions";
import { validateReport } from "@/lib/reportValidator";

export type ReportingCanvasSlots = {
  studyHeader: ReactNode;
  technique: ReactNode;
  narrativeFindings: ReactNode;
  impression: ReactNode;
  recommendation: ReactNode;
  /** Optional extras (Quick Select / chocolate / history) kept available. */
  captureAssist?: ReactNode;
  signOff: ReactNode;
};

/**
 * Primary continuous MRI Reporting Canvas R2.
 * Accordion components remain in the repo for rollback; this is the live UI.
 */
export default function ReportingCanvas({
  slots,
  disabled,
  modality,
  region,
  family,
  spineSegment,
}: {
  slots: ReportingCanvasSlots;
  disabled?: boolean;
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  spineSegment?: string | null;
}) {
  const activeAnchor = useWorkspace((s) => s.activeAnchor);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const findingsText = useWorkspace((s) => s.findingsText);
  const impressionText = useWorkspace((s) => s.impressionText);
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const clinicalHistoryText = useWorkspace((s) => s.clinicalHistoryText);
  const recommendationText = useWorkspace((s) => s.recommendationText);
  const impressionNeedsRefresh = useWorkspace((s) => s.impressionNeedsRefresh);
  const coverageMarks = useWorkspace((s) => s.coverageMarks);
  const setCoverageMark = useWorkspace((s) => s.setCoverageMark);
  const refreshImpression = useWorkspace((s) => s.refreshImpressionFromLedger);
  const applyOverlay = useWorkspace((s) => s.applyPathologyOverlay);

  const [viewMode, setViewMode] = useState<CanvasViewMode>("split");
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);

  const isLumbar = isMriLumbarReportingContext({ modality, region, family, spineSegment });

  const marks = coverageMarks.length > 0 ? coverageMarks : defaultCoverageMarks();

  const validationWarnings = useMemo(() => {
    const warnings = validateReport({
      findings: findingsText,
      impression: impressionText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
      technique: techniqueText,
      clinicalHistory: clinicalHistoryText,
      recommendation: recommendationText,
    });
    return warnings.filter(
      (w) =>
        /contradict|mismatch|severity|laterality|stenosis|hemorrhage|infarct|moderate|severe|L\d/i.test(w),
    );
  }, [findingsText, impressionText, techniqueText, clinicalHistoryText, recommendationText]);

  const onFocusRegion = useCallback((key: string) => {
    setFocusedRegion(key);
    const next = markRegionViewed(marks, key, activeAnchor);
    const row = next.find((m) => m.regionKey === key);
    if (row && row.status === "viewed") {
      setCoverageMark(key, "viewed");
    }
  }, [marks, activeAnchor, setCoverageMark]);

  const onApplyLevel = useCallback((
    level: string,
    regionKey: string,
    _sel: LumbarLevelSelection,
    composed: ReturnType<typeof composeLumbarLevelNarrative>,
  ) => {
    const patchId = `r2-ls-${level.replace(/\s+/g, "")}-${composed.concept}`;
    applyOverlay({
      id: patchId,
      incoming: {
        findings: composed.findings,
        impression: composed.impression,
      },
      templates: {
        findings: composed.findings,
        impression: composed.impression,
      },
      ownership: {
        anatomicalSection: level,
        conflictGroup: composed.concept,
        baselineReplaces: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis.",
        concept: composed.concept,
        level,
        laterality: composed.laterality,
      },
      source: "structured-template",
      region: region ?? "LS Spine",
      level,
      laterality: composed.laterality,
      concept: composed.concept,
      severity: composed.severity,
      label: `${level} ${composed.concept}`,
      findingsText: composed.findings,
    });
    setCoverageMark(regionKey, "partial");
  }, [applyOverlay, region, setCoverageMark]);

  const showNarrative = viewMode === "narrative" || viewMode === "split";
  const showLedger = viewMode === "ledger" || viewMode === "split";

  return (
    <div className="flex flex-col gap-3" data-testid="reporting-canvas-r2">
      {slots.studyHeader}

      <AnchorRail
        anchor={activeAnchor}
        seriesHints={activeAnchor?.seriesDescription ? [activeAnchor.seriesDescription] : undefined}
      />

      <section className="space-y-1" data-testid="r2-technique-block">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">Technique</h3>
        {slots.technique}
      </section>

      {isLumbar ? (
        <MriLumbarCanvas
          patches={patches}
          disabled={disabled}
          focusedRegionKey={focusedRegion}
          onFocusRegion={onFocusRegion}
          onApplyLevel={onApplyLevel}
        />
      ) : (
        <div
          className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-2 py-2 text-[10px] text-muted-foreground"
          data-testid="r2-non-lumbar-note"
        >
          MRI lumbar region canvas activates for LS Spine. Other MRI regions use narrative + Quick Select below.
          CT / US / XR R2 grammars are intentionally not implemented.
        </div>
      )}

      {slots.captureAssist}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Findings</h3>
        <CanvasViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      <div className={viewMode === "split" ? "grid gap-2 lg:grid-cols-2" : "grid gap-2"}>
        {showNarrative ? (
          <div data-testid="r2-narrative-findings">{slots.narrativeFindings}</div>
        ) : null}
        {showLedger ? (
          <ObservationLedgerPanel
            patches={patches}
            findingsText={findingsText}
            selectedId={selectedLedgerId}
            onSelect={setSelectedLedgerId}
          />
        ) : null}
      </div>

      <ContradictionBanner warnings={validationWarnings} />
      <GhostLayer contradictionHints={validationWarnings.slice(0, 3)} />

      <section className="space-y-1.5" data-testid="r2-impression-block">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-violet-800">Impression</h3>
          {impressionNeedsRefresh ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-900">
              NEEDS REFRESH
            </span>
          ) : null}
        </div>
        <ImpressionStaleBanner
          needsRefresh={impressionNeedsRefresh}
          onRefresh={() => refreshImpression()}
          disabled={disabled}
        />
        {slots.impression}
      </section>

      <section className="space-y-1" data-testid="r2-recommendation-block">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-800">Recommendation</h3>
        {slots.recommendation}
      </section>

      {isLumbar ? (
        <CoverageCockpit
          marks={marks}
          disabled={disabled}
          onJump={(key) => {
            onFocusRegion(key);
            document.getElementById(`r2-region-${key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
          onMarkReviewed={(key) => setCoverageMark(key, "reviewed")}
          onWaive={(key, reason) => setCoverageMark(key, "waived", reason)}
        />
      ) : null}

      <section data-testid="r2-signoff-block">{slots.signOff}</section>
    </div>
  );
}
