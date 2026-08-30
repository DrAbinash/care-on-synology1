/**
 * SpineCanalApBox — disc-level canal AP table under MEASURE for LS / cervical / dorsal MRI.
 * Persists via /spinal-measurements (vertebraLevel = disc label e.g. L4-L5).
 * Manual override + pull from viewer_measurements / MEASURE rail by level label.
 * Provenance enables optional FRAMES jump-back (↗).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { useViewerMeasurements } from "@/components/radiology/ViewerMeasurementsPanel";
import { formatViewerMeasurementLabel } from "@/lib/formatViewerMeasurementLine";
import {
  applyCanalApValue,
  canalSegmentBadge,
  canalSegmentFromSpine,
  canalTableTitle,
  discLevelFromLabel,
  formatCanalApTableText,
  isLevelInSegment,
  levelsForCanalSegment,
  markCanalApManualOverride,
  parseCanalApNumber,
  resolveCanalSegment,
  type CanalApCellProvenance,
  type CanalSegment,
} from "@/lib/spineCanalAp";
import { ArrowDownToLine, CornerUpRight, RefreshCw, Ruler, Save } from "lucide-react";

export interface SpineCanalApBoxProps {
  studyId: number;
  draftId?: number | null;
  patientId?: number | null;
  worklistId?: number | null;
  studyInstanceUID?: string | null;
  regionHint?: string | null;
  disabled?: boolean;
  /** When true, allow showing dorsal even if segment must be activated explicitly. */
  forceShowDorsal?: boolean;
  onJumpToProvenance?: (prov: CanalApCellProvenance) => void;
}

interface SpinalRow {
  id: number;
  vertebraLevel: string;
  canalAP: string | null;
}

