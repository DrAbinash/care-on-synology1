/**
 * SpineCanalApBox — disc-level canal AP table under MEASURE for LS / cervical MRI.
 * Persists via /spinal-measurements (vertebraLevel = disc label e.g. L4-L5).
 * Manual override + pull from viewer_measurements / MEASURE rail by level label.
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
  canalSegmentFromSpine,
  canalTableTitle,
  discLevelFromLabel,
  formatCanalApTableText,
  levelsForCanalSegment,
  parseCanalApNumber,
  resolveCanalSegment,
  type CanalSegment,
} from "@/lib/spineCanalAp";
import { ArrowDownToLine, Ruler, Save } from "lucide-react";

export interface SpineCanalApBoxProps {
  /** radiology_studies.id preferred; worklist id acceptable as stable study key */
  studyId: number;
  draftId?: number | null;
  patientId?: number | null;
  worklistId?: number | null;
  studyInstanceUID?: string | null;
  /** Region / study description / protocol for LS vs cervical */
  regionHint?: string | null;
  disabled?: boolean;
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
}: SpineCanalApBoxProps) {
  const { toast } = useToast();
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  const railMeasurements = useWorkspaceSelector((s) => s.measurements);
  const mergeField = useWorkspaceSelector((s) => s.mergeField);

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
    return resolveCanalSegment(hay);
  }, [reportingContext, regionHint]);

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

  // When capture mode is on, assign the newest viewer measurement to that level.
  useEffect(() => {
    if (!captureLevel || !viewerQ.data?.length) return;
    const pending = [...viewerQ.data]
      .filter((m) => m.status !== "ignored")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const newest = pending[0];
    if (!newest) return;
    const num = parseCanalApNumber(newest.value);
    if (!num) return;
    setValues((prev) => ({ ...prev, [captureLevel]: num }));
    setCaptureLevel(null);
    toast({
      title: `Assigned ${captureLevel}`,
      description: `${num} mm from viewer measurement`,
    });
  }, [captureLevel, viewerQ.data, toast]);

  if (!segment || levels.length === 0) return null;
  const activeSegment: CanalSegment = segment;

  function setLevel(level: string, raw: string) {
    // Allow in-progress decimals ("11.") — only strip illegal chars while typing.
    const cleaned = raw.replace(/[^\d.,\-]/g, "").replace(/,/g, ".");
    setValues((prev) => ({ ...prev, [level]: cleaned }));
  }

  function commitLevel(level: string) {
    setValues((prev) => {
      const parsed = parseCanalApNumber(prev[level] ?? "");
      if (parsed === (prev[level] ?? "")) return prev;
      return { ...prev, [level]: parsed };
    });
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

  function pullFromSources() {
    const next = { ...values };
    let n = 0;
    // Prefer viewer_measurements with disc labels in type / id text
    for (const m of viewerQ.data ?? []) {
      if (m.status === "ignored") continue;
      const label = [
        m.measurementId,
        m.measurementType,
        formatViewerMeasurementLabel(m),
        // imageCoordinates sometimes holds label JSON — skip
      ]
        .filter(Boolean)
        .join(" ");
      const level = discLevelFromLabel(label);
      if (!level || !(levels as readonly string[]).includes(level)) continue;
      const num = parseCanalApNumber(m.value);
      if (!num) continue;
      next[level] = num;
      n++;
    }
    // MEASURE rail Zustand rows
    for (const m of railMeasurements) {
      const level = discLevelFromLabel(m.name);
      if (!level || !(levels as readonly string[]).includes(level)) continue;
      next[level] = String(m.value);
      n++;
    }
    setValues(next);
    toast({
      title: n > 0 ? `Pulled ${n} level(s)` : "No matching levels found",
      description:
        n > 0
          ? "Review and Save. Label OHIF calipers L1-L2…L5-S1 (or C2-C3…) for auto-match."
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
              {activeSegment === "cervical" ? "Cervical" : "LS Spine"}
            </Badge>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">
            {canalTableTitle(activeSegment)}. Enter mm or Pull from labeled viewer calipers. Capture assigns the latest viewer measure to a level.
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
                  <Input
                    className={`h-7 min-w-[2.75rem] w-full text-[11px] font-mono text-center px-0.5 ${
                      captureLevel === l ? "ring-2 ring-emerald-500" : ""
                    }`}
                    value={values[l] ?? ""}
                    disabled={disabled || loading}
                    placeholder="—"
                    inputMode="decimal"
                    data-testid={`canal-ap-${l}`}
                    onChange={(e) => setLevel(l, e.target.value)}
                    onBlur={() => commitLevel(l)}
                    onClick={() => {
                      if (captureLevel) setCaptureLevel(l);
                    }}
                  />
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
            onClick={() => setCaptureLevel((cur) => (cur === l ? null : l))}
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
