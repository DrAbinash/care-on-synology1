/**
 * ViewerMeasurementsPanel.tsx — Cockpit → Workspace merge, item D1 (additive).
 *
 * Ports the "Viewer Measurements" bridge out of the deprecated
 * RadiologistCockpit (see its Builders-tab "CENTRALIZED VIEWER MEASUREMENT
 * BRIDGE" block) into a single chrome-less, prop-driven panel that can be
 * mounted inside the canonical RadiologyReportingWorkspace (or anywhere a
 * studyInstanceUID + report-insert callbacks are available).
 *
 * It surfaces measurements/calipers captured in the external DICOM viewer
 * (OHIF / Weasis) or parsed from DICOM SR for the current study as a
 * reviewable import queue: each row can be Imported, Ignored, Restored, or
 * inserted into the report Findings / Impression, and the whole pending set
 * can be bulk-imported.
 *
 * This is purely additive — it introduces no new backend routes and reuses the
 * live endpoints already backing the Cockpit:
 *   GET   /api/radiology-lesions/viewer-measurements?studyInstanceUID=…  → { measurements: [] }
 *   PATCH /api/radiology-lesions/viewer-measurements/:id                 { status, value?, unit? }
 *   POST  /api/radiology-lesions/viewer-measurements/import-all          { ids }
 *
 * The "Locate on viewer" action opens the study in OHIF (series UID is copied
 * when available). Exact SOP-level highlight is still viewer-dependent.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import CollapsibleSection from "@/components/radiology/CollapsibleSection";
import { formatViewerMeasurementLabel, formatViewerMeasurementLine } from "@/lib/formatViewerMeasurementLine";
import { Check, ArrowDownToLine, Ban, RotateCcw, ExternalLink } from "lucide-react";
import { openOhifViewerPage } from "@/lib/viewerService";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ViewerMeasurementsPanelProps {
  studyInstanceUID: string | null | undefined;
  /** Insert a formatted measurement line into the report body / findings. */
  onInsertToFindings?: (line: string) => void;
  /** Insert a formatted measurement line into the report impression. */
  onInsertToImpression?: (line: string) => void;
  /** Optional: open viewer focused on this measurement's series (best-effort). */
  onLocateOnViewer?: (m: ViewerMeasurement) => void;
}

// ── Backend row type (viewer_measurements table $inferSelect, serialized) ──────

