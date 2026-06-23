/**
 * Phase 10A: Measurement Assistant Panel
 * Guided structured measurement entry for MRI Brain, MRI Spine, Breast, Thyroid,
 * Liver, Kidney, Lung, Pelvis with normal ranges and trend display.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Ruler, AlertTriangle, TrendingUp, TrendingDown, Minus, Check,
  ChevronDown, RotateCcw, Save, History,
} from "lucide-react";

interface MeasurementField {
  label: string;
  measurementType: string;
  unit: string;
  normalRangeLow?: number;
  normalRangeHigh?: number;
  notes?: string;
}

interface SavedMeasurement {
  id: number;
  label: string;
  value: string;
  unit: string | null;
  isAbnormal: boolean | null;
  normalRangeLow: number | null;
  normalRangeHigh: number | null;
  reportedBy: string | null;
  reportedAt: string | null;
  createdAt: string;
}

interface Props {
  patientId?: number;
  studyId?: number;
  orderId?: number;
  modality?: string;
  bodyPart?: string;
}

const STUDY_TYPES: Array<{ key: string; label: string; modality: string; bodyPart: string }> = [
  { key: "MRI_BRAIN", label: "MRI Brain", modality: "MRI", bodyPart: "BRAIN" },
  { key: "MRI_SPINE", label: "MRI Spine", modality: "MRI", bodyPart: "SPINE" },
  { key: "USG_BREAST", label: "USG Breast", modality: "USG", bodyPart: "BREAST" },
  { key: "USG_THYROID", label: "USG Thyroid", modality: "USG", bodyPart: "THYROID" },
  { key: "USG_LIVER", label: "USG Liver/Abdomen", modality: "USG", bodyPart: "LIVER" },
  { key: "USG_KIDNEY", label: "USG Kidney", modality: "USG", bodyPart: "KIDNEY" },
  { key: "CT_LUNG", label: "CT Chest/Lung", modality: "CT", bodyPart: "LUNG" },
  { key: "USG_PELVIS", label: "USG Pelvis", modality: "USG", bodyPart: "PELVIS" },
];

function getNormalStatus(value: string, field: MeasurementField): "normal" | "abnormal" | "unknown" {
  if (field.measurementType === "classification" || field.measurementType === "position") return "unknown";
  const v = parseFloat(value);
  if (isNaN(v)) return "unknown";
  if (field.normalRangeLow !== undefined && v < field.normalRangeLow) return "abnormal";
  if (field.normalRangeHigh !== undefined && v > field.normalRangeHigh) return "abnormal";
  if (field.normalRangeLow !== undefined || field.normalRangeHigh !== undefined) return "normal";
  return "unknown";
}

export default function MeasurementAssistantPanel({ patientId, studyId, orderId, modality, bodyPart }: Props) {
  const { toast } = useToast();
  const [selectedStudyType, setSelectedStudyType] = useState<string>("");
  const [template, setTemplate] = useState<MeasurementField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SavedMeasurement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Auto-select study type from modality/bodyPart props
  useEffect(() => {
    if (!modality || !bodyPart) return;
    const mod = modality.toUpperCase();
    const bp = bodyPart.toUpperCase();
    const match = STUDY_TYPES.find((s) =>
      s.modality === mod && (bp.includes(s.bodyPart) || s.bodyPart.includes(bp))
    );
    if (match) setSelectedStudyType(match.key);
  }, [modality, bodyPart]);

  // Load template when study type changes
  useEffect(() => {
    if (!selectedStudyType) { setTemplate([]); return; }
    const st = STUDY_TYPES.find((s) => s.key === selectedStudyType);
    if (!st) return;
    setLoadingTemplate(true);
    fetch(`/api/radiology-lesions/measurement-templates?modality=${st.modality}&bodyPart=${st.bodyPart}`)
      .then((r) => r.json())
      .then((data) => {
        setTemplate(data.template ?? []);
        setValues({});
      })
      .catch(() => toast({ title: "Could not load template", variant: "destructive" }))
      .finally(() => setLoadingTemplate(false));
  }, [selectedStudyType, toast]);

  // Load history
  const fetchHistory = useCallback(async () => {
    if (!patientId) return;
    setLoadingHistory(true);
    try {
      const st = STUDY_TYPES.find((s) => s.key === selectedStudyType);
      const params = new URLSearchParams({ patientId: String(patientId) });
      if (studyId) params.set("studyId", String(studyId));
      if (st) { params.set("modality", st.modality); params.set("bodyPart", st.bodyPart); }
      const r = await fetch(`/api/radiology-lesions/measurements?${params}`);
      const data = await r.json();
      setHistory(data.measurements ?? []);
    } catch { /* ignore */ }
    finally { setLoadingHistory(false); }
  }, [patientId, studyId, selectedStudyType]);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const handleSave = async () => {
    if (!patientId || template.length === 0) return;
    const st = STUDY_TYPES.find((s) => s.key === selectedStudyType);
    if (!st) return;
    const filled = template.filter((f) => values[f.label]?.trim());
    if (filled.length === 0) {
      toast({ title: "Enter at least one measurement", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const measurements = filled.map((f) => {
        const val = values[f.label].trim();
        const status = getNormalStatus(val, f);
        return {
          measurementType: f.measurementType,
          label: f.label,
          value: val,
          unit: f.unit || undefined,
          normalRangeLow: f.normalRangeLow,
          normalRangeHigh: f.normalRangeHigh,
          isAbnormal: status === "abnormal",
        };
      });
      const r = await fetch("/api/radiology-lesions/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          studyId,
          orderId,
          modality: st.modality,
          bodyPart: st.bodyPart,
          measurements,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: `${measurements.length} measurement${measurements.length > 1 ? "s" : ""} saved` });
      if (showHistory) fetchHistory();
    } catch {
      toast({ title: "Could not save measurements", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const abnormalCount = template.filter((f) => {
    const v = values[f.label];
    return v && getNormalStatus(v, f) === "abnormal";
  }).length;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ruler size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Measurement Assistant</span>
          {abnormalCount > 0 && (
            <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
              {abnormalCount} abnormal
            </span>
          )}
        </div>
        {patientId && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowHistory(!showHistory)}>
            <History size={11} className="mr-1" /> {showHistory ? "Form" : "History"}
          </Button>
        )}
      </div>

      {/* Study type selector */}
      <div className="px-3 py-2 border-b border-border bg-muted/10">
        <div className="flex items-center gap-1.5 flex-wrap">
          {STUDY_TYPES.map((st) => (
            <button
              key={st.key}
              onClick={() => setSelectedStudyType(selectedStudyType === st.key ? "" : st.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                selectedStudyType === st.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-card-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[450px] overflow-y-auto p-3 space-y-3">
        {showHistory ? (
          <div className="space-y-2">
            {loadingHistory ? (
              <div className="text-center py-4 text-xs text-muted-foreground">Loading history...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground">No saved measurements for this patient{selectedStudyType ? " / study type" : ""}.</div>
            ) : (
              history.map((m) => (
                <div key={m.id} className="border border-border rounded-lg p-2 text-xs space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                      {m.isAbnormal === true && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">Abnormal</span>}
                      {m.isAbnormal === false && <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded">Normal</span>}
                    </div>
                  </div>
                  {(m.normalRangeLow != null || m.normalRangeHigh != null) && (
                    <div className="text-[10px] text-muted-foreground">
                      Normal: {m.normalRangeLow ?? "—"} – {m.normalRangeHigh ?? "—"} {m.unit}
                    </div>
                  )}
                  {m.reportedAt && (
                    <div className="text-[9px] text-muted-foreground">{new Date(m.reportedAt).toLocaleDateString()} by {m.reportedBy}</div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : !selectedStudyType ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            Select a study type above to load the measurement template.
          </div>
        ) : loadingTemplate ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Loading template...</div>
        ) : template.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">No measurement template available for this study type.</div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">Enter measurements. Abnormal values are flagged automatically.</p>
            {template.map((field) => {
              const val = values[field.label] ?? "";
              const status = val ? getNormalStatus(val, field) : "unknown";
              return (
                <div key={field.label} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate">{field.label}</div>
                    {(field.normalRangeLow !== undefined || field.normalRangeHigh !== undefined) && (
                      <div className="text-[9px] text-muted-foreground">
                        Normal: {field.normalRangeLow ?? "—"}–{field.normalRangeHigh ?? "—"} {field.unit}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Input
                      value={val}
                      onChange={(e) => setValues((prev) => ({ ...prev, [field.label]: e.target.value }))}
                      className={`h-7 w-20 text-xs text-right font-mono ${
                        status === "abnormal" ? "border-red-400 bg-red-50" : status === "normal" ? "border-green-400" : ""
                      }`}
                      placeholder="—"
                      type={field.measurementType === "linear" || field.measurementType === "volume" || field.measurementType === "density" ? "number" : "text"}
                    />
                    <span className="text-[10px] text-muted-foreground w-8 flex-shrink-0">{field.unit}</span>
                    <div className="w-4 flex-shrink-0">
                      {status === "normal" && <Check size={12} className="text-green-500" />}
                      {status === "abnormal" && <AlertTriangle size={12} className="text-red-500" />}
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button size="sm" className="text-xs h-7 flex-1" onClick={handleSave} disabled={saving || !patientId}>
                <Save size={12} className="mr-1" /> {saving ? "Saving..." : "Save Measurements"}
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setValues({})}>
                <RotateCcw size={12} />
              </Button>
            </div>

            <div className="text-[9px] text-amber-600 flex items-center gap-1">
              <AlertTriangle size={9} /> AI Draft – Requires Radiologist Review
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
