import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Ruler, AlertTriangle, TrendingUp, TrendingDown, Minus, Check,
  ChevronDown, RotateCcw, Save, History, Sparkles, Volume2
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
  onMeasurementsChange?: (compiledText: string, calculations: Record<string, any>) => void;
  voiceTextCommand?: string;
  initialValues?: Record<string, string>;
}

const STUDY_TYPES: Array<{ key: string; label: string; modality: string; bodyPart: string }> = [
  { key: "MRI_BRAIN", label: "MRI Brain", modality: "MRI", bodyPart: "BRAIN" },
  { key: "MRI_SPINE", label: "MRI Spine", modality: "MRI", bodyPart: "SPINE" },
  { key: "CT", label: "CT Scan", modality: "CT", bodyPart: "GENERAL" },
  { key: "USG", label: "Ultrasound General", modality: "US", bodyPart: "GENERAL" },
  { key: "OBSTETRIC", label: "Obstetric USG", modality: "US", bodyPart: "OBSTETRIC" },
  { key: "DOPPLER", label: "Doppler Ultrasound", modality: "US", bodyPart: "DOPPLER" },
  { key: "MAMMOGRAPHY", label: "Mammography", modality: "MG", bodyPart: "BREAST" }
];

const LOCAL_TEMPLATES: Record<string, MeasurementField[]> = {
  MRI_BRAIN: [
    { label: "Midline Shift", measurementType: "linear", unit: "mm", normalRangeHigh: 2 },
    { label: "Maximum Lesion Diameter", measurementType: "linear", unit: "mm" },
    { label: "Tumor Axis 1 (L)", measurementType: "linear", unit: "mm" },
    { label: "Tumor Axis 2 (W)", measurementType: "linear", unit: "mm" },
    { label: "Tumor Axis 3 (H)", measurementType: "linear", unit: "mm" },
    { label: "Hematoma Axis A", measurementType: "linear", unit: "mm" },
    { label: "Hematoma Axis B", measurementType: "linear", unit: "mm" },
    { label: "Hematoma Axis C", measurementType: "linear", unit: "mm" },
    { label: "Frontal Horn Width", measurementType: "linear", unit: "mm" },
    { label: "Max Inner Skull Diameter", measurementType: "linear", unit: "mm" },
    { label: "Callosal Angle", measurementType: "linear", unit: "deg", normalRangeLow: 100, normalRangeHigh: 140 },
    { label: "Third Ventricle Width", measurementType: "linear", unit: "mm", normalRangeHigh: 6 },
    { label: "Subdural Thickness", measurementType: "linear", unit: "mm", normalRangeHigh: 2 },
    { label: "Epidural Thickness", measurementType: "linear", unit: "mm", normalRangeHigh: 1 },
    { label: "Infarct Size", measurementType: "linear", unit: "mm" },
    { label: "Abscess Size", measurementType: "linear", unit: "mm" },
    { label: "Pituitary Height", measurementType: "linear", unit: "mm", normalRangeHigh: 9 },
    { label: "Pituitary Width", measurementType: "linear", unit: "mm", normalRangeHigh: 12 },
    { label: "Pituitary Depth", measurementType: "linear", unit: "mm", normalRangeHigh: 9 },
    { label: "Optic Nerve Sheath Diameter", measurementType: "linear", unit: "mm", normalRangeHigh: 5.5 },
    { label: "Ventricular Asymmetry", measurementType: "linear", unit: "ratio", normalRangeHigh: 1.2 },
    { label: "Posterior Fossa Lesion Size", measurementType: "linear", unit: "mm" }
  ],
  MRI_SPINE: [
    { label: "AP Canal Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 12 },
    { label: "Sagittal Canal Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 12 },
    { label: "Foraminal Height", measurementType: "linear", unit: "mm", normalRangeLow: 8 },
    { label: "Foraminal Width", measurementType: "linear", unit: "mm", normalRangeLow: 3 },
    { label: "Disc Height", measurementType: "linear", unit: "mm" },
    { label: "Disc Protrusion Size", measurementType: "linear", unit: "mm", normalRangeHigh: 2 },
    { label: "Disc Extrusion Size", measurementType: "linear", unit: "mm", normalRangeHigh: 0 },
    { label: "Spondylolisthesis Displacement", measurementType: "linear", unit: "mm", normalRangeHigh: 0 },
    { label: "Vertebral Body Diameter", measurementType: "linear", unit: "mm" },
    { label: "Cord Compression", measurementType: "text", unit: "type" },
    { label: "Conus Level", measurementType: "text", unit: "level" },
    { label: "Canal Stenosis Grade", measurementType: "text", unit: "grade" },
    { label: "Foraminal Stenosis Grade", measurementType: "text", unit: "grade" },
    { label: "Cobb Angle", measurementType: "linear", unit: "deg", normalRangeHigh: 10 },
    { label: "Kyphosis Angle", measurementType: "linear", unit: "deg" },
    { label: "Lordosis Angle", measurementType: "linear", unit: "deg" },
    { label: "Scoliosis Angle", measurementType: "linear", unit: "deg", normalRangeHigh: 10 },
    { label: "Compression Height Loss %", measurementType: "linear", unit: "%", normalRangeHigh: 10 }
  ],
  CT: [
    { label: "Hematoma Axis A", measurementType: "linear", unit: "mm" },
    { label: "Hematoma Axis B", measurementType: "linear", unit: "mm" },
    { label: "Hematoma Axis C", measurementType: "linear", unit: "mm" },
    { label: "Pulmonary Nodule Size", measurementType: "linear", unit: "mm", normalRangeHigh: 4 },
    { label: "Lymph Node Size", measurementType: "linear", unit: "mm", normalRangeHigh: 10 },
    { label: "Pleural Effusion Estimation", measurementType: "linear", unit: "ml" },
    { label: "Ascites Estimation", measurementType: "text", unit: "grading" },
    { label: "Liver Lesion Size", measurementType: "linear", unit: "mm" },
    { label: "Kidney Lesion Size", measurementType: "linear", unit: "mm" },
    { label: "Adrenal Lesion Size", measurementType: "linear", unit: "mm" },
    { label: "Pancreatic Lesion Size", measurementType: "linear", unit: "mm" },
    { label: "Aortic Diameter", measurementType: "linear", unit: "mm", normalRangeHigh: 40 },
    { label: "Aneurysm Diameter", measurementType: "linear", unit: "mm", normalRangeHigh: 0 },
    { label: "Renal Stone Size", measurementType: "linear", unit: "mm" },
    { label: "HU Density Value", measurementType: "density", unit: "HU" }
  ],
  USG: [
    { label: "Liver Longitudinal Span", measurementType: "linear", unit: "cm", normalRangeHigh: 15 },
    { label: "Gallbladder Wall Thickness", measurementType: "linear", unit: "mm", normalRangeHigh: 3 },
    { label: "CBD Diameter", measurementType: "linear", unit: "mm", normalRangeHigh: 6 },
    { label: "Portal Vein Diameter", measurementType: "linear", unit: "mm", normalRangeHigh: 13 },
    { label: "Spleen Length", measurementType: "linear", unit: "cm", normalRangeHigh: 12 },
    { label: "Right Kidney Length", measurementType: "linear", unit: "cm", normalRangeLow: 9, normalRangeHigh: 12 },
    { label: "Left Kidney Length", measurementType: "linear", unit: "cm", normalRangeLow: 9, normalRangeHigh: 12 },
    { label: "Urinary Bladder Volume", measurementType: "linear", unit: "ml" },
    { label: "Prostate Volume", measurementType: "linear", unit: "cc" },
    { label: "Uterus Length", measurementType: "linear", unit: "cm" },
    { label: "Endometrial Thickness", measurementType: "linear", unit: "mm", normalRangeHigh: 14 },
    { label: "Right Ovary Volume", measurementType: "linear", unit: "cc" },
    { label: "Left Ovary Volume", measurementType: "linear", unit: "cc" },
    { label: "Fibroid Size", measurementType: "linear", unit: "mm" },
    { label: "Cyst Size", measurementType: "linear", unit: "mm" }
  ],
  OBSTETRIC: [
    { label: "CRL (Crown Rump Length)", measurementType: "linear", unit: "mm" },
    { label: "GS (Gestational Sac)", measurementType: "linear", unit: "mm" },
    { label: "YS (Yolk Sac)", measurementType: "linear", unit: "mm" },
    { label: "MSD (Mean Sac Diameter)", measurementType: "linear", unit: "mm" },
    { label: "BPD (Biparietal Diameter)", measurementType: "linear", unit: "mm" },
    { label: "HC (Head Circumference)", measurementType: "linear", unit: "mm" },
    { label: "AC (Abdominal Circumference)", measurementType: "linear", unit: "mm" },
    { label: "FL (Femur Length)", measurementType: "linear", unit: "mm" },
    { label: "HL (Humerus Length)", measurementType: "linear", unit: "mm" },
    { label: "AFI (Amniotic Fluid Index)", measurementType: "linear", unit: "cm", normalRangeLow: 5, normalRangeHigh: 25 },
    { label: "Placenta Location", measurementType: "text", unit: "site" },
    { label: "Liquor Volume", measurementType: "text", unit: "type" },
    { label: "Fetal Presentation", measurementType: "text", unit: "type" },
    { label: "FHR (Fetal Heart Rate)", measurementType: "linear", unit: "bpm", normalRangeLow: 110, normalRangeHigh: 160 },
    { label: "Cervical Length", measurementType: "linear", unit: "mm", normalRangeLow: 25 }
  ],
  DOPPLER: [
    { label: "PSV (Peak Systolic Velocity)", measurementType: "linear", unit: "cm/s" },
    { label: "EDV (End Diastolic Velocity)", measurementType: "linear", unit: "cm/s" },
    { label: "Mean Velocity", measurementType: "linear", unit: "cm/s" },
    { label: "Velocity Ratio", measurementType: "linear", unit: "ratio" },
    { label: "Peak Gradient", measurementType: "linear", unit: "mmHg" }
  ],
  MAMMOGRAPHY: [
    { label: "Mass Size", measurementType: "linear", unit: "mm", normalRangeHigh: 10 },
    { label: "Clock Position", measurementType: "text", unit: "o'clock" },
    { label: "Distance from Nipple", measurementType: "linear", unit: "mm" },
    { label: "Calcification Distribution", measurementType: "text", unit: "type" },
    { label: "Architectural Distortion", measurementType: "text", unit: "presence" },
    { label: "Breast Density", measurementType: "text", unit: "category" },
    { label: "BI-RADS Category", measurementType: "linear", unit: "score" }
  ]
};

function getNormalStatus(value: string, field: MeasurementField): "normal" | "abnormal" | "unknown" {
  if (field.measurementType === "classification" || field.measurementType === "position" || field.measurementType === "text") return "unknown";
  const v = parseFloat(value);
  if (isNaN(v)) return "unknown";
  if (field.normalRangeLow !== undefined && v < field.normalRangeLow) return "abnormal";
  if (field.normalRangeHigh !== undefined && v > field.normalRangeHigh) return "abnormal";
  if (field.normalRangeLow !== undefined || field.normalRangeHigh !== undefined) return "normal";
  return "unknown";
}

function wordToNum(word: string): string {
  const map: Record<string, string> = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10"
  };
  return map[word.toLowerCase()] ?? word;
}

export default function MeasurementAssistantPanel({
  patientId, studyId, orderId, modality, bodyPart, onMeasurementsChange, voiceTextCommand, initialValues
}: Props) {
  const { toast } = useToast();
  const [selectedStudyType, setSelectedStudyType] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SavedMeasurement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load initialValues (imported measurements from viewer)
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues(prev => ({ ...prev, ...initialValues }));
    }
  }, [initialValues]);

  // Auto-select study type from modality/bodyPart props
  useEffect(() => {
    if (!modality) return;
    const mod = modality.toUpperCase();
    const bp = (bodyPart || "").toUpperCase();

    let key = "USG";
    if (mod === "MRI") {
      key = bp.includes("SPINE") || bp.includes("LUMBAR") || bp.includes("CERVICAL") || bp.includes("LS") ? "MRI_SPINE" : "MRI_BRAIN";
    } else if (mod === "CT") {
      key = "CT";
    } else if (mod === "MG" || bp.includes("BREAST") || bp.includes("MAMMOGRAPHY")) {
      key = "MAMMOGRAPHY";
    } else if (mod === "US" || mod === "USG") {
      if (bp.includes("OBSTETRIC") || bp.includes("PREGNANCY") || bp.includes("FETAL")) key = "OBSTETRIC";
      else if (bp.includes("DOPPLER")) key = "DOPPLER";
      else key = "USG";
    }

    setSelectedStudyType(key);
  }, [modality, bodyPart]);

  // Voice Command Parser integration
  useEffect(() => {
    if (!voiceTextCommand) return;
    const normalized = voiceTextCommand.toLowerCase();

    // 1. Midline shift
    const midlineMatch = normalized.match(/(?:midline shift|midline)\s*(?:of|is)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:mm|millimetre|millimetres)?/);
    if (midlineMatch) {
      const val = wordToNum(midlineMatch[1]);
      setValues(prev => ({ ...prev, "Midline Shift": val }));
      toast({ title: "Voice Loaded", description: `Midline shift set to ${val} mm` });
    }

    // 2. Tumor axes / 3-axis tumor
    const tumorMatch = normalized.match(/(?:tumor size|tumor|lesion|lesion size)\s*(\d+)\s*(?:by|x)\s*(\d+)\s*(?:by|x)\s*(\d+)/);
    if (tumorMatch) {
      setValues(prev => ({
        ...prev,
        "Tumor Axis 1 (L)": tumorMatch[1],
        "Tumor Axis 2 (W)": tumorMatch[2],
        "Tumor Axis 3 (H)": tumorMatch[3]
      }));
      toast({ title: "Voice Loaded", description: `Tumor size set to ${tumorMatch[1]}x${tumorMatch[2]}x${tumorMatch[3]} mm` });
    }

    // 3. Disc protrusion
    const discMatch = normalized.match(/(?:disc protrusion|protrusion)\s*(?:of|is)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:mm|millimetre|millimetres)?/);
    if (discMatch) {
      const val = wordToNum(discMatch[1]);
      setValues(prev => ({ ...prev, "Disc Protrusion Size": val }));
      toast({ title: "Voice Loaded", description: `Disc protrusion set to ${val} mm` });
    }

    // 4. BPD / AC / FL
    const bpdMatch = normalized.match(/bpd\s*(\d+)/);
    if (bpdMatch) setValues(prev => ({ ...prev, "BPD (Biparietal Diameter)": bpdMatch[1] }));
    const acMatch = normalized.match(/ac\s*(\d+)/);
    if (acMatch) setValues(prev => ({ ...prev, "AC (Abdominal Circumference)": acMatch[1] }));
    const flMatch = normalized.match(/fl\s*(\d+)/);
    if (flMatch) setValues(prev => ({ ...prev, "FL (Femur Length)": flMatch[1] }));
  }, [voiceTextCommand, toast]);

  const template = useMemo(() => {
    return LOCAL_TEMPLATES[selectedStudyType] ?? [];
  }, [selectedStudyType]);

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

  // SMART CALCULATIONS ENGINE
  const smartCalculations = useMemo(() => {
    const calcs: Record<string, any> = {};

    // 1. Tumor volume (L*W*H * 0.523)
    const tL = parseFloat(values["Tumor Axis 1 (L)"]);
    const tW = parseFloat(values["Tumor Axis 2 (W)"]);
    const tH = parseFloat(values["Tumor Axis 3 (H)"]);
    if (!isNaN(tL) && !isNaN(tW) && !isNaN(tH)) {
      calcs.tumorVolume = Math.round(tL * tW * tH * 0.523 * 10) / 10;
    }

    // 2. Hematoma ABC/2 volume
    const hA = parseFloat(values["Hematoma Axis A"]);
    const hB = parseFloat(values["Hematoma Axis B"]);
    const hC = parseFloat(values["Hematoma Axis C"]);
    if (!isNaN(hA) && !isNaN(hB) && !isNaN(hC)) {
      calcs.hematomaVolume = Math.round((hA * hB * hC) / 2000 * 10) / 10; // in cc
    }

    // 3. Evans Index
    const fhorn = parseFloat(values["Frontal Horn Width"]);
    const skull = parseFloat(values["Max Inner Skull Diameter"]);
    if (!isNaN(fhorn) && !isNaN(skull) && skull > 0) {
      calcs.evansIndex = Math.round((fhorn / skull) * 100) / 100;
    }

    // 4. Spondylolisthesis Slip %
    const disp = parseFloat(values["Spondylolisthesis Displacement"]);
    const vert = parseFloat(values["Vertebral Body Diameter"]);
    if (!isNaN(disp) && !isNaN(vert) && vert > 0) {
      const pct = Math.round((disp / vert) * 100);
      calcs.slipPct = pct;
      if (pct <= 25) calcs.slipGrade = "Grade 1 (0-25%)";
      else if (pct <= 50) calcs.slipGrade = "Grade 2 (25-50%)";
      else if (pct <= 75) calcs.slipGrade = "Grade 3 (50-75%)";
      else calcs.slipGrade = "Grade 4 (75-100%)";
    }

    // 5. OB Gestational Age / EDD / Hadlock EFW
    const CRL = parseFloat(values["CRL (Crown Rump Length)"]);
    if (!isNaN(CRL)) {
      calcs.gestAgeDays = CRL + 42;
      calcs.gestAgeStr = `${Math.floor(calcs.gestAgeDays / 7)}w ${calcs.gestAgeDays % 7}d`;
    }

    const BPD = parseFloat(values["BPD (Biparietal Diameter)"]);
    const HC = parseFloat(values["HC (Head Circumference)"]);
    const AC = parseFloat(values["AC (Abdominal Circumference)"]);
    const FL = parseFloat(values["FL (Femur Length)"]);

    if (!isNaN(BPD) && !isNaN(HC) && !isNaN(AC) && !isNaN(FL)) {
      const logEFW = 1.3596 - (0.00386 * (AC / 10) * (FL / 10)) + (0.007 * (HC / 10)) + (0.1158 * (BPD / 10)) + (0.00064 * (HC / 10) * (AC / 10));
      calcs.efw = Math.round(Math.pow(10, logEFW) * 100); // grams
    }

    // 6. Doppler resistive index
    const psv = parseFloat(values["PSV (Peak Systolic Velocity)"]);
    const edv = parseFloat(values["EDV (End Diastolic Velocity)"]);
    const meanV = parseFloat(values["Mean Velocity"]);
    if (!isNaN(psv) && !isNaN(edv) && psv > 0) {
      calcs.ri = Math.round(((psv - edv) / psv) * 100) / 100;
      calcs.sd = Math.round((psv / edv) * 10) / 10;
      if (!isNaN(meanV) && meanV > 0) {
        calcs.pi = Math.round(((psv - edv) / meanV) * 100) / 100;
      }
    }

    return calcs;
  }, [values]);

  // Live Auto Report Sync triggers on change of values or calculations
  useEffect(() => {
    const filled = Object.entries(values).filter(([_, v]) => v.trim());
    if (filled.length === 0 && Object.keys(smartCalculations).length === 0) return;

    const handler = setTimeout(() => {
      let text = "MEASUREMENTS LOG:\n";
      filled.forEach(([k, v]) => {
        text += `- ${k}: ${v}\n`;
      });

      if (smartCalculations.tumorVolume) text += `- Calculated Tumor Volume: ${smartCalculations.tumorVolume} cc\n`;
      if (smartCalculations.hematomaVolume) text += `- Calculated Hematoma Volume (ABC/2): ${smartCalculations.hematomaVolume} cc\n`;
      if (smartCalculations.evansIndex) text += `- Evans Index: ${smartCalculations.evansIndex} (Evans Index > 0.3 indicates ventriculomegaly)\n`;
      if (smartCalculations.efw) text += `- Hadlock EFW: ${smartCalculations.efw} grams\n`;
      if (smartCalculations.slipPct) text += `- Spondylolisthesis: ${smartCalculations.slipPct}% (${smartCalculations.slipGrade})\n`;
      if (smartCalculations.ri) {
        text += `- Doppler Resistive Index (RI): ${smartCalculations.ri} (S/D Ratio: ${smartCalculations.sd})\n`;
      }

      if (onMeasurementsChange) {
        onMeasurementsChange(text, smartCalculations);
      }
    }, 800);

    return () => clearTimeout(handler);
  }, [values, smartCalculations, onMeasurementsChange]);

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
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-slate-100">
      <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ruler size={14} className="text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Measurement Assistant</span>
          {abnormalCount > 0 && (
            <span className="text-[9px] bg-red-950 text-red-400 px-1.5 py-0.5 rounded-full font-medium">
              {abnormalCount} abnormal
            </span>
          )}
        </div>
        {patientId && (
          <Button size="sm" variant="ghost" className="h-6 text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowHistory(!showHistory)}>
            <History size={11} className="mr-1" /> {showHistory ? "Form" : "History"}
          </Button>
        )}
      </div>

      {/* Study type selector */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-1.5 flex-wrap">
          {STUDY_TYPES.map((st) => (
            <button
              key={st.key}
              onClick={() => setSelectedStudyType(selectedStudyType === st.key ? "" : st.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                selectedStudyType === st.key
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-slate-800 text-slate-400 hover:border-indigo-500/50"
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
              <div className="text-center py-4 text-xs text-slate-500">Loading history...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-500">No saved measurements.</div>
            ) : (
              history.map((m) => (
                <div key={m.id} className="border border-slate-800 rounded-lg p-2 text-xs space-y-0.5 bg-slate-950/30">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{m.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-slate-300">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                      {m.isAbnormal === true && <span className="text-[9px] bg-red-950 text-red-400 px-1 rounded">Abnormal</span>}
                      {m.isAbnormal === false && <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1 rounded">Normal</span>}
                    </div>
                  </div>
                  {(m.normalRangeLow != null || m.normalRangeHigh != null) && (
                    <div className="text-[10px] text-slate-500">
                      Normal: {m.normalRangeLow ?? "—"} – {m.normalRangeHigh ?? "—"} {m.unit}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : !selectedStudyType ? (
          <div className="text-center py-6 text-xs text-slate-500">
            Select a study type above to load the measurement template.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Real-time smart calculations panel */}
            {Object.keys(smartCalculations).length > 0 && (
              <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-lg p-2.5 text-xs text-indigo-300 space-y-1 font-mono">
                <div className="font-semibold flex items-center gap-1 text-[11px] mb-1">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse text-indigo-400" /> Real-time Smart Metrics:
                </div>
                {smartCalculations.tumorVolume && <div>Tumor Volume: {smartCalculations.tumorVolume} cc</div>}
                {smartCalculations.hematomaVolume && <div>Hematoma Volume (ABC/2): {smartCalculations.hematomaVolume} cc</div>}
                {smartCalculations.evansIndex && <div>Evans Index: {smartCalculations.evansIndex}</div>}
                {smartCalculations.efw && <div>Estimated Fetal Weight: {smartCalculations.efw} g</div>}
                {smartCalculations.gestAgeStr && <div>Gestational Age: {smartCalculations.gestAgeStr}</div>}
                {smartCalculations.slipPct && <div>Vertebral Slip: {smartCalculations.slipPct}% ({smartCalculations.slipGrade})</div>}
                {smartCalculations.ri && <div>RI: {smartCalculations.ri} | PI: {smartCalculations.pi} | S/D: {smartCalculations.sd}</div>}
              </div>
            )}

            <div className="space-y-2">
              {template.map((field) => {
                const val = values[field.label] ?? "";
                const status = val ? getNormalStatus(val, field) : "unknown";
                return (
                  <div key={field.label} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-slate-300 truncate">{field.label}</div>
                      {(field.normalRangeLow !== undefined || field.normalRangeHigh !== undefined) && (
                        <div className="text-[9px] text-slate-500">
                          Normal: {field.normalRangeLow ?? "—"}–{field.normalRangeHigh ?? "—"} {field.unit}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Input
                        value={val}
                        onChange={(e) => setValues((prev) => ({ ...prev, [field.label]: e.target.value }))}
                        className={`h-7 w-20 text-xs text-right font-mono bg-slate-950 border-slate-800 text-slate-200 ${
                          status === "abnormal" ? "border-red-600 text-red-400 bg-red-950/30" : status === "normal" ? "border-emerald-600" : ""
                        }`}
                        placeholder="—"
                      />
                      <span className="text-[10px] text-slate-500 w-8 flex-shrink-0">{field.unit}</span>
                      <div className="w-4 flex-shrink-0">
                        {status === "normal" && <Check size={12} className="text-emerald-500" />}
                        {status === "abnormal" && <AlertTriangle size={12} className="text-red-500" />}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <Button size="sm" className="text-xs h-7 flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSave} disabled={saving || !patientId}>
                  <Save size={12} className="mr-1" /> {saving ? "Saving..." : "Save Measurements"}
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-7 border-slate-800 hover:bg-slate-950 text-slate-400" onClick={() => setValues({})}>
                  <RotateCcw size={12} />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
