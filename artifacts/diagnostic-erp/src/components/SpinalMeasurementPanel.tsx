import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { Ruler, Trash2, ChevronDown, ChevronUp, Activity, Plus } from "lucide-react";

export interface SpinalMeasurement {
  id: number;
  studyId: number;
  draftId: number | null;
  vertebraLevel: string;
  canalAP: string | null;
  canalTransverse: string | null;
  canalArea: string | null;
  cordAP: string | null;
  cordTransverse: string | null;
  cordArea: string | null;
  discHeight: string | null;
  stenosisGrade: string;
  stenosisNotes: string | null;
  leftForaminal: string;
  rightForaminal: string;
  alignment: string;
  alignmentNotes: string | null;
  measuredBy: string;
  measuredAt: string;
}

interface SpinalMeasurementPanelProps {
  studyId: number;
  draftId?: number | null;
  patientId?: number | null;
  onInsertIntoReport?: (text: string) => void;
}

const VERTEBRAL_LEVELS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7",
  "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12",
  "L1", "L2", "L3", "L4", "L5",
  "S1",
];

const STENOSIS_GRADES = ["none", "mild", "moderate", "severe"] as const;
const FORAMINAL_OPTIONS = ["normal", "mild", "moderate", "severe"] as const;
const ALIGNMENT_OPTIONS = ["normal", "kyphosis", "lordosis", "scoliosis", "listhesis"] as const;

// Auto-stenosis grade based on canal AP diameter (mm) — cervical/lumbar
function autoGradeCanal(canalAP: string, region: string): string {
  const v = parseFloat(canalAP);
  if (Number.isNaN(v)) return "none";
  if (region.startsWith("C")) {
    if (v < 10) return "severe";
    if (v < 13) return "moderate";
    if (v < 15) return "mild";
    return "none";
  }
  if (region.startsWith("L")) {
    if (v < 10) return "severe";
    if (v < 12) return "moderate";
    if (v < 13) return "mild";
    return "none";
  }
  return "none";
}

