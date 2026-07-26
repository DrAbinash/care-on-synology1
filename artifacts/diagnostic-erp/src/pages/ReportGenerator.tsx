import { useState, useRef, useEffect, useCallback } from "react";
import { useListPatients, useListOrders, useGetOrder } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Printer,
  Volume2,
  VolumeX,
  Upload,
  Download,
  Settings2,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileType2,
  Star,
  Trash2,
  X as XIcon,
  Library,
  CheckCircle2,
  XCircle,
  ScanLine,
} from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mic, MicOff, Sparkles, Image as ImageIcon, GraduationCap, BookOpen } from "lucide-react";
import RadiologyCopilotPanel from "@/components/RadiologyCopilotPanel";
import ImageAnnotationToolbar from "@/components/ImageAnnotationToolbar";
import RadiologyMemoryPanel from "@/components/RadiologyMemoryPanel";
import LesionTrackerPanel from "@/components/LesionTrackerPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import { isFeatureEnabled } from "@/lib/staffSession";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SpeechRecognitionLike } from "@/types/speech";

type ReportTemplate = {
  id: number;
  testId: number;
  name: string;
  format: "text" | "html";
  content: string;
  isDefault: boolean;
  tags: string | null;       // comma-separated finding keywords
  modality: string | null;   // USG | CT | MRI | X-RAY | LAB | ECG | ...
  createdAt: string;
};

type AbnormalFinding = {
  id: number;
  testId: number | null;
  modality: string | null;
  category: string | null;
  keyword: string;
  aliases: string | null;
  description: string;
  severity: "mild" | "moderate" | "severe";
  isActive: boolean;
  usageCount: number;
};

const MODALITIES = ["USG", "CT", "MRI", "X-RAY", "ECG", "LAB", "ENDOSCOPY", "MAMMO", "DEXA", "OTHER"] as const;

type FindingFlag = "normal" | "low" | "high" | "critical";

interface TestParameter {
  name: string;
  result: string;
  unit: string;
  refRange: string;
  flag: FindingFlag;
}

interface TestFinding {
  testId: number;
  testName: string;
  testCode: string;
  parameters: TestParameter[];
  remarks: string;
  collapsed: boolean;
}