export default function SpineCanalApBox({
  studyId,
  draftId,
  patientId,
  worklistId,
  studyInstanceUID,
  regionHint,
  disabled,
  forceShowDorsal,
  onJumpToProvenance,
}: SpineCanalApBoxProps) {
  const { toast } = useToast();
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  const railMeasurements = useWorkspaceSelector((s) => s.measurements);
  const mergeField = useWorkspaceSelector((s) => s.mergeField);
  const measurementIntent = useWorkspaceSelector((s) => s.measurementIntent);
  const canalIntentLevel = useWorkspaceSelector((s) => s.canalIntentLevel);
  const setCanalIntentLevel = useWorkspaceSelector((s) => s.setCanalIntentLevel);
  const provenance = useWorkspaceSelector((s) => s.canalApProvenance);
  const setCanalApCellProvenance = useWorkspaceSelector((s) => s.setCanalApCellProvenance);
  const setCanalApProvenance = useWorkspaceSelector((s) => s.setCanalApProvenance);

  const segment: CanalSegment | null = useMemo(() => {
    const fromCtx = canalSegmentFromSpine(reportingContext.spineSegment);
    if (fromCtx) return fromCtx;
    const hay = [
      regionHint,
      reportingContext.region,
      reportingContext.studyDescription,
      ...(reportingContext.regions ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    const resolved = resolveCanalSegment(hay);
    if (resolved) return resolved;
    if (forceShowDorsal) return "dorsal";
    return null;
  }, [reportingContext, regionHint, forceShowDorsal]);

  const levels = useMemo(
    () => (segment ? levelsForCanalSegment(segment) : []),
    [segment],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captureLevel, setCaptureLevel] = useState<string | null>(null);

  const viewerQ = useViewerMeasurements(studyInstanceUID);

  const load = useCallback(async () => {
    if (!studyId || !segment) return;
    setLoading(true);
    try {
      const rows = await api.get<SpinalRow[]>(
        `/api/radiology/report-generator/spinal-measurements?studyId=${studyId}`,
      );
      const next: Record<string, string> = {};
      for (const level of levelsForCanalSegment(segment)) {
        const row = rows.find((r) => r.vertebraLevel === level);
        if (row?.canalAP) next[level] = row.canalAP;
      }
      setValues(next);
    } catch {
      /* empty until first save */
    } finally {
      setLoading(false);
    }
  }, [studyId, segment]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync selected canal intent level into capture mode when MEASURE intent is CANAL_AP.
  useEffect(() => {
    if (measurementIntent !== "CANAL_AP" || !canalIntentLevel || !segment) return;
    if (!isLevelInSegment(segment, canalIntentLevel)) return;
    setCaptureLevel(canalIntentLevel);
  }, [measurementIntent, canalIntentLevel, segment]);

  // When capture mode is on, assign the newest viewer measurement to that level.
  useEffect(() => {
    if (!captureLevel || !viewerQ.data?.length || !segment) return;
    const pending = [...viewerQ.data]
      .filter((m) => m.status !== "ignored")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const newest = pending[0];
    if (!newest) return;
    const num = parseCanalApNumber(newest.value);
    if (!num) return;
    const prevProv = provenance[captureLevel];
    const applied = applyCanalApValue({
      level: captureLevel,
      nextValue: num,
      provenance: prevProv,
    });
    if ("blocked" in applied) {
      toast({
        title: `${captureLevel} is manually edited`,
        description: "Use Refresh from viewer to replace the override.",
      });
      setCaptureLevel(null);
      return;
    }
    setValues((prev) => ({ ...prev, [captureLevel]: applied.value }));
    setCanalApCellProvenance(captureLevel, {
      ...applied.provenance,
      region: segment,
      studyInstanceUID: newest.studyInstanceUID ?? studyInstanceUID ?? null,
      seriesInstanceUID: newest.seriesInstanceUID ?? null,
      sopInstanceUID: newest.sopInstanceUID ?? null,
      frameNumber: newest.frameNumber ?? null,
      viewer: newest.viewerName ?? "viewer",
      capturedAt: newest.createdAt ?? new Date().toISOString(),
      annotationId: newest.id != null ? String(newest.id) : null,
    });
    setCaptureLevel(null);
    toast({
      title: `Assigned ${captureLevel}`,
      description: `${num} mm from viewer measurement`,
    });
  }, [captureLevel, viewerQ.data, toast, provenance, segment, studyInstanceUID]);

  if (!segment || levels.length === 0) return null;
  const activeSegment: CanalSegment = segment;

  function setLevel(level: string, raw: string) {
    const cleaned = raw.replace(/[^\d.,\-]/g, "").replace(/,/g, ".");
    setValues((prev) => ({ ...prev, [level]: cleaned }));
  }

  function commitLevel(level: string) {
    setValues((prev) => {
      const parsed = parseCanalApNumber(prev[level] ?? "");
      if (!parsed) return prev;
      setCanalApCellProvenance(
        level,
        markCanalApManualOverride(provenance[level], level, parsed, activeSegment),
      );
      if (parsed === (prev[level] ?? "")) return prev;
      return { ...prev, [level]: parsed };
    });
  }

  function refreshLevelFromViewer(level: string) {
    const candidates = [...(viewerQ.data ?? [])]
      .filter((m) => m.status !== "ignored")
      .filter((m) => {
        const label = [m.measurementId, m.measurementType, formatViewerMeasurementLabel(m)]
          .filter(Boolean)
          .join(" ");
        const disc = discLevelFromLabel(label);
        return disc === level || measurementIntent === "CANAL_AP";
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const newest = candidates[0];
    if (!newest) {
      toast({ title: "No viewer measurement for this level" });
      return;
    }
    const applied = applyCanalApValue({
      level,
      nextValue: newest.value,
      provenance: provenance[level],
      forceRefresh: true,
    });
    if ("blocked" in applied) return;
    setValues((prev) => ({ ...prev, [level]: applied.value }));
    setCanalApCellProvenance(level, {
      ...applied.provenance,
      region: activeSegment,
      studyInstanceUID: newest.studyInstanceUID ?? studyInstanceUID ?? null,
      seriesInstanceUID: newest.seriesInstanceUID ?? null,
      sopInstanceUID: newest.sopInstanceUID ?? null,
      frameNumber: newest.frameNumber ?? null,
      viewer: newest.viewerName ?? "viewer",
      capturedAt: newest.createdAt ?? new Date().toISOString(),
    });
    toast({ title: `Refreshed ${level}`, description: `${applied.value} mm` });
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const level of levels) {
        const canalAP = parseCanalApNumber(values[level] ?? "") || values[level]?.trim();
        if (!canalAP) continue;
        await api.post("/api/radiology/report-generator/spinal-measurements", {
          studyId,
          draftId: draftId ?? undefined,
          patientId: patientId ?? undefined,
          worklistId: worklistId ?? undefined,
          vertebraLevel: level,
          canalAP,
          stenosisGrade: "none",
        });
      }
      toast({ title: "Canal AP saved" });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: String(e) });
    } finally {
      setSaving(false);
    }
  }

  function pullFromSources(opts?: { forceRefresh?: boolean }) {
    const next = { ...values };
    const nextProv = { ...provenance };
    let n = 0;
    let skipped = 0;
    for (const m of viewerQ.data ?? []) {
      if (m.status === "ignored") continue;
      const label = [
        m.measurementId,
        m.measurementType,
        formatViewerMeasurementLabel(m),
      ]
        .filter(Boolean)
        .join(" ");
      const level = discLevelFromLabel(label);
      if (!level || !(levels as readonly string[]).includes(level)) continue;
      const num = parseCanalApNumber(m.value);
      if (!num) continue;
      const applied = applyCanalApValue({
        level,
        nextValue: num,
        provenance: nextProv[level],
        forceRefresh: opts?.forceRefresh,
      });
      if ("blocked" in applied) {
        skipped += 1;
        continue;
      }
      next[level] = applied.value;
      nextProv[level] = {
        ...applied.provenance,
        region: activeSegment,
        studyInstanceUID: m.studyInstanceUID ?? studyInstanceUID ?? null,
        seriesInstanceUID: m.seriesInstanceUID ?? null,
        sopInstanceUID: m.sopInstanceUID ?? null,
        frameNumber: m.frameNumber ?? null,
        viewer: m.viewerName ?? "viewer",
        capturedAt: m.createdAt ?? new Date().toISOString(),
      };
      n++;
    }
    for (const m of railMeasurements) {
      const level = discLevelFromLabel(m.name);
      if (!level || !(levels as readonly string[]).includes(level)) continue;
      const applied = applyCanalApValue({
        level,
        nextValue: String(m.value),
        provenance: nextProv[level],
        forceRefresh: opts?.forceRefresh,
      });
      if ("blocked" in applied) {
        skipped += 1;
        continue;
      }
      next[level] = applied.value;
      nextProv[level] = { ...applied.provenance, region: activeSegment };
      n++;
    }
    setValues(next);
    setCanalApProvenance(nextProv);
    toast({
      title: n > 0 ? `Pulled ${n} level(s)` : "No matching levels found",
      description:
        skipped > 0
          ? `${skipped} manually edited level(s) protected. Use Refresh per level to override.`
          : n > 0
            ? "Review and Save. Label OHIF calipers with disc levels for auto-match."
            : "Enter values manually, or label viewer calipers with disc levels then Pull again.",
    });
  }

  function insertIntoFindings() {
    const text = formatCanalApTableText(activeSegment, values);
    if (!levels.some((l) => values[l]?.trim())) {
      toast({ variant: "destructive", title: "No values to insert" });
      return;
    }
    mergeField("findings", text, "companion");
    toast({ title: "Canal AP table inserted into findings" });
  }

  return (
    <div
      className="rounded-lg border border-emerald-300/70 bg-emerald-50/30 p-2.5 space-y-2"
      data-testid="spine-canal-ap-box"
      data-segment={activeSegment}
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
            <Ruler className="h-3 w-3" />
            Canal AP
            <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-300 text-emerald-700">
              {canalSegmentBadge(activeSegment)}
            </Badge>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">
            {canalTableTitle(activeSegment)}. Enter mm or Pull from labeled viewer calipers.
            Manual edits are protected from later viewer updates.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse" data-testid="spine-canal-ap-table">
          <thead>
            <tr>
              <th className="border border-border bg-muted/50 px-1 py-0.5 text-left font-semibold">LEVEL</th>
              {levels.map((l) => (
                <th key={l} className="border border-border bg-muted/50 px-1 py-0.5 font-semibold whitespace-nowrap">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-border px-1 py-0.5 font-medium whitespace-nowrap">AP (mm)</td>
              {levels.map((l) => (
                <td key={l} className="border border-border p-0.5">
                  <div className="flex items-center gap-0.5">
                    <Input
                      className={`h-7 min-w-[2.75rem] w-full text-[11px] font-mono text-center px-0.5 ${
                        captureLevel === l ? "ring-2 ring-emerald-500" : ""
                      } ${provenance[l]?.manualOverride ? "border-amber-400" : ""}`}
                      value={values[l] ?? ""}
                      disabled={disabled || loading}
                      placeholder="—"
                      inputMode="decimal"
                      data-testid={`canal-ap-${l}`}
                      title={provenance[l]?.manualOverride ? "Manually edited — protected" : undefined}
                      onChange={(e) => setLevel(l, e.target.value)}
                      onBlur={() => commitLevel(l)}
                      onClick={() => {
                        if (captureLevel) setCaptureLevel(l);
                        setCanalIntentLevel(l);
                      }}
                    />
                    {provenance[l]?.sopInstanceUID || provenance[l]?.seriesInstanceUID ? (
                      <button
                        type="button"
                        className="shrink-0 p-0.5 text-emerald-700 hover:text-emerald-900"
                        title="Jump to source image"
                        data-testid={`canal-jump-${l}`}
                        disabled={disabled || !onJumpToProvenance}
                        onClick={() => onJumpToProvenance?.(provenance[l])}
                      >
                        <CornerUpRight className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1">
        {levels.map((l) => (
          <button
            key={`cap-${l}`}
            type="button"
            disabled={disabled}
            title={`Next viewer measurement → ${l}`}
            className={`rounded px-1.5 py-0.5 text-[9px] font-medium border transition ${
              captureLevel === l
                ? "bg-emerald-600 text-white border-emerald-700"
                : "bg-white border-border text-muted-foreground hover:border-emerald-400"
            }`}
            data-testid={`canal-capture-${l}`}
            onClick={() => {
              setCaptureLevel((cur) => (cur === l ? null : l));
              setCanalIntentLevel(l);
            }}
          >
            {captureLevel === l ? `Capturing ${l}…` : l}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          disabled={disabled || saving}
          onClick={() => void pullFromSources()}
          data-testid="canal-ap-pull"
        >
          <ArrowDownToLine className="h-3 w-3 mr-1" />
          Pull
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          disabled={disabled || saving}
          onClick={() => {
            const level = captureLevel || canalIntentLevel || levels.find((l) => provenance[l]?.manualOverride);
            if (level) refreshLevelFromViewer(level);
            else pullFromSources({ forceRefresh: false });
          }}
          data-testid="canal-ap-refresh"
          title="Refresh selected/override level from viewer"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh from viewer
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          disabled={disabled || saving}
          onClick={() => void saveAll()}
          data-testid="canal-ap-save"
        >
          <Save className="h-3 w-3 mr-1" />
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700"
          disabled={disabled || saving}
          onClick={insertIntoFindings}
          data-testid="canal-ap-insert"
        >
          Insert into findings
        </Button>
      </div>
    </div>
  );
}