export default function SpinalMeasurementPanel({ studyId, draftId, patientId, onInsertIntoReport }: SpinalMeasurementPanelProps) {
  const { toast } = useToast();
  const [measurements, setMeasurements] = useState<SpinalMeasurement[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, string>>({
    canalAP: "", canalTransverse: "", canalArea: "",
    cordAP: "", cordTransverse: "", cordArea: "",
    discHeight: "", stenosisGrade: "none", stenosisNotes: "",
    leftForaminal: "normal", rightForaminal: "normal",
    alignment: "normal", alignmentNotes: "",
  });

  const loadMeasurements = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<SpinalMeasurement[]>(`/api/radiology/report-generator/spinal-measurements?studyId=${studyId}`);
      setMeasurements(rows);
    } catch {
      toast({ variant: "destructive", title: "Failed to load measurements" });
    } finally {
      setLoading(false);
    }
  }, [studyId, toast]);

  useEffect(() => {
    void loadMeasurements();
  }, [loadMeasurements]);

  async function saveMeasurement(level: string) {
    setSaving(level);
    try {
      await api.post<SpinalMeasurement>("/api/radiology/report-generator/spinal-measurements", {
        studyId,
        draftId: draftId ?? undefined,
        patientId: patientId ?? undefined,
        vertebraLevel: level,
        canalAP: form.canalAP || undefined,
        canalTransverse: form.canalTransverse || undefined,
        canalArea: form.canalArea || undefined,
        cordAP: form.cordAP || undefined,
        cordTransverse: form.cordTransverse || undefined,
        cordArea: form.cordArea || undefined,
        discHeight: form.discHeight || undefined,
        stenosisGrade: form.stenosisGrade || "none",
        stenosisNotes: form.stenosisNotes || undefined,
        leftForaminal: form.leftForaminal || "normal",
        rightForaminal: form.rightForaminal || "normal",
        alignment: form.alignment || "normal",
        alignmentNotes: form.alignmentNotes || undefined,
      });
      toast({ title: `Saved ${level}` });
      await loadMeasurements();
      setExpandedLevel(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: String(e) });
    } finally {
      setSaving(null);
    }
  }

  async function deleteMeasurement(id: number) {
    try {
      await api.delete(`/api/radiology/report-generator/spinal-measurements/${id}`);
      await loadMeasurements();
      toast({ title: "Deleted" });
    } catch (e) {
      toast({ variant: "destructive", title: "Delete failed", description: String(e) });
    }
  }

  function generateReportText() {
    const lines: string[] = [];
    for (const m of measurements) {
      const parts: string[] = [];
      if (m.canalAP) parts.push(`canal AP ${m.canalAP} mm`);
      if (m.canalTransverse) parts.push(`transverse ${m.canalTransverse} mm`);
      if (m.canalArea) parts.push(`area ${m.canalArea} mm²`);
      if (m.cordAP) parts.push(`cord AP ${m.cordAP} mm`);
      if (m.cordTransverse) parts.push(`cord transverse ${m.cordTransverse} mm`);
      if (m.cordArea) parts.push(`cord area ${m.cordArea} mm²`);
      if (m.discHeight) parts.push(`disc height ${m.discHeight} mm`);
      const main = `${m.vertebraLevel}: ${parts.join(", ") || "no measurements recorded"}`;
      let grade = "";
      if (m.stenosisGrade !== "none") grade += ` ${m.stenosisGrade} canal stenosis`;
      if (m.leftForaminal !== "normal") grade += ` left foraminal ${m.leftForaminal}`;
      if (m.rightForaminal !== "normal") grade += ` right foraminal ${m.rightForaminal}`;
      if (m.alignment !== "normal") grade += ` ${m.alignment}`;
      lines.push(main + (grade ? `.` + grade : `.`));
      if (m.stenosisNotes) lines.push(`  Note: ${m.stenosisNotes}`);
      if (m.alignmentNotes) lines.push(`  Alignment note: ${m.alignmentNotes}`);
    }
    return lines.join("\n");
  }

  function handleInsert() {
    const text = generateReportText();
    if (onInsertIntoReport) {
      onInsertIntoReport(text);
      toast({ title: "Inserted into findings" });
    }
  }

  function openLevel(level: string) {
    const existing = measurements.find((m) => m.vertebraLevel === level);
    if (existing) {
      setForm({
        canalAP: existing.canalAP ?? "",
        canalTransverse: existing.canalTransverse ?? "",
        canalArea: existing.canalArea ?? "",
        cordAP: existing.cordAP ?? "",
        cordTransverse: existing.cordTransverse ?? "",
        cordArea: existing.cordArea ?? "",
        discHeight: existing.discHeight ?? "",
        stenosisGrade: existing.stenosisGrade,
        stenosisNotes: existing.stenosisNotes ?? "",
        leftForaminal: existing.leftForaminal,
        rightForaminal: existing.rightForaminal,
        alignment: existing.alignment,
        alignmentNotes: existing.alignmentNotes ?? "",
      });
    } else {
      setForm({
        canalAP: "", canalTransverse: "", canalArea: "",
        cordAP: "", cordTransverse: "", cordArea: "",
        discHeight: "", stenosisGrade: "none", stenosisNotes: "",
        leftForaminal: "normal", rightForaminal: "normal",
        alignment: "normal", alignmentNotes: "",
      });
    }
    setExpandedLevel(level);
  }

  function updateForm(key: string, value: string) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "canalAP") {
        const grade = autoGradeCanal(value, expandedLevel || "");
        if (grade !== "none") next.stenosisGrade = grade;
      }
      return next;
    });
  }

  function badgeForGrade(grade: string) {
    if (grade === "severe") return <Badge variant="destructive" className="text-[10px]">Severe</Badge>;
    if (grade === "moderate") return <Badge variant="default" className="text-[10px] bg-orange-500">Moderate</Badge>;
    if (grade === "mild") return <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-600">Mild</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Normal</Badge>;
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Ruler size={14} />
          Spinal Measurements
          {measurements.length > 0 && (
            <Badge variant="secondary" className="text-[11px]">{measurements.length} levels</Badge>
          )}
        </h3>
        <div className="flex gap-1">
          {measurements.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleInsert}>
              <Activity size={12} className="mr-1" /> Insert into Report
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Measure spinal canal and cord at each vertebral level. Auto-grades stenosis based on AP diameter.
      </p>

      {/* Existing measurements summary */}
      {measurements.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {measurements.map((m) => (
            <button
              key={m.id}
              onClick={() => openLevel(m.vertebraLevel)}
              className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 ${
                expandedLevel === m.vertebraLevel ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-accent"
              }`}
            >
              {m.vertebraLevel}
              {badgeForGrade(m.stenosisGrade)}
              {(m.leftForaminal !== "normal" || m.rightForaminal !== "normal") && (
                <span className="text-[9px] opacity-70">F</span>
              )}
              <Trash2 size={10} className="opacity-50 hover:opacity-100 ml-0.5" onClick={(e) => { e.stopPropagation(); void deleteMeasurement(m.id); }} />
            </button>
          ))}
        </div>
      )}

      {/* Level selector */}
      <div className="flex flex-wrap gap-1">
        {VERTEBRAL_LEVELS.map((level) => {
          const hasData = measurements.some((m) => m.vertebraLevel === level);
          return (
            <button
              key={level}
              onClick={() => openLevel(level)}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                expandedLevel === level
                  ? "bg-primary text-primary-foreground border-primary"
                  : hasData
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-background hover:bg-muted"
              }`}
            >
              {level}
            </button>
          );
        })}
      </div>

      {/* Expanded form */}
      {expandedLevel && (
        <div className="border rounded-lg p-3 space-y-3 bg-background">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{expandedLevel}</span>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs" onClick={() => void saveMeasurement(expandedLevel)} disabled={!!saving}>
                {saving === expandedLevel ? <span className="animate-spin">...</span> : <Plus size={12} className="mr-1" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpandedLevel(null)}>
                <ChevronUp size={14} />
              </Button>
            </div>
          </div>

          {/* Canal */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">Spinal Canal</Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px]">AP (mm)</Label>
                <Input className="h-7 text-xs" value={form.canalAP} onChange={(e) => updateForm("canalAP", e.target.value)} placeholder="e.g. 14" />
              </div>
              <div>
                <Label className="text-[10px]">Transverse (mm)</Label>
                <Input className="h-7 text-xs" value={form.canalTransverse} onChange={(e) => updateForm("canalTransverse", e.target.value)} placeholder="e.g. 18" />
              </div>
              <div>
                <Label className="text-[10px]">Area (mm²)</Label>
                <Input className="h-7 text-xs" value={form.canalArea} onChange={(e) => updateForm("canalArea", e.target.value)} placeholder="e.g. 200" />
              </div>
            </div>
          </div>

          {/* Cord */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">Spinal Cord</Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px]">AP (mm)</Label>
                <Input className="h-7 text-xs" value={form.cordAP} onChange={(e) => updateForm("cordAP", e.target.value)} placeholder="e.g. 7" />
              </div>
              <div>
                <Label className="text-[10px]">Transverse (mm)</Label>
                <Input className="h-7 text-xs" value={form.cordTransverse} onChange={(e) => updateForm("cordTransverse", e.target.value)} placeholder="e.g. 9" />
              </div>
              <div>
                <Label className="text-[10px]">Area (mm²)</Label>
                <Input className="h-7 text-xs" value={form.cordArea} onChange={(e) => updateForm("cordArea", e.target.value)} placeholder="e.g. 60" />
              </div>
            </div>
          </div>

          {/* Disc */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Disc Height (mm)</Label>
              <Input className="h-7 text-xs" value={form.discHeight} onChange={(e) => updateForm("discHeight", e.target.value)} placeholder="e.g. 8" />
            </div>
            <div>
              <Label className="text-[10px]">Stenosis Grade</Label>
              <select className="w-full h-7 text-xs border rounded px-2 bg-background" value={form.stenosisGrade} onChange={(e) => updateForm("stenosisGrade", e.target.value)}>
                {STENOSIS_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* Foraminal */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Left Foraminal</Label>
              <select className="w-full h-7 text-xs border rounded px-2 bg-background" value={form.leftForaminal} onChange={(e) => updateForm("leftForaminal", e.target.value)}>
                {FORAMINAL_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Right Foraminal</Label>
              <select className="w-full h-7 text-xs border rounded px-2 bg-background" value={form.rightForaminal} onChange={(e) => updateForm("rightForaminal", e.target.value)}>
                {FORAMINAL_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* Alignment */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Alignment</Label>
              <select className="w-full h-7 text-xs border rounded px-2 bg-background" value={form.alignment} onChange={(e) => updateForm("alignment", e.target.value)}>
                {ALIGNMENT_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px]">Alignment Notes</Label>
              <Input className="h-7 text-xs" value={form.alignmentNotes} onChange={(e) => updateForm("alignmentNotes", e.target.value)} placeholder="e.g. Grade 1" />
            </div>
          </div>

          <div>
            <Label className="text-[10px]">Stenosis Notes</Label>
            <Input className="h-7 text-xs" value={form.stenosisNotes} onChange={(e) => updateForm("stenosisNotes", e.target.value)} placeholder="Additional notes..." />
          </div>
        </div>
      )}

      {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
    </div>
  );
}