const PARAMETERS_BY_CODE: Record<string, { name: string; unit: string; refRange: string }[]> = {
  CBC: [
    { name: "Hemoglobin", unit: "g/dL", refRange: "12.0–16.0 (F) / 13.0–17.0 (M)" },
    { name: "Total WBC Count", unit: "cells/µL", refRange: "4,000–11,000" },
    { name: "Platelet Count", unit: "lakhs/µL", refRange: "1.5–4.5" },
    { name: "RBC Count", unit: "million/µL", refRange: "3.8–5.2 (F) / 4.5–5.9 (M)" },
    { name: "PCV / Hematocrit", unit: "%", refRange: "36–46 (F) / 40–52 (M)" },
    { name: "MCV", unit: "fL", refRange: "80–100" },
    { name: "MCH", unit: "pg", refRange: "27–33" },
    { name: "MCHC", unit: "g/dL", refRange: "31–36" },
    { name: "Neutrophils", unit: "%", refRange: "40–70" },
    { name: "Lymphocytes", unit: "%", refRange: "20–45" },
    { name: "Monocytes", unit: "%", refRange: "2–10" },
    { name: "Eosinophils", unit: "%", refRange: "1–6" },
    { name: "Basophils", unit: "%", refRange: "0–1" },
  ],
  "BS-F": [
    { name: "Fasting Blood Glucose", unit: "mg/dL", refRange: "70–100" },
  ],
  "BS-PP": [
    { name: "Post-Prandial Blood Glucose", unit: "mg/dL", refRange: "< 140" },
  ],
  "BS-R": [
    { name: "Random Blood Glucose", unit: "mg/dL", refRange: "< 200" },
  ],
  LFT: [
    { name: "Total Bilirubin", unit: "mg/dL", refRange: "0.2–1.2" },
    { name: "Direct Bilirubin", unit: "mg/dL", refRange: "0.0–0.3" },
    { name: "Indirect Bilirubin", unit: "mg/dL", refRange: "0.1–0.9" },
    { name: "SGOT (AST)", unit: "U/L", refRange: "10–40" },
    { name: "SGPT (ALT)", unit: "U/L", refRange: "7–56" },
    { name: "Alkaline Phosphatase", unit: "U/L", refRange: "44–147" },
    { name: "Total Protein", unit: "g/dL", refRange: "6.0–8.3" },
    { name: "Albumin", unit: "g/dL", refRange: "3.5–5.0" },
    { name: "Globulin", unit: "g/dL", refRange: "2.0–3.5" },
    { name: "A/G Ratio", unit: "", refRange: "1.0–2.5" },
  ],
  KFT: [
    { name: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", refRange: "7–20" },
    { name: "Serum Creatinine", unit: "mg/dL", refRange: "0.6–1.2 (M) / 0.5–1.1 (F)" },
    { name: "Uric Acid", unit: "mg/dL", refRange: "3.4–7.0 (M) / 2.4–6.0 (F)" },
    { name: "eGFR", unit: "mL/min/1.73m²", refRange: "> 90" },
    { name: "Serum Sodium", unit: "mEq/L", refRange: "136–145" },
    { name: "Serum Potassium", unit: "mEq/L", refRange: "3.5–5.1" },
    { name: "Serum Chloride", unit: "mEq/L", refRange: "98–107" },
  ],
  TSH: [
    { name: "Thyroid Stimulating Hormone (TSH)", unit: "µIU/mL", refRange: "0.4–4.0" },
  ],
  T3: [
    { name: "Triiodothyronine (T3)", unit: "ng/dL", refRange: "80–200" },
  ],
  T4: [
    { name: "Thyroxine (T4)", unit: "µg/dL", refRange: "5.1–14.1" },
  ],
  LIPID: [
    { name: "Total Cholesterol", unit: "mg/dL", refRange: "< 200 (Desirable)" },
    { name: "LDL Cholesterol", unit: "mg/dL", refRange: "< 130 (Near Optimal)" },
    { name: "HDL Cholesterol", unit: "mg/dL", refRange: "> 40 (M) / > 50 (F)" },
    { name: "VLDL Cholesterol", unit: "mg/dL", refRange: "2–30" },
    { name: "Triglycerides", unit: "mg/dL", refRange: "< 150" },
    { name: "Total Cholesterol / HDL Ratio", unit: "", refRange: "< 5.0" },
  ],
  HBA1C: [
    { name: "Glycated Hemoglobin (HbA1c)", unit: "%", refRange: "< 5.7 (Normal) / 5.7–6.4 (Pre-diabetic) / ≥ 6.5 (Diabetic)" },
  ],
  "URINE-R": [
    { name: "Colour", unit: "", refRange: "Pale Yellow to Amber" },
    { name: "Appearance", unit: "", refRange: "Clear" },
    { name: "Specific Gravity", unit: "", refRange: "1.005–1.030" },
    { name: "pH", unit: "", refRange: "5.0–8.0" },
    { name: "Protein", unit: "", refRange: "Negative" },
    { name: "Glucose", unit: "", refRange: "Negative" },
    { name: "Ketones", unit: "", refRange: "Negative" },
    { name: "Blood", unit: "", refRange: "Negative" },
    { name: "Bilirubin", unit: "", refRange: "Negative" },
    { name: "Urobilinogen", unit: "EU/dL", refRange: "0.1–1.0" },
    { name: "Nitrites", unit: "", refRange: "Negative" },
    { name: "Leucocyte Esterase", unit: "", refRange: "Negative" },
    { name: "WBCs", unit: "cells/HPF", refRange: "0–5" },
    { name: "RBCs", unit: "cells/HPF", refRange: "0–2" },
    { name: "Epithelial Cells", unit: "cells/HPF", refRange: "0–5" },
    { name: "Casts", unit: "", refRange: "Absent" },
    { name: "Crystals", unit: "", refRange: "Absent" },
  ],
  ECG: [
    { name: "Heart Rate", unit: "bpm", refRange: "60–100" },
    { name: "Rhythm", unit: "", refRange: "Regular Sinus Rhythm" },
    { name: "QRS Axis", unit: "degrees", refRange: "-30 to +90" },
    { name: "PR Interval", unit: "ms", refRange: "120–200" },
    { name: "QRS Duration", unit: "ms", refRange: "< 120" },
    { name: "QT Interval", unit: "ms", refRange: "360–440" },
    { name: "ST Segment", unit: "", refRange: "Isoelectric" },
    { name: "T Wave", unit: "", refRange: "Normal" },
  ],
  XRAY: [
    { name: "Lung Fields", unit: "", refRange: "Clear" },
    { name: "Heart Size", unit: "", refRange: "Normal" },
    { name: "Mediastinum", unit: "", refRange: "Normal width" },
    { name: "Costophrenic Angles", unit: "", refRange: "Sharp" },
    { name: "Bony Structures", unit: "", refRange: "No abnormality" },
  ],
};

function makeDefaultParameters(code: string): TestParameter[] {
  const defs = PARAMETERS_BY_CODE[code.toUpperCase()];
  if (defs) {
    return defs.map((d) => ({ name: d.name, result: "", unit: d.unit, refRange: d.refRange, flag: "normal" as FindingFlag }));
  }
  return [{ name: "Result", result: "", unit: "", refRange: "", flag: "normal" }];
}

// ── Auto-flag from reference range + entered value ───────────────────────────
// Handles common patterns:
//   "12.0–16.0"          numeric range
//   "12.0-16.0 (F) / 13.0-17.0 (M)"   gendered range (uses union)
//   "< 200 (Desirable)"  upper limit only
//   "> 90"               lower limit only
//   "≥ 6.5 (Diabetic)"   lower limit only
//   "Negative" / "Nil"   text expected — flag if value differs
//   "5.7–6.4" with extra "≥ 6.5 (Diabetic)" → critical above hard threshold
// Returns "normal" if it can't parse (so manual override still works).
const NUM_RE = /-?\d+(?:\.\d+)?/g;

export function computeAutoFlag(rawValue: string, refRange: string): FindingFlag {
  if (!rawValue) return "normal";
  const value = rawValue.trim();
  const ref = (refRange ?? "").trim();
  if (!ref) return "normal";

  // Text-expected ranges (qualitative tests)
  const negativeWords = ["negative", "nil", "absent", "not detected", "non reactive", "non-reactive", "normal", "wnl", "clear"];
  const lcRef = ref.toLowerCase();
  if (negativeWords.some((w) => lcRef === w || lcRef.startsWith(w + " ") || lcRef.startsWith(w + "/"))) {
    const lcVal = value.toLowerCase();
    if (negativeWords.some((w) => lcVal === w || lcVal.includes(w))) return "normal";
    // anything else is abnormal (positive/present/etc.)
    return "high";
  }

  const num = parseFloat(value.replace(/[^\d.\-]/g, ""));
  if (Number.isNaN(num)) return "normal"; // can't compare non-numeric value to numeric range

  // "Critical" tier — extract any "critical" or "≥ X" / "diabetic" markers as hard caps
  const criticalMatch = ref.match(/(?:critical|panic)[^0-9<>]*([<>≤≥]?)\s*(-?\d+(?:\.\d+)?)/i);
  if (criticalMatch) {
    const op = criticalMatch[1] || "≥";
    const cap = parseFloat(criticalMatch[2]);
    if ((op === ">" || op === "≥") && num >= cap) return "critical";
    if ((op === "<" || op === "≤") && num <= cap) return "critical";
  }

  // Multi-tier ranges (HbA1c style) — pick the strictest applicable label
  // Look for "≥ 6.5" / "> 6.5" upper hard threshold marked with a severity word
  const sevHigh = ref.match(/[≥>]\s*(-?\d+(?:\.\d+)?)\s*(?:\([^)]*(?:diabetic|severe|critical|crisis)[^)]*\))?/i);
  // "<X" upper limit
  const lessThan = [...ref.matchAll(/<\s*(-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
  // ">X" lower limit
  const greaterThan = [...ref.matchAll(/>\s*(-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));

  // Numeric range "a–b" or "a-b" (supports en-dash, em-dash, hyphen)
  const rangeMatches = [...ref.matchAll(/(-?\d+(?:\.\d+)?)\s*[\u2013\u2014\-]\s*(-?\d+(?:\.\d+)?)/g)];
  if (rangeMatches.length > 0) {
    // Combine all numeric ranges into a permissive union (handles gendered ranges)
    let lo = Infinity, hi = -Infinity;
    for (const m of rangeMatches) {
      lo = Math.min(lo, parseFloat(m[1]));
      hi = Math.max(hi, parseFloat(m[2]));
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      if (num < lo) return num < lo * 0.5 ? "critical" : "low";
      if (num > hi) {
        // sevHigh marker — if value crosses it, escalate
        if (sevHigh && num >= parseFloat(sevHigh[1])) return "critical";
        return num > hi * 1.5 ? "critical" : "high";
      }
      return "normal";
    }
  }

  // Single-sided limits
  if (lessThan.length > 0) {
    const cap = Math.min(...lessThan);
    if (num >= cap) {
      if (sevHigh && num >= parseFloat(sevHigh[1])) return "critical";
      return num > cap * 1.5 ? "critical" : "high";
    }
    return "normal";
  }
  if (greaterThan.length > 0) {
    const floor = Math.max(...greaterThan);
    if (num <= floor) return num < floor * 0.5 ? "critical" : "low";
    return "normal";
  }

  return "normal";
}

const FLAG_STYLES: Record<FindingFlag, string> = {
  normal: "text-green-600 dark:text-green-400",
  low: "text-blue-600 dark:text-blue-400 font-bold",
  high: "text-red-600 dark:text-red-400 font-bold",
  critical: "text-red-700 dark:text-red-300 font-extrabold animate-pulse",
};

const FLAG_PRINT: Record<FindingFlag, string> = {
  normal: "",
  low: " ↓ LOW",
  high: " ↑ HIGH",
  critical: " ⚠ CRITICAL",
};

export default function ReportGenerator() {
  const [patientId, setPatientId] = useState<number | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [findings, setFindings] = useState<TestFinding[]>([]);
  const [labDirector, setLabDirector] = useState("Dr. Laboratory Director");
  // Module B: clinic name centralization — derive lab/clinic name from settings so
  // exports and printed reports match the configured branding across the app.
  const { data: clinic } = useQuery<{ name?: string }>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });
  const labName = clinic?.name ? `${clinic.name} Laboratory` : "Care Diagnostics Laboratory";
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [outputFormat, setOutputFormat] = useState<"print" | "html" | "text">("print");

  // Print / PDF
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [templateContent, setTemplateContent] = useState<string | null>(null);
  const [templateResult, setTemplateResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Per-test template library
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<Record<number, number>>({}); // testId → templateId
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForTestId, setUploadForTestId] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadFormat, setUploadFormat] = useState<"text" | "html">("text");
  const [uploadIsDefault, setUploadIsDefault] = useState(true);
  const [uploadTags, setUploadTags] = useState("");
  const [uploadModality, setUploadModality] = useState<string>("");

  // ── Abnormal findings library + voice ──
  const [findingsLib, setFindingsLib] = useState<AbnormalFinding[]>([]);
  const [findingsLibOpen, setFindingsLibOpen] = useState(false);
  const [findingEditor, setFindingEditor] = useState<Partial<AbnormalFinding> | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceTargetTestId, setVoiceTargetTestId] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [suggestionFor, setSuggestionFor] = useState<number | null>(null); // test idx whose remarks textarea is showing autocomplete
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [findingFormOpen, setFindingFormOpen] = useState(false);

  // ── Teaching case dialog ──
  const [saveTeachingCaseOpen, setSaveTeachingCaseOpen] = useState(false);
  const [teachingNotes, setTeachingNotes] = useState("");
  const [savingTeachingCase, setSavingTeachingCase] = useState(false);
  const [findingForm, setFindingForm] = useState<Partial<AbnormalFinding>>({ severity: "moderate", isActive: true });

  // report-templates and abnormal-findings are both staff-authed
  // (Authorization: Bearer <token>) — must go through the api client, which
  // attaches that header; a raw fetch() never carries it and 401s.
  const loadTemplates = async () => {
    try {
      setTemplates(await api.get<ReportTemplate[]>("/api/report-templates"));
    } catch { /* best-effort — page still renders without templates */ }
  };
  const loadFindingsLib = async () => {
    try {
      setFindingsLib(await api.get<AbnormalFinding[]>("/api/abnormal-findings?limit=500"));
    } catch { /* best-effort — autocomplete just has nothing to suggest */ }
  };
  useEffect(() => { loadTemplates(); loadFindingsLib(); }, []);

  // ── Barcode scanner auto-populate ──
  const qc = useQueryClient();
  const [location] = useLocation();
  const [scanBuffer, setScanBuffer] = useState("");
  const scannerRef = useRef<HTMLInputElement>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Auto-focus scanner input always
  useEffect(() => {
    const focus = () => scannerRef.current?.focus();
    focus();
    window.addEventListener("click", focus);
    window.addEventListener("touchstart", focus);
    return () => {
      window.removeEventListener("click", focus);
      window.removeEventListener("touchstart", focus);
    };
  }, []);

  // Prevent Enter from navigating away
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && document.activeElement === scannerRef.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resolveBarcode = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setScanError(null);
    try {
      const result = await api.get<{ type: string; patient?: { id: number } | null; order?: { id: number } | null }>(`/api/resolve-barcode/${encodeURIComponent(code.trim())}`);
      if (result.patient?.id) {
        setPatientId(result.patient.id);
        setOrderId(null);
        setFindings([]);
      }
      if (result.order?.id) {
        setOrderId(result.order.id);
      }
      // Refresh patient list and orders so Select dropdowns have data
      qc.invalidateQueries({ queryKey: ["listPatients"] });
      if (result.patient?.id) {
        qc.invalidateQueries({ queryKey: ["listOrders", String(result.patient.id)] });
      }
      if (result.patient?.id || result.order?.id) {
        toast({ title: "Barcode scanned", description: `Loaded ${result.type} data.` });
      } else {
        setScanError("Scanned code matched no patient, order, bill, or report.");
      }
    } catch (err: any) {
      setScanError(err?.message || "Lookup failed.");
    } finally {
      setScanBuffer("");
      if (scannerRef.current) scannerRef.current.value = "";
      setTimeout(() => scannerRef.current?.focus(), 50);
    }
  }, [qc, toast]);

  // DICOM study UID — passed via URL param by the PACS worklist when opening a report
  const [studyInstanceUid, setStudyInstanceUid] = useState<string | null>(null);

  // URL param auto-load (for ReportDelivery "View" links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderIdParam = params.get("orderId");
    if (orderIdParam) {
      setOrderId(Number(orderIdParam));
    }
    const studyUidParam = params.get("studyInstanceUid");
    if (studyUidParam) {
      setStudyInstanceUid(studyUidParam);
    }
  }, [location]);

  const { data: patients } = useListPatients({ limit: 200 });
  const { data: orders } = useListOrders({ patientId: patientId ?? undefined, limit: 50 });
  const { data: order } = useGetOrder(orderId ?? 0, { query: { queryKey: ["order", orderId], enabled: !!orderId } });

  useEffect(() => {
    if (order?.tests) {
      setFindings(
        order.tests.map((ot) => ({
          testId: ot.id,
          testName: ot.test?.name ?? "Unknown",
          testCode: ot.test?.code ?? "",
          parameters: makeDefaultParameters(ot.test?.code ?? ""),
          remarks: "",
          collapsed: false,
        }))
      );
    }
  }, [order]);

  const patient = patients?.patients?.find((p) => p.id === patientId);
  const ageDisplay = patient ? (() => {
    const p = patient;
    if (p.ageValue != null && p.ageUnit) {
      if (p.ageUnit === "years") return p.ageValue > 0 ? `${p.ageValue} Yrs` : null;
      if (p.ageUnit === "months") return `${p.ageValue} Mo`;
      if (p.ageUnit === "days") return `${p.ageValue} D`;
    }
    const years = new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear();
    return years > 0 ? `${years} Yrs` : null;
  })() : null;

  const updateParam = (testIdx: number, paramIdx: number, field: keyof TestParameter, value: string) => {
    setFindings((prev) => prev.map((f, fi) =>
      fi !== testIdx ? f : {
        ...f,
        parameters: f.parameters.map((p, pi) => {
          if (pi !== paramIdx) return p;
          const next = { ...p, [field]: value };
          // Auto-recompute flag whenever the result OR the reference range changes
          if (field === "result" || field === "refRange") {
            next.flag = computeAutoFlag(next.result, next.refRange);
          }
          return next;
        }),
      }
    ));
  };

  const toggleCollapse = (idx: number) => {
    setFindings((prev) => prev.map((f, i) => i === idx ? { ...f, collapsed: !f.collapsed } : f));
  };

  const updateRemarks = (idx: number, val: string) => {
    setFindings((prev) => prev.map((f, i) => i === idx ? { ...f, remarks: val } : f));
  };

  const pickTemplateFromTags = (testId: number, text: string) => {
    const lc = text.toLowerCase();
    const tmpl = templates.find((t) => {
      if (t.testId !== testId) return false;
      const tags = (t.tags ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const modality = (t.modality ?? "").trim().toLowerCase();
      return tags.some((tag) => lc.includes(tag)) || (modality && lc.includes(modality));
    });
    if (tmpl) setActiveTemplateId((m) => ({ ...m, [testId]: tmpl.id }));
  };

  const startVoice = (testId: number) => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      toast({ title: "Voice input isn't supported in this browser", variant: "destructive" });
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      const transcript = Array.from(ev.results).map((r) => r[0]?.transcript ?? "").join(" ").trim();
      setVoiceTranscript(transcript);
      const idx = findings.findIndex((f) => f.testId === testId);
      if (idx >= 0 && transcript) updateRemarks(idx, transcript);
    };
    recognition.onerror = () => {
      setVoiceListening(false);
      setVoiceTargetTestId(null);
    };
    recognition.onend = () => {
      setVoiceListening(false);
      setVoiceTargetTestId(null);
    };
    recognitionRef.current = recognition;
    setVoiceTranscript("");
    setVoiceTargetTestId(testId);
    setVoiceListening(true);
    recognition.start();
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceListening(false);
    setVoiceTargetTestId(null);
  };

  const filteredFindings = (query: string, testId: number) => {
    const lc = query.trim().toLowerCase();
    return findingsLib.filter((f) => {
      if (f.testId && f.testId !== testId) return false;
      if (!lc) return true;
      const aliases = (f.aliases ?? "").toLowerCase();
      return f.keyword.toLowerCase().includes(lc) || aliases.includes(lc) || (f.category ?? "").toLowerCase().includes(lc);
    }).slice(0, 8);
  };

  const saveFinding = async () => {
    if (!findingForm.keyword || !findingForm.description) return;
    try {
      await api.post("/api/abnormal-findings", {
        testId: findingForm.testId ?? null,
        modality: findingForm.modality ?? null,
        category: findingForm.category ?? null,
        keyword: String(findingForm.keyword).trim(),
        aliases: findingForm.aliases ?? null,
        description: String(findingForm.description),
        severity: (findingForm.severity as AbnormalFinding["severity"]) || "moderate",
        isActive: findingForm.isActive ?? true,
      });
    } catch (err) {
      toast({ title: "Could not save finding", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return;
    }
    setFindingFormOpen(false);
    setFindingForm({ severity: "moderate", isActive: true });
    loadFindingsLib();
  };

  // Voice readout
  const speak = () => {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    if (!patient || !order) return;
    const abnormal = findings.flatMap((f) =>
      f.parameters.filter((p) => p.flag !== "normal" && p.result).map((p) => `${p.name}: ${p.result} ${p.unit}, ${p.flag}`)
    );
    const text = [
      `Diagnostic Report for patient ${patient.firstName} ${patient.lastName}, ${ageDisplay ?? ""} old.`,
      `Order number ${order.orderNumber}, dated ${new Date(order.createdAt).toLocaleDateString()}.`,
      abnormal.length > 0
        ? `Abnormal findings: ${abnormal.join("; ")}.`
        : "All findings are within normal limits.",
      findings.map((f) => f.remarks).filter(Boolean).join(". "),
    ].join(" ");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.9;
    utterance.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // ── Per-test template management ──
  const templatesByTest = (testId: number) => templates.filter((t) => t.testId === testId);

  const openUploadDialog = (testId: number, presetName = "") => {
    setUploadForTestId(testId);
    setUploadName(presetName);
    setUploadContent("");
    setUploadFormat("text");
    setUploadIsDefault(templatesByTest(testId).length === 0);
    setUploadDialogOpen(true);
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fmt = file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm") ? "html" : "text";
    setUploadFormat(fmt);
    if (!uploadName) setUploadName(file.name.replace(/\.(txt|html|htm)$/i, ""));
    const reader = new FileReader();
    reader.onload = (ev) => setUploadContent((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const saveTemplate = async () => {
    if (!uploadForTestId) return;
    if (!uploadName.trim() || !uploadContent.trim()) {
      toast({ title: "Name and content are required", variant: "destructive" });
      return;
    }
    let created: ReportTemplate;
    try {
      created = await api.post<ReportTemplate>("/api/report-templates", {
        testId: uploadForTestId,
        name: uploadName.trim(),
        format: uploadFormat,
        content: uploadContent,
        isDefault: uploadIsDefault,
      });
    } catch (err) {
      toast({ title: "Could not save template", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return;
    }
    setTemplates((prev) => {
      const others = uploadIsDefault
        ? prev.map((t) => t.testId === created.testId ? { ...t, isDefault: false } : t)
        : prev;
      return [...others, created];
    });
    if (uploadIsDefault) setActiveTemplateId((m) => ({ ...m, [uploadForTestId]: created.id }));
    toast({ title: `Template saved`, description: created.name });
    setUploadDialogOpen(false);
  };

  // ── Save as teaching case via AI generation from report content ──
  // Calls POST /api/teaching-cases/generate-from-report which applies PHI
  // redaction and lets Gemini generate title, diagnosis, pearls, MCQs, etc.
  const saveTeachingCase = async () => {
    if (!order) return;
    const allRemarks = findings.map((f) => f.remarks).filter(Boolean).join("\n\n");
    if (!allRemarks.trim()) {
      toast({ title: "Enter findings first before generating a teaching case", variant: "destructive" });
      return;
    }
    setSavingTeachingCase(true);
    try {
      const created = await api.post<{ case?: { title?: string } }>("/api/teaching-cases/generate-from-report", {
        modality: order.tests?.[0]?.test?.code ?? "",
        testName: order.tests?.[0]?.test?.name ?? "",
        bodyPart: (order.tests?.[0]?.test as any)?.department ?? order.tests?.[0]?.test?.category ?? "",
        clinicalHistory: teachingNotes.trim() || undefined,
        findings: allRemarks,
        impression: allRemarks,
        category: "general",
      });
      toast({
        title: "Teaching case created",
        description: created.case?.title
          ? `"${created.case.title}" — AI Draft, requires review`
          : "AI Draft — Requires Radiologist Review before publishing",
      });
      setSaveTeachingCaseOpen(false);
      setTeachingNotes("");
    } catch (err) {
      toast({ title: "Could not generate teaching case", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingTeachingCase(false);
    }
  };

  const deleteTemplate = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try {
      await api.delete(`/api/report-templates/${id}`);
    } catch {
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast({ title: "Template deleted" });
  };

  const setDefaultTemplate = async (t: ReportTemplate) => {
    try {
      await api.patch(`/api/report-templates/${t.id}`, { isDefault: true });
    } catch {
      return;
    }
    setTemplates((prev) => prev.map((x) => x.testId === t.testId ? { ...x, isDefault: x.id === t.id } : x));
    toast({ title: `Default set: ${t.name}` });
  };

  const useTemplateForTest = (testId: number, templateId: number) => {
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    setActiveTemplateId((m) => ({ ...m, [testId]: templateId }));
    // Render preview of just this template, scoped to this test's findings
    const finding = findings.find((f) => f.testId === testId);
    const filled = applyFindingsToTemplate(tmpl.content, finding ? [finding] : undefined);
    setTemplateContent(tmpl.content);
    setTemplateResult(filled);
  };

  // Auto-pick default template for each test in the order
  useEffect(() => {
    if (findings.length === 0) return;
    setActiveTemplateId((current) => {
      const next = { ...current };
      for (const f of findings) {
        if (next[f.testId]) continue;
        const def = templates.find((t) => t.testId === f.testId && t.isDefault);
        if (def) next[f.testId] = def.id;
      }
      return next;
    });
    findings.forEach((f) => pickTemplateFromTags(f.testId, [f.remarks, ...f.parameters.map((p) => p.result)].join(" ")));
  }, [findings, templates]);

  const applyFindingsToTemplate = (content: string, scopedFindings?: TestFinding[]): string => {
    const usedFindings = scopedFindings ?? findings;
    let result = content;
    if (patient) {
      result = result
        .replace(/\[PATIENT_NAME\]|\bPatient Name\b:\s*[^\n]*/gi, `Patient Name: ${patient.firstName} ${patient.lastName}`)
        .replace(/\[PATIENT_ID\]|\bPatient ID\b:\s*[^\n]*/gi, `Patient ID: ${patient.patientId}`)
        .replace(/\[AGE\]|\bAge\b:\s*[^\n]*/gi, `Age: ${ageDisplay ?? ""}`)
        .replace(/\[GENDER\]|\bGender\b:\s*[^\n]*/gi, `Gender: ${patient.gender}`);
    }
    if (order) {
      result = result.replace(/\[ORDER_NO\]|\bOrder No\b[.:]?\s*[^\n]*/gi, `Order No: ${order.orderNumber}`);
      result = result.replace(/\[REPORT_DATE\]|\bReport Date\b[.:]?\s*[^\n]*/gi, `Report Date: ${new Date(reportDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`);
      if (order.doctor) {
        result = result.replace(/\[DOCTOR\]|\bRef(?:erring)? Doctor\b[.:]?\s*[^\n]*/gi, `Referring Doctor: ${order.doctor.name}`);
      }
    }
    // Replace per-parameter values
    usedFindings.forEach((f) => {
      f.parameters.forEach((p) => {
        if (!p.result) return;
        const displayVal = `${p.result} ${p.unit}${FLAG_PRINT[p.flag]}`.trim();
        // Replace "Normal" near the parameter name
        const safeParamName = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const paramPattern = new RegExp(`(${safeParamName}[^\\n]*?)(Normal|WNL|NIL|Nil|\\d+\\.?\\d*)`, "gi");
        result = result.replace(paramPattern, `$1${displayVal}`);
        // Also replace placeholders like [CBC_HEMOGLOBIN]
        const placeholder = `[${f.testCode}_${p.name.toUpperCase().replace(/\s+/g, "_")}]`;
        result = result.replace(placeholder, displayVal);
      });
    });
    return result;
  };

  const reapplyTemplate = () => {
    if (templateContent) setTemplateResult(applyFindingsToTemplate(templateContent));
  };

  // Export handlers
  const handlePrintPDF = () => {
    if (!patient || !order) {
      toast({ title: "Select patient and order first" });
      return;
    }
    const measurements = findings.flatMap((f) => f.parameters.map((p) => ({
      label: `${f.testName} — ${p.name}`,
      value: `${p.result} ${p.unit}${FLAG_PRINT[p.flag]}`.trim(),
    })));
    generateReportPDF({
      patientName: `${patient.firstName} ${patient.lastName}`,
      age: ageDisplay ?? undefined,
      sex: patient.gender ?? undefined,
      accessionNumber: order.orderNumber,
      studyDate: reportDate,
      referringDoctor: order.doctor?.name ?? undefined,
      modality: "LAB",
      findings: templateResult ?? undefined,
      impression: `${abnormalCount} abnormal finding${abnormalCount !== 1 ? "s" : ""}`,
      recommendation: "Please correlate with clinical findings.",
      measurements,
      reportTitle: "Diagnostic Laboratory Report",
    }, printSettings, clinic ?? null);
    toast({ title: "PDF downloaded" });
  };

  const handleDownloadHTML = () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Diagnostic Report</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#000}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{border:1px solid #333;padding:6px 10px;text-align:left}
      th{background:#f0f0f0;font-weight:bold}
      h1{font-size:18px;text-align:center;text-transform:uppercase;letter-spacing:2px}
      h2{font-size:13px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:20px}
      .flag-low{color:blue;font-weight:bold} .flag-high{color:red;font-weight:bold} .flag-critical{color:darkred;font-weight:900}
    </style></head><body>${document.getElementById("report-preview")?.innerHTML ?? ""}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report-${order?.orderNumber ?? "draft"}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadText = () => {
    if (!patient || !order) return;
    const lines = [
      "DIAGNOSTIC LABORATORY REPORT",
      "=".repeat(60),
      "",
      "PATIENT INFORMATION",
      "-".repeat(40),
      `Name          : ${patient.firstName} ${patient.lastName}`,
      `Patient ID    : ${patient.patientId}`,
      `Age / Gender  : ${ageDisplay ?? "—"} / ${patient.gender}`,
      patient.bloodGroup ? `Blood Group   : ${patient.bloodGroup}` : "",
      patient.phone ? `Phone         : ${patient.phone}` : "",
      "",
      "CLINICAL INFORMATION",
      "-".repeat(40),
      order.doctor ? `Referring Doctor : ${order.doctor.name} (${order.doctor.specialization})` : "Self Referred",
      order.notes ? `Clinical Notes   : ${order.notes}` : "",
      "",
      "SAMPLE INFORMATION",
      "-".repeat(40),
      `Order Number  : ${order.orderNumber}`,
      `Collection    : ${new Date(order.createdAt).toLocaleDateString("en-IN")}`,
      `Report Date   : ${new Date(reportDate).toLocaleDateString("en-IN")}`,
      "",
      "TEST RESULTS",
      "=".repeat(60),
      ...findings.flatMap((f) => [
        "",
        `[${f.testCode}] ${f.testName.toUpperCase()}`,
        "-".repeat(40),
        ...f.parameters.map((p) =>
          `${p.name.padEnd(30)} ${p.result ? (p.result + " " + p.unit + FLAG_PRINT[p.flag]).padEnd(20) : "—".padEnd(20)} Ref: ${p.refRange}`
        ),
        f.remarks ? `\nRemarks: ${f.remarks}` : "",
      ]),
      "",
      "=".repeat(60),
      "",
      `Authorized By: ${labDirector}`,
      labName,
      `Report Date  : ${new Date(reportDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
    ].filter((l) => l !== undefined);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report-${order?.orderNumber ?? "draft"}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (outputFormat === "print") handlePrintPDF();
    else if (outputFormat === "html") handleDownloadHTML();
    else handleDownloadText();
  };

  const abnormalCount = findings.reduce((n, f) => n + f.parameters.filter((p) => p.flag !== "normal").length, 0);

  return (
    <>

      <div className="pb-10">
        <PageHeader title="Report Generator" subtitle="Create formatted diagnostic reports" />

        <div className="px-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* ── Left Panel: Controls ── */}
            <div className="no-print lg:col-span-1 space-y-4">

              {/* Barcode scanner input (invisible, keyboard-capturing) */}
              <input
                ref={scannerRef}
                type="text"
                autoFocus
                autoComplete="off"
                aria-hidden="true"
                className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none"
                onChange={(e) => setScanBuffer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolveBarcode(e.currentTarget.value); } }}
              />

              {/* Scanner status */}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ScanLine size={16} className="text-primary" />
                  <div>
                    <p className="text-xs font-medium">Scanner ready</p>
                    <p className="text-[11px] text-muted-foreground">{scanBuffer ? `Buffer: ${scanBuffer}` : "Scan any barcode to auto-load patient & order"}</p>
                  </div>
                </div>
                {scanError && (
                  <span className="text-[11px] text-red-600 flex items-center gap-1">
                    <AlertTriangle size={11} /> {scanError}
                  </span>
                )}
              </div>

              {/* Patient & Order */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Select Patient & Order</h3>
                <div>
                  <Label className="text-xs">Patient</Label>
                  <Select onValueChange={(v) => { setPatientId(Number(v)); setOrderId(null); setFindings([]); }}>
                    <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select patient..." /></SelectTrigger>
                    <SelectContent>
                      {patients?.patients?.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.firstName} {p.lastName} ({p.patientId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {patientId && (
                  <div>
                    <Label className="text-xs">Order</Label>
                    <Select onValueChange={(v) => setOrderId(Number(v))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select order..." /></SelectTrigger>
                      <SelectContent>
                        {orders?.orders?.map((o) => (
                          <SelectItem key={o.id} value={String(o.id)}>
                            {o.orderNumber} — {new Date(o.createdAt).toLocaleDateString()} ({o.status})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* USG / Imaging Image Status */}
              {order && order.tests?.some((t) => (t.test?.code ?? "").startsWith("USG") || (t.test?.name ?? "").toLowerCase().includes("ultrasound")) && (
                <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">USG Image Status</h3>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-muted-foreground">Waiting for DICOM images from USG machine</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Images auto-import from Voluson (172.16.1.46) via C-STORE, watch folder, USB DICOMDIR, or JPG/PNG fallback. Once received, click to open PACS viewer.
                  </p>
                  <Button size="sm" variant="outline" className="w-full text-xs" disabled>
                    <ImageIcon size={13} className="mr-1.5" />
                    Open PACS Viewer
                  </Button>
                </div>
              )}

              {/* Lab Director */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Report Details</h3>
                <div>
                  <Label className="text-xs">Authorized By</Label>
                  <Input value={labDirector} onChange={(e) => setLabDirector(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Report Date</Label>
                  <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
              </div>

              {/* Output Format */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Output Format</h3>
                <div className="space-y-2">
                  {(["print", "html", "text"] as const).map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="format"
                        value={fmt}
                        checked={outputFormat === fmt}
                        onChange={() => setOutputFormat(fmt)}
                        className="accent-primary"
                      />
                      <span className="text-sm capitalize">
                        {fmt === "print" ? "🖨 Print / Save as PDF" : fmt === "html" ? "🌐 HTML File" : "📄 Plain Text"}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!order}
                  onClick={handleExport}
                >
                  <Printer size={13} className="mr-1.5" />
                  {outputFormat === "print" ? "PDF" : "Download"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setPrintSettingsOpen(true)}
                >
                  <Settings2 size={13} className="mr-1.5" />
                  Print Settings
                </Button>
              </div>

              {/* Save as Teaching Case — gated by teachingGenerator flag */}
              {isFeatureEnabled("teachingGenerator") && (
                <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teaching Files</h3>
                  <p className="text-xs text-muted-foreground">Save this anonymized case for teaching and research.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={!order}
                    onClick={() => setSaveTeachingCaseOpen(true)}
                  >
                    <GraduationCap size={13} className="mr-1.5" /> Save as Teaching Case
                  </Button>
                </div>
              )}

              {/* Voice */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voice Readout</h3>
                <p className="text-xs text-muted-foreground">Read aloud the report summary including abnormal findings.</p>
                <Button
                  size="sm"
                  variant={speaking ? "destructive" : "outline"}
                  className="w-full"
                  disabled={!order}
                  onClick={speak}
                >
                  {speaking ? <><VolumeX size={13} className="mr-1.5" />Stop Reading</> : <><Volume2 size={13} className="mr-1.5" />Read Report Aloud</>}
                </Button>
              </div>

              {/* Templates */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Report Templates</h3>
                <p className="text-xs text-muted-foreground">
                  Upload formats per test (e.g. USG WHOLE ABDOMEN, X-RAY CHEST PA, MRI BRAIN). The default template auto-fills with patient + result data.
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => setLibraryOpen(true)}>
                  <Library size={13} className="mr-1.5" /> Manage Template Library
                </Button>
                {templateResult && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      const blob = new Blob([templateResult], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a"); a.href = url; a.download = "report-filled.txt"; a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download size={13} className="mr-1.5" /> Download Filled Template
                  </Button>
                )}
              </div>

              {/* Phase 10C: Inline Image Annotation Toolbar — shown when a DICOM study UID is available */}
              {isFeatureEnabled("imageAnnotations") && studyInstanceUid && (
                <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Image Annotations</h3>
                  <ImageAnnotationToolbar
                    studyInstanceUid={studyInstanceUid}
                    orderId={orderId ?? undefined}
                    patientId={patientId ?? undefined}
                  />
                </div>
              )}

              {/* Radiology Copilot */}
              <RadiologyCopilotPanel
                patientId={patientId ?? undefined}
                currentOrderId={orderId ?? undefined}
                studyInstanceUid={studyInstanceUid}
                findingsText={findings.map((f) => f.remarks).filter(Boolean).join("\n")}
                impressionText={findings[0]?.remarks ?? ""}
                onImpressionSuggestion={(text) => {
                  // Insert the suggested impression into the first findings remarks
                  if (findings.length > 0) {
                    updateRemarks(0, findings[0].remarks + "\n\nIMPRESSION: " + text);
                  }
                }}
              />

              {/* Phase 9: Radiology Memory + Context Engine */}
              <RadiologyMemoryPanel
                patientId={patientId ?? undefined}
                orderId={orderId ?? undefined}
                modality={findings[0]?.testCode ?? (order?.tests?.[0]?.test?.code ?? "")}
                bodyPart={(order?.tests?.[0]?.test as any)?.department ?? order?.tests?.[0]?.test?.category ?? ""}
                findingsText={findings.map((f) => f.remarks).filter(Boolean).join("\n")}
                impressionText={findings[0]?.remarks || ""}
                onSuggestionInsert={(text) => {
                  if (findings.length > 0) {
                    updateRemarks(0, findings[0].remarks + "\n" + text);
                  }
                }}
              />

              {/* Phase 10A: Lesion Tracker — gated by master + lesionTracking flags */}
              {isFeatureEnabled("dicomImageIntelligence") && isFeatureEnabled("lesionTracking") && patientId && (
                <LesionTrackerPanel
                  patientId={patientId}
                  orderId={orderId ?? undefined}
                  modality={findings[0]?.testCode ?? (order?.tests?.[0]?.test?.code ?? "")}
                  bodyPart={(order?.tests?.[0]?.test as any)?.department ?? order?.tests?.[0]?.test?.category ?? ""}
                />
              )}

              {/* Phase 10A: Measurement Assistant — gated by master + measurementAssistant flags */}
              {isFeatureEnabled("dicomImageIntelligence") && isFeatureEnabled("measurementAssistant") && patientId && (
                <MeasurementAssistantPanel
                  patientId={patientId}
                  orderId={orderId ?? undefined}
                  modality={findings[0]?.testCode ?? (order?.tests?.[0]?.test?.code ?? "")}
                  bodyPart={(order?.tests?.[0]?.test as any)?.department ?? order?.tests?.[0]?.test?.category ?? ""}
                />
              )}
            </div>

            {/* ── Right Panel: Report Preview + Findings Editor ── */}
            <div className="lg:col-span-3 space-y-5">

              {/* Abnormal badge */}
              {abnormalCount > 0 && (
                <div className="no-print flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 rounded-lg">
                  <AlertTriangle size={14} className="text-red-500" />
                  <span className="text-sm font-medium text-red-700 dark:text-red-300">{abnormalCount} abnormal finding{abnormalCount > 1 ? "s" : ""} flagged</span>
                </div>
              )}

              {/* Template result preview */}
              {templateResult && (
                <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-200 dark:border-yellow-800/40">
                    <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Filled Template Preview</span>
                    <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setTemplateContent(null); setTemplateResult(null); }}>Dismiss</button>
                  </div>
                  <pre className="p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto bg-muted/10">{templateResult}</pre>
                </div>
              )}

              {/* Findings editor */}
              {findings.length > 0 && (
                <div className="no-print space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Enter Test Findings</h3>
                    <span className="text-xs text-muted-foreground">Values entered here appear in the report below</span>
                  </div>
                  {findings.map((f, fi) => (
                    <div key={f.testId} className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                        onClick={() => toggleCollapse(fi)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-primary">{f.testCode}</span>
                          <span className="text-sm font-semibold text-foreground">{f.testName}</span>
                          {f.parameters.some((p) => p.flag !== "normal") && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-xs">
                              {f.parameters.filter((p) => p.flag !== "normal").length} abnormal
                            </span>
                          )}
                        </div>
                        {f.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                      {!f.collapsed && (
                        <div className="border-t border-border">
                          {/* Per-test template picker */}
                          <div className="px-3 py-2 bg-muted/20 border-b border-border flex items-center gap-2 flex-wrap">
                            <FileType2 size={13} className="text-muted-foreground" />
                            <span className="text-[11px] font-medium text-muted-foreground">Template:</span>
                            {templatesByTest(f.testId).length > 0 ? (
                              <Select
                                value={activeTemplateId[f.testId] ? String(activeTemplateId[f.testId]) : ""}
                                onValueChange={(v) => useTemplateForTest(f.testId, Number(v))}
                              >
                                <SelectTrigger className="h-6 text-xs w-56"><SelectValue placeholder="Select template..." /></SelectTrigger>
                                <SelectContent>
                                  {templatesByTest(f.testId).map((t) => (
                                    <SelectItem key={t.id} value={String(t.id)}>
                                      {t.isDefault ? "★ " : ""}{t.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">No template tagged to {f.testCode || f.testName}</span>
                            )}
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => openUploadDialog(f.testId, `${f.testName} — Standard`)}>
                              <Upload size={11} className="mr-1" /> Upload
                            </Button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/30 text-muted-foreground">
                                  <th className="px-3 py-2 font-medium text-left w-48">Parameter</th>
                                  <th className="px-3 py-2 font-medium text-left w-28">Result</th>
                                  <th className="px-3 py-2 font-medium text-left w-20">Unit</th>
                                  <th className="px-3 py-2 font-medium text-left">Reference Range</th>
                                  <th className="px-3 py-2 font-medium text-left w-28">Flag</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.parameters.map((p, pi) => (
                                  <tr key={pi} className="border-t border-border/40">
                                    <td className="px-3 py-1.5 font-medium text-foreground">{p.name}</td>
                                    <td className="px-3 py-1.5">
                                      <Input
                                        value={p.result}
                                        onChange={(e) => updateParam(fi, pi, "result", e.target.value)}
                                        className="h-6 text-xs px-1.5 w-24"
                                        placeholder="Enter value"
                                      />
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <Input
                                        value={p.unit}
                                        onChange={(e) => updateParam(fi, pi, "unit", e.target.value)}
                                        className="h-6 text-xs px-1.5 w-16"
                                      />
                                    </td>
                                    <td className="px-3 py-1.5 text-muted-foreground text-xs">{p.refRange}</td>
                                    <td className="px-3 py-1.5">
                                      <Select value={p.flag} onValueChange={(v) => updateParam(fi, pi, "flag", v)}>
                                        <SelectTrigger className="h-6 text-xs w-24">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="normal">Normal</SelectItem>
                                          <SelectItem value="low">Low ↓</SelectItem>
                                          <SelectItem value="high">High ↑</SelectItem>
                                          <SelectItem value="critical">Critical ⚠</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="px-3 pb-3 pt-2">
                            <Label className="text-xs text-muted-foreground">Remarks for this test</Label>
                            <Textarea
                              value={f.remarks}
                              onChange={(e) => {
                                updateRemarks(fi, e.target.value);
                                setSuggestionFor(fi);
                                setSuggestionQuery(e.target.value);
                                pickTemplateFromTags(f.testId, e.target.value);
                              }}
                              className="mt-1 text-xs min-h-[48px]"
                              placeholder="Add any interpretation or remarks..."
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => (voiceListening && voiceTargetTestId === f.testId ? stopVoice() : startVoice(f.testId))}>
                                {voiceListening && voiceTargetTestId === f.testId ? <MicOff size={14} className="mr-1" /> : <Mic size={14} className="mr-1" />}
                                {voiceListening && voiceTargetTestId === f.testId ? "Stop Voice" : "Voice"}
                              </Button>
                              <Popover open={suggestionFor === fi} onOpenChange={(open) => setSuggestionFor(open ? fi : null)}>
                                <PopoverTrigger asChild>
                                  <Button type="button" size="sm" variant="outline">
                                    <Sparkles size={14} className="mr-1" /> Suggestions
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-0">
                                  <Command>
                                    <CommandInput placeholder="Search findings…" value={suggestionQuery} onValueChange={setSuggestionQuery} />
                                    <CommandList>
                                      <CommandEmpty>No match</CommandEmpty>
                                      <CommandGroup>
                                        {filteredFindings(suggestionQuery, f.testId).map((item) => (
                                          <CommandItem key={item.id} onSelect={() => {
                                            updateRemarks(fi, item.description);
                                            setSuggestionFor(null);
                                            pickTemplateFromTags(f.testId, item.description);
                                          }}>
                                            <div>
                                              <div className="font-medium">{item.keyword}</div>
                                              <div className="text-xs text-muted-foreground">{item.description}</div>
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Report Preview (printable) ── */}
              <div id="report-preview" ref={reportRef} className="bg-white dark:bg-card text-black dark:text-foreground border border-card-border rounded-xl shadow-sm overflow-hidden print-container">
                {!order ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-2">
                    <FileText size={36} className="opacity-30" />
                    <p className="text-sm">Select a patient and order to generate a report</p>
                  </div>
                ) : (
                  <div className="p-8 space-y-6 text-sm">

                    {/* Header */}
                    <div className="text-center border-b-2 border-gray-800 dark:border-gray-300 pb-4">
                      <h1 className="text-xl font-black uppercase tracking-widest text-gray-900 dark:text-foreground">
                        {labName}
                      </h1>
                      <p className="text-xs text-gray-500 dark:text-muted-foreground mt-0.5">
                        Pathology · Biochemistry · Haematology · Microbiology
                      </p>
                      <div className="mt-2 inline-block px-4 py-0.5 bg-gray-900 dark:bg-primary text-white text-xs font-bold uppercase tracking-widest rounded">
                        Diagnostic Laboratory Report
                      </div>
                    </div>

                    {/* Patient Info + Sample Info */}
                    <div className="grid grid-cols-2 gap-6 text-xs border border-gray-200 dark:border-border rounded-lg overflow-hidden">
                      <div className="p-4 space-y-1.5 border-r border-gray-200 dark:border-border">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-muted-foreground mb-2">Patient Information</h2>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Name</span>
                          <span className="font-bold text-gray-900 dark:text-foreground">{patient?.firstName} {patient?.lastName}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Patient ID</span>
                          <span className="font-mono font-semibold">{patient?.patientId}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Age / Gender</span>
                          <span>{ageDisplay ?? "—"} / <span className="capitalize">{patient?.gender}</span></span>
                        </div>
                        {patient?.bloodGroup && (
                          <div className="flex gap-2">
                            <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Blood Group</span>
                            <span className="font-bold text-red-600">{patient.bloodGroup}</span>
                          </div>
                        )}
                        {patient?.phone && (
                          <div className="flex gap-2">
                            <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Phone</span>
                            <span>{patient.phone}</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4 space-y-1.5">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-muted-foreground mb-2">Sample Information</h2>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Order No</span>
                          <span className="font-mono font-bold text-blue-700 dark:text-primary">{order.orderNumber}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Collected</span>
                          <span>{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Report Date</span>
                          <span>{new Date(reportDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Ref. Doctor</span>
                          <span className="font-medium">{order.doctor ? `${order.doctor.name}` : "Self Referred"}</span>
                        </div>
                        {order.doctor?.specialization && (
                          <div className="flex gap-2">
                            <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Specialization</span>
                            <span>{order.doctor.specialization}</span>
                          </div>
                        )}
                        {order.notes && (
                          <div className="flex gap-2">
                            <span className="text-gray-500 dark:text-muted-foreground w-24 flex-shrink-0">Clinical Notes</span>
                            <span className="italic">{order.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Test Results */}
                    <div className="space-y-5">
                      <h2 className="text-sm font-bold uppercase tracking-wider border-b-2 border-gray-800 dark:border-gray-300 pb-1">
                        Test Results
                      </h2>

                      {findings.map((f) => (
                        <div key={f.testId}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 bg-gray-800 dark:bg-primary text-white text-xs font-bold rounded">{f.testCode}</span>
                            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-foreground">{f.testName}</h3>
                          </div>

                          <table className="w-full text-xs border border-gray-300 dark:border-border rounded overflow-hidden">
                            <thead>
                              <tr className="bg-gray-100 dark:bg-muted/50 text-gray-700 dark:text-muted-foreground">
                                <th className="px-3 py-2 text-left font-semibold border-b border-gray-300 dark:border-border w-1/3">Parameter</th>
                                <th className="px-3 py-2 text-left font-semibold border-b border-gray-300 dark:border-border w-1/5">Result</th>
                                <th className="px-3 py-2 text-left font-semibold border-b border-gray-300 dark:border-border w-1/8">Unit</th>
                                <th className="px-3 py-2 text-left font-semibold border-b border-gray-300 dark:border-border">Reference Range</th>
                                <th className="px-3 py-2 text-center font-semibold border-b border-gray-300 dark:border-border w-16">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.parameters.map((p, pi) => (
                                <tr
                                  key={pi}
                                  className={`border-b border-gray-200 dark:border-border/50 last:border-0 ${p.flag !== "normal" ? "bg-red-50 dark:bg-red-900/5" : ""}`}
                                >
                                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-foreground">{p.name}</td>
                                  <td className={`px-3 py-2 font-bold ${FLAG_STYLES[p.flag]}`}>
                                    {p.result || <span className="text-gray-300 dark:text-muted-foreground/30 font-normal">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500 dark:text-muted-foreground">{p.unit}</td>
                                  <td className="px-3 py-2 text-gray-500 dark:text-muted-foreground">{p.refRange}</td>
                                  <td className="px-3 py-2 text-center">
                                    {p.flag === "normal" ? (
                                      <CheckCircle2 size={13} className="text-green-500 inline" />
                                    ) : p.flag === "critical" ? (
                                      <XCircle size={13} className="text-red-600 inline" />
                                    ) : (
                                      <AlertTriangle size={13} className={`inline ${p.flag === "high" ? "text-red-500" : "text-blue-500"}`} />
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {f.remarks && (
                            <div className="mt-1.5 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/30 rounded text-xs text-gray-700 dark:text-foreground">
                              <span className="font-semibold">Remarks: </span>{f.remarks}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Summary of Abnormal Findings */}
                    {abnormalCount > 0 && (
                      <div className="border border-red-300 dark:border-red-800/40 rounded-lg p-4 bg-red-50 dark:bg-red-900/10">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400 mb-2">
                          Summary of Abnormal Findings
                        </h2>
                        <ul className="space-y-1">
                          {findings.flatMap((f) =>
                            f.parameters.filter((p) => p.flag !== "normal" && p.result).map((p, i) => (
                              <li key={`${f.testId}-${i}`} className="text-xs flex items-start gap-1.5">
                                <AlertTriangle size={11} className={`mt-0.5 flex-shrink-0 ${p.flag === "critical" ? "text-red-700" : p.flag === "high" ? "text-red-500" : "text-blue-500"}`} />
                                <span>
                                  <span className="font-semibold">{p.name}</span>: {p.result} {p.unit}
                                  <span className={`ml-1 font-bold ${FLAG_STYLES[p.flag]}`}>({p.flag.toUpperCase()})</span>
                                  {p.refRange && <span className="text-gray-500 dark:text-muted-foreground ml-1">— Ref: {p.refRange}</span>}
                                </span>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Footer / Signature */}
                    <div className="border-t-2 border-gray-800 dark:border-gray-300 pt-4">
                      <div className="flex justify-between items-end">
                        <div className="text-xs text-gray-500 dark:text-muted-foreground space-y-0.5">
                          <p>This report is generated electronically and is valid without signature.</p>
                          <p>For queries, contact the laboratory.</p>
                        </div>
                        <div className="text-right text-xs">
                          <div className="border-t border-gray-500 dark:border-gray-400 pt-1 mt-8 w-44">
                            <p className="font-bold text-gray-800 dark:text-foreground">{labDirector}</p>
                            <p className="text-gray-500 dark:text-muted-foreground">Laboratory Director</p>
                            <p className="text-gray-500 dark:text-muted-foreground">{labName}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input used by Upload dialog */}
      <input ref={fileInputRef} type="file" accept=".txt,.html,.htm" className="hidden" onChange={handleFilePick} />

      {/* ── Upload Template Dialog ── */}
      <Dialog open={findingFormOpen} onOpenChange={setFindingFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Abnormal Finding</DialogTitle>
            <DialogDescription>Create a reusable finding for voice and autocomplete.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Keyword" value={String(findingForm.keyword ?? "")} onChange={(e) => setFindingForm((v) => ({ ...v, keyword: e.target.value }))} />
            <Input placeholder="Description" value={String(findingForm.description ?? "")} onChange={(e) => setFindingForm((v) => ({ ...v, description: e.target.value }))} />
            <Input placeholder="Aliases, comma separated" value={String(findingForm.aliases ?? "")} onChange={(e) => setFindingForm((v) => ({ ...v, aliases: e.target.value }))} />
            <Input placeholder="Modality" value={String(findingForm.modality ?? "")} onChange={(e) => setFindingForm((v) => ({ ...v, modality: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFindingFormOpen(false)}>Cancel</Button>
            <Button onClick={saveFinding}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Report Template</DialogTitle>
            <DialogDescription>
              {uploadForTestId && findings.find((f) => f.testId === uploadForTestId)
                ? <>Tagged to <span className="font-mono font-semibold">{findings.find((f) => f.testId === uploadForTestId)?.testName}</span></>
                : "This template will be tied to the selected test"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Template Name</Label>
              <Input
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. USG WHOLE ABDOMEN — Standard"
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} className="mr-1.5" /> Pick .txt / .html file
              </Button>
              <Select value={uploadFormat} onValueChange={(v: "text" | "html") => setUploadFormat(v)}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Plain text</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={uploadIsDefault} onChange={(e) => setUploadIsDefault(e.target.checked)} className="accent-primary" />
                Set as default for this test
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Tags (comma separated)" value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} />
              <Input placeholder="Modality" value={uploadModality} onChange={(e) => setUploadModality(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Template content</Label>
              <Textarea
                value={uploadContent}
                onChange={(e) => setUploadContent(e.target.value)}
                placeholder={"Use placeholders like:\n[PATIENT_NAME]   [PATIENT_ID]   [AGE]   [GENDER]\n[ORDER_NO]   [REPORT_DATE]   [DOCTOR]\nor parameter-specific:  [USG_LIVER]\n\nLines like 'Liver: Normal' will have 'Normal' replaced by the actual finding."}
                className="mt-1 text-xs min-h-[260px] font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Library Dialog ── */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Template Library</DialogTitle>
            <DialogDescription>All report templates, grouped by test. Star marks the default loaded automatically.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-4">
            {(() => {
              const grouped = new Map<number, ReportTemplate[]>();
              for (const t of templates) {
                const arr = grouped.get(t.testId) ?? [];
                arr.push(t); grouped.set(t.testId, arr);
              }
              if (grouped.size === 0) {
                return (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    No templates yet. Open an order and click <em>Upload</em> next to a test to add one.
                  </div>
                );
              }
              return Array.from(grouped.entries()).map(([testId, list]) => {
                const testName = findings.find((f) => f.testId === testId)?.testName
                  ?? order?.tests?.find((ot) => ot.id === testId)?.test?.name
                  ?? `Test #${testId}`;
                return (
                  <div key={testId} className="border rounded-lg p-3 bg-muted/10">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{testName}</div>
                    <ul className="space-y-1">
                      {list.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/40">
                          <div className="flex items-center gap-2 min-w-0">
                            {t.isDefault
                              ? <Star size={13} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />
                              : <Star size={13} className="text-muted-foreground/40 flex-shrink-0" />}
                            <span className="text-sm truncate">{t.name}</span>
                            <span className="text-[10px] uppercase text-muted-foreground">{t.format}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {!t.isDefault && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDefaultTemplate(t)}>
                                Set default
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteTemplate(t.id)}>
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              });
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLibraryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Save Teaching Case Dialog ── */}
      <Dialog open={saveTeachingCaseOpen} onOpenChange={setSaveTeachingCaseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Teaching Case from Report</DialogTitle>
            <DialogDescription>
              AI will anonymize the patient data, generate a title, diagnosis, clinical pearls, and MCQs from the current report findings. The case is saved as a draft for radiologist review before publishing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-[11px] text-yellow-800">
              <Sparkles size={13} className="mt-0.5 flex-shrink-0" />
              <span>AI Draft — Requires Radiologist Review before publishing. PHI is automatically redacted.</span>
            </div>
            <div>
              <Label className="text-xs">Clinical History / Context (optional)</Label>
              <Textarea
                value={teachingNotes}
                onChange={(e) => setTeachingNotes(e.target.value)}
                placeholder="Relevant clinical history, indication, or context that helps the AI generate better teaching content..."
                className="mt-1 text-xs min-h-[80px]"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current report findings will be used automatically. You can refine the title, add tags, and publish from the Teaching Files page.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTeachingCaseOpen(false)}>Cancel</Button>
            <Button onClick={saveTeachingCase} disabled={savingTeachingCase}>
              <GraduationCap size={13} className="mr-1.5" />
              {savingTeachingCase ? "Generating…" : "Generate Teaching Case"}
            </Button>
          </DialogFooter>
          <div className="mt-2 pt-2 border-t text-center">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => window.location.href = "/erp/teaching-cases"}>
              <BookOpen size={13} className="mr-1.5" /> Go to Teaching Files
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReportPrintSettingsDialog
        open={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
        settings={printSettings}
        onChange={(s) => { setPrintSettings(s); savePrintSettings(s); }}
      />
    </>
  );
}