export interface ViewerMeasurement {
  id: number;
  patientId: number;
  studyId: number | null;
  orderId: number | null;
  studyInstanceUID: string;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  frameNumber: number | null;
  viewerName: string;      // "OHIF" | "Weasis" | "DICOM SR" | "manual" | "AI"
  measurementType: string; // "linear" | "area" | "volume" | "ellipse"
  /** Canonical Universal Measurement Registry id, when the exporting bridge knew the concept. */
  measurementId?: string | null;
  value: string;
  unit: string;
  sliceNumber: number | null;
  imageCoordinates: string | null;
  confidence: number | null;
  status: string;          // "pending" | "imported" | "ignored"
  importedBy: string | null;
  importTime: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatMeasurementLine(m: ViewerMeasurement): string {
  return formatViewerMeasurementLine(m);
}

function confidencePercent(confidence: number | null): number | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return Math.round(confidence * 100);
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  imported: { label: "Imported", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  ignored: { label: "Ignored", className: "bg-slate-100 text-slate-600 border-slate-300" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_BADGE[status] ?? { label: status || "—", className: "bg-slate-100 text-slate-600 border-slate-300" };
  return (
    <Badge variant="outline" className={`text-[9px] px-1 py-0 border ${meta.className}`}>
      {meta.label}
    </Badge>
  );
}

// ── Shared query hook ───────────────────────────────────────────────────────────
// Exported so other panels (e.g. the Workspace's F6 imported-measurement safety
// checks) can read the SAME cache entry instead of re-implementing the fetch —
// same queryKey means TanStack Query dedupes the network call regardless of how
// many components call this hook for the same study.

export function useViewerMeasurements(studyInstanceUID: string | null | undefined) {
  return useQuery<ViewerMeasurement[]>({
    queryKey: ["viewer-measurements", studyInstanceUID],
    queryFn: () =>
      studyInstanceUID
        ? api
            .get<{ measurements: ViewerMeasurement[] }>(
              `/api/radiology-lesions/viewer-measurements?studyInstanceUID=${encodeURIComponent(studyInstanceUID)}`,
            )
            .then((res) => res.measurements ?? [])
        : Promise.resolve([]),
    enabled: !!studyInstanceUID,
    staleTime: 5000,
  });
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function ViewerMeasurementsPanel({
  studyInstanceUID,
  onInsertToFindings,
  onInsertToImpression,
  onLocateOnViewer,
}: ViewerMeasurementsPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const measurementsQuery = useViewerMeasurements(studyInstanceUID);

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["viewer-measurements", studyInstanceUID] });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/api/radiology-lesions/viewer-measurements/${id}`, { status }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Measurement updated." });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const importAllMutation = useMutation({
    mutationFn: (ids: number[]) =>
      api.post(`/api/radiology-lesions/viewer-measurements/import-all`, { ids }),
    onSuccess: () => {
      invalidate();
      toast({ title: "All pending measurements imported." });
    },
    onError: (e: Error) =>
      toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  // Defensive: tolerate a missing/null list; never let the query throw into render.
  const measurements = Array.isArray(measurementsQuery.data) ? measurementsQuery.data : [];

  // Silent / non-cluttering: render nothing when there is no study, while the
  // query is loading/errored, or when there is simply nothing to review. The
  // panel only materialises once there is at least one measurement to import.
  if (!studyInstanceUID || measurements.length === 0) return null;

  const pendingIds = measurements.filter((m) => m.status === "pending").map((m) => m.id);

  function insertFindings(m: ViewerMeasurement) {
    onInsertToFindings?.(formatMeasurementLine(m));
    toast({ title: "Inserted into Findings" });
  }
  function insertImpression(m: ViewerMeasurement) {
    onInsertToImpression?.(formatMeasurementLine(m));
    toast({ title: "Inserted into Impression" });
  }

  return (
    <CollapsibleSection
      layoutKey="radiology_report_layout"
      id="viewer_measurements"
      title="Viewer Measurements"
      headerExtra={
        pendingIds.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[9px]"
            disabled={importAllMutation.isPending}
            onClick={() => importAllMutation.mutate(pendingIds)}
          >
            <ArrowDownToLine className="h-2.5 w-2.5 mr-1" />
            Import All ({pendingIds.length})
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5" data-testid="viewer-measurements-panel">
        {measurements.map((m) => {
          const conf = confidencePercent(m.confidence);
          const isPending = m.status === "pending";
          const isImported = m.status === "imported";
          const isIgnored = m.status === "ignored";
          const series = m.seriesInstanceUID ? `${m.seriesInstanceUID.substring(0, 8)}…` : "—";

          return (
            <div
              key={m.id}
              className={`rounded-lg border p-2 text-[11px] space-y-1.5 ${
                isImported
                  ? "bg-emerald-50 border-emerald-200"
                  : isIgnored
                    ? "bg-slate-50 border-slate-200 opacity-60"
                    : "bg-background border-border"
              }`}
              data-testid={`viewer-measurement-${m.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold truncate" title={formatViewerMeasurementLabel(m)}>
                    {formatViewerMeasurementLabel(m)}
                    {m.viewerName ? <span className="text-muted-foreground font-normal"> ({m.viewerName})</span> : null}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    Series {series} · Slice {m.sliceNumber ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  <span className="font-mono font-bold px-1.5 py-0.5 rounded border bg-muted">
                    {m.value}
                    {m.unit ? ` ${m.unit}` : ""}
                  </span>
                  {conf !== null && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">
                      Conf: {conf}%
                    </Badge>
                  )}
                  <StatusBadge status={m.status} />
                </div>
              </div>

              {m.imageCoordinates && (
                <div className="text-[9px] text-muted-foreground font-mono truncate" title={m.imageCoordinates}>
                  Coord: {m.imageCoordinates}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-border/60">
                {isPending && (
                  <>
                    <Button
                      size="sm"
                      className="h-5 px-1.5 text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={updateStatusMutation.isPending}
                      onClick={() => updateStatusMutation.mutate({ id: m.id, status: "imported" })}
                    >
                      <Check className="h-2.5 w-2.5 mr-0.5" /> Import
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 px-1.5 text-[9px]"
                      disabled={updateStatusMutation.isPending}
                      onClick={() => updateStatusMutation.mutate({ id: m.id, status: "ignored" })}
                    >
                      <Ban className="h-2.5 w-2.5 mr-0.5" /> Ignore
                    </Button>
                  </>
                )}

                {isImported && (
                  <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[8px] px-1 py-0 flex items-center gap-0.5">
                    <Check className="h-2 w-2" /> Imported
                  </Badge>
                )}

                {isIgnored && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px]"
                    disabled={updateStatusMutation.isPending}
                    onClick={() => updateStatusMutation.mutate({ id: m.id, status: "pending" })}
                  >
                    <RotateCcw className="h-2.5 w-2.5 mr-0.5" /> Restore
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[9px]"
                  title={m.seriesInstanceUID ? `Open viewer (series ${m.seriesInstanceUID.slice(0, 12)}…)` : "Open study in viewer"}
                  onClick={() => {
                    if (onLocateOnViewer) {
                      onLocateOnViewer(m);
                      return;
                    }
                    if (!studyInstanceUID) return;
                    if (m.seriesInstanceUID) {
                      try {
                        void navigator.clipboard?.writeText(m.seriesInstanceUID);
                      } catch { /* ignore */ }
                    }
                    openOhifViewerPage(studyInstanceUID);
                  }}
                >
                  <ExternalLink className="h-2.5 w-2.5 mr-0.5" /> Locate
                </Button>

                {onInsertToFindings && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[9px] ml-auto"
                    onClick={() => insertFindings(m)}
                  >
                    Findings
                  </Button>
                )}
                {onInsertToImpression && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-5 px-1.5 text-[9px] ${onInsertToFindings ? "" : "ml-auto"}`}
                    onClick={() => insertImpression(m)}
                  >
                    Impression
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
