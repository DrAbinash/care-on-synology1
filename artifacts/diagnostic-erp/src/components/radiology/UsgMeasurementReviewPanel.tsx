/**
 * UsgMeasurementReviewPanel.tsx — R2.0 Canonical Ultrasound Integration.
 *
 * Chrome-less, prop-driven panel that decomposes the wide `usg_measurements`
 * row (plus any `usg_doppler_measurements` rows) for a study into a compact,
 * insertable list of measurement entries. Designed to be mounted as a
 * sidebar tab inside the canonical RadiologyReportingWorkspace (see
 * MeasurementAssistantPanel.tsx for the reference prop-driven pattern this
 * follows) AND inside the standalone UsgMeasurementReview page — both
 * surfaces render through this ONE component.
 *
 * No new backend routes: reuses
 *   GET   /api/usg-extraction/study/:studyInstanceUID
 *   GET   /api/usg-doppler?studyInstanceUID=
 *   PATCH /api/usg-extraction/measurements/:id/approve|reject
 *   PATCH /api/usg-doppler/:id/approve|reject
 *   POST  /api/usg-extraction/extract
 *   GET   /api/radiology/studies/:studyInstanceUID/ohif-launch  (series/SOP aware)
 *   POST  /api/radiology/report-generator/image-references      (pin as key image)
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, RefreshCw, AlertCircle, Activity,
  ArrowDownToLine, CheckCheck, Image as ImageIcon, Pin,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { launchViewer } from "@/lib/viewerService";
import { ohifUrlForRef } from "@/lib/reportImageRefs";
import { readStaffSession } from "@/lib/staffSession";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface UsgMeasurementReviewPanelProps {
  studyInstanceUID: string;
  /** When present, "pin as key image" is available (needs a draft to attach to). */
  draftId?: number | null;
  /** Caller merges the (label, value, unit) into the report text. */
  onInsertMeasurement?: (label: string, value: string, unit?: string) => void;
  /** Optional callback after a successful approve (measurement or Doppler). */
  onApproved?: () => void;
}

// ── Backend row types ─────────────────────────────────────────────────────────

interface UsgMeasurement {
  id: number;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  source: string;
  overallConfidence: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  bpd: string | null; bpdConfidence: string | null;
  hc: string | null;  hcConfidence: string | null;
  ac: string | null;  acConfidence: string | null;
  fl: string | null;  flConfidence: string | null;
  crl: string | null; crlConfidence: string | null;
  efw: string | null; efwConfidence: string | null;
  ga: string | null;  gaConfidence: string | null;
  edd: string | null; eddConfidence: string | null;
  fhr: string | null; fhrConfidence: string | null;
  placentaPosition: string | null;
  liquorAfi: string | null;
  fetalPresentation: string | null;
  uterusSize: string | null;       uterusSizeConfidence: string | null;
  endometrium: string | null;      endometriumConfidence: string | null;
  rightOvary: string | null;       rightOvaryConfidence: string | null;
  leftOvary: string | null;        leftOvaryConfidence: string | null;
  follicles: string | null;
  adnexalLesion: string | null;
  liverSize: string | null;        liverSizeConfidence: string | null;
  spleenSize: string | null;       spleenSizeConfidence: string | null;
  rightKidney: string | null;      rightKidneyConfidence: string | null;
  leftKidney: string | null;       leftKidneyConfidence: string | null;
  cbd: string | null;              cbdConfidence: string | null;
  gbWall: string | null;           gbWallConfidence: string | null;
  prostateVolume: string | null;   prostateVolumeConfidence: string | null;
  extraMeasurementsJson: string;
  provenanceJson: string;
  engineVersion: string;
  createdAt: string;
}

interface UsgDopplerMeasurement {
  id: number;
  studyInstanceUID: string | null;
  vesselName: string;
  side: string;
  psv: string | null;
  edv: string | null;
  ri: string | null;
  pi: string | null;
  sdRatio: string | null;
  confidence: string;
  source: string;
  status: string;
  reviewedBy: string | null;
  provenanceJson: string;
  engineVersion: string;
  createdAt: string;
}

interface ProvenanceItem {
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number;
  sourceType?: string;
  sourceLabel?: string;
  sourceConfidence?: string;
  sourcePath?: string;
  rawExtractedValue?: string;
  normalizedValue?: string;
  unit?: string;
  extractedAt?: string;
  extractedByEngineVersion?: string;
}

interface LaunchResponse {
  ohifUrl?: string | null;
  launchLevel?: "study" | "series" | "sop" | null;
  requestedLevel?: "study" | "series" | "sop" | null;
  error?: string;
}

// ── Virtual measurement entry (one per field, decomposed from the wide rows) ──

type EntryParent =
  | { kind: "measurement"; id: number; status: string }
  | { kind: "doppler"; id: number; status: string };

interface MeasurementEntry {
  key: string;
  label: string;
  value: string;
  unit: string;
  confidence: string | null;
  source: string;
  provenance: ProvenanceItem | null;
  parent: EntryParent;
  studyInstanceUID: string;
  engineVersion: string;
  createdAt: string;
}

interface FieldDef {
  field: string;
  label: string;
  hasConfidence: boolean;
}

const OBSTETRIC_FIELDS: FieldDef[] = [
  { field: "bpd", label: "BPD (Biparietal Dia.)", hasConfidence: true },
  { field: "hc", label: "HC (Head Circumference)", hasConfidence: true },
  { field: "ac", label: "AC (Abdominal Circ.)", hasConfidence: true },
  { field: "fl", label: "FL (Femur Length)", hasConfidence: true },
  { field: "crl", label: "CRL (Crown-Rump)", hasConfidence: true },
  { field: "efw", label: "EFW (Est. Fetal Wt.)", hasConfidence: true },
  { field: "ga", label: "GA (Gestational Age)", hasConfidence: true },
  { field: "edd", label: "EDD (Est. Due Date)", hasConfidence: true },
  { field: "fhr", label: "FHR (Fetal Heart Rate)", hasConfidence: true },
  { field: "placentaPosition", label: "Placenta Position", hasConfidence: false },
  { field: "liquorAfi", label: "Liquor / AFI", hasConfidence: false },
  { field: "fetalPresentation", label: "Fetal Presentation", hasConfidence: false },
];
const PELVIS_FIELDS: FieldDef[] = [
  { field: "uterusSize", label: "Uterus Size", hasConfidence: true },
  { field: "endometrium", label: "Endometrium", hasConfidence: true },
  { field: "rightOvary", label: "Right Ovary", hasConfidence: true },
  { field: "leftOvary", label: "Left Ovary", hasConfidence: true },
  { field: "follicles", label: "Follicles", hasConfidence: false },
  { field: "adnexalLesion", label: "Adnexal Lesion", hasConfidence: false },
];
const ABDOMEN_FIELDS: FieldDef[] = [
  { field: "liverSize", label: "Liver Size", hasConfidence: true },
  { field: "spleenSize", label: "Spleen Size", hasConfidence: true },
  { field: "rightKidney", label: "Right Kidney", hasConfidence: true },
  { field: "leftKidney", label: "Left Kidney", hasConfidence: true },
  { field: "cbd", label: "CBD (Common Bile Duct)", hasConfidence: true },
  { field: "gbWall", label: "GB Wall Thickness", hasConfidence: true },
  { field: "prostateVolume", label: "Prostate Volume", hasConfidence: true },
];

const DOPPLER_FIELD_LABELS: Record<string, string> = {
  psv: "PSV", edv: "EDV", ri: "RI", pi: "PI", sdRatio: "S/D Ratio",
};

// usg_measurements/usg_doppler_measurements store each field as a
// human-readable string that already carries its unit (e.g. "138 mm",
// "104 x 42 mm") — provenance_json separately records the unit as raw
// extraction metadata. Concatenating both verbatim doubles the unit
// ("138 mm" + " mm" -> "138 mm mm") in both the Unit badge and any inserted
// report text, so drop the provenance unit whenever it's already present at
// the end of the stored value.
function dedupeUnit(value: string, unit: string): string {
  if (!unit) return "";
  const v = value.trim().toLowerCase();
  const u = unit.trim().toLowerCase();
  return v.endsWith(u) ? "" : unit;
}

function parseProvenance(json: string | null | undefined): Record<string, ProvenanceItem> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ProvenanceItem>) : {};
  } catch {
    return {};
  }
}

function buildMeasurementSections(
  measurement: UsgMeasurement | undefined,
  studyInstanceUID: string,
): { section: string; entries: MeasurementEntry[] }[] {
  if (!measurement) return [];
  const provenance = parseProvenance(measurement.provenanceJson);
  const parent: EntryParent = { kind: "measurement", id: measurement.id, status: measurement.status };
  const row = measurement as unknown as Record<string, string | null>;

  const mk = (def: FieldDef): MeasurementEntry | null => {
    const raw = row[def.field];
    if (!raw) return null;
    const confidence = def.hasConfidence ? row[`${def.field}Confidence`] : null;
    const item = provenance[def.field] ?? null;
    const unit = dedupeUnit(raw, item?.unit && item.unit !== "N/A" ? item.unit : "");
    return {
      key: `m:${measurement.id}:${def.field}`,
      label: def.label,
      value: raw,
      unit,
      confidence,
      source: item?.sourceType || measurement.source,
      provenance: item,
      parent,
      studyInstanceUID,
      engineVersion: measurement.engineVersion,
      createdAt: measurement.createdAt,
    };
  };

  const sections = [
    { section: "Obstetric / Fetal", entries: OBSTETRIC_FIELDS.map(mk).filter((e): e is MeasurementEntry => !!e) },
    { section: "Pelvis / Gynaecology", entries: PELVIS_FIELDS.map(mk).filter((e): e is MeasurementEntry => !!e) },
    { section: "Abdomen", entries: ABDOMEN_FIELDS.map(mk).filter((e): e is MeasurementEntry => !!e) },
  ];

  try {
    const extras = JSON.parse(measurement.extraMeasurementsJson) as Record<string, string>;
    const extraEntries: MeasurementEntry[] = Object.entries(extras)
      .filter(([, v]) => !!v)
      .map(([k, v]) => {
        const item = provenance[k] ?? null;
        const unit = dedupeUnit(v, item?.unit && item.unit !== "N/A" ? item.unit : "");
        return {
          key: `m:${measurement.id}:extra:${k}`,
          label: k,
          value: v,
          unit,
          confidence: null,
          source: item?.sourceType || measurement.source,
          provenance: item,
          parent,
          studyInstanceUID,
          engineVersion: measurement.engineVersion,
          createdAt: measurement.createdAt,
        };
      });
    if (extraEntries.length) sections.push({ section: "Other Visible Measurements", entries: extraEntries });
  } catch { /* ignore malformed extras */ }

  return sections.filter((s) => s.entries.length > 0);
}

function buildDopplerEntries(row: UsgDopplerMeasurement, studyInstanceUID: string): MeasurementEntry[] {
  const provenance = parseProvenance(row.provenanceJson);
  const parent: EntryParent = { kind: "doppler", id: row.id, status: row.status };
  const rec = row as unknown as Record<string, string | null>;
  const entries: MeasurementEntry[] = [];
  for (const field of Object.keys(DOPPLER_FIELD_LABELS)) {
    const raw = rec[field];
    if (!raw) continue;
    const item = provenance[field] ?? null;
    const unit = dedupeUnit(raw, item?.unit && item.unit !== "N/A" ? item.unit : "");
    entries.push({
      key: `d:${row.id}:${field}`,
      label: DOPPLER_FIELD_LABELS[field],
      value: raw,
      unit,
      confidence: row.confidence,
      source: item?.sourceType || row.source,
      provenance: item,
      parent,
      studyInstanceUID,
      engineVersion: row.engineVersion,
      createdAt: row.createdAt,
    });
  }
  return entries;
}

// ── localStorage "inserted" tracking (survives a tab switch) ──────────────────

function insertedStorageKey(studyUID: string): string {
  return `usg_inserted_${studyUID}`;
}
function loadInsertedKeys(studyUID: string): Set<string> {
  if (!studyUID || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(insertedStorageKey(studyUID));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveInsertedKeys(studyUID: string, keys: Set<string>): void {
  if (!studyUID || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(insertedStorageKey(studyUID), JSON.stringify(Array.from(keys)));
  } catch { /* storage unavailable — inserted-state just won't persist */ }
}

// ── Badges (compact row cells reuse the old page's exact classification /
//    color rules, just tighter styling to fit a narrow panel) ─────────────────

const STATUS_BADGE_MAP: Record<string, string> = {
  pending_review: "bg-yellow-100 text-yellow-800 border-yellow-300",
  approved:       "bg-green-100 text-green-800 border-green-300",
  rejected:       "bg-red-100 text-red-800 border-red-300",
  auto_filled:    "bg-blue-100 text-blue-800 border-blue-300",
};

function classifySource(sourceType: string): { label: string; className: string } {
  const norm = (sourceType || "").toUpperCase();
  if (norm.includes("SR") || norm.includes("DICOM_SR")) return { label: "DICOM SR", className: "bg-green-100 text-green-800 border-green-300" };
  if (norm.includes("PRIVATE") || norm.includes("GE_PRIVATE_TAG")) return { label: "GE Private Tag", className: "bg-blue-100 text-blue-800 border-blue-300" };
  if (norm.includes("OCR")) return { label: "OCR", className: "bg-yellow-100 text-yellow-800 border-yellow-300" };
  if (norm.includes("MANUAL")) return { label: "Manual", className: "bg-gray-100 text-gray-800 border-gray-300" };
  return { label: sourceType || "—", className: "bg-slate-100 text-slate-600 border-slate-300" };
}

function classifyConfidence(confidence: string): { label: string; className: string } {
  const norm = (confidence || "").toLowerCase();
  if (norm === "low") return { label: "Low", className: "bg-red-100 text-red-800 border-red-300" };
  if (norm === "medium") return { label: "Medium", className: "bg-yellow-100 text-yellow-800 border-yellow-300" };
  if (norm === "high") return { label: "High", className: "bg-green-100 text-green-800 border-green-300" };
  return { label: confidence, className: "bg-slate-100 text-slate-600 border-slate-300" };
}

function SourceBadgeCell({ sourceType }: { sourceType: string }) {
  const { label, className } = classifySource(sourceType);
  return <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-medium border ${className}`}>{label}</span>;
}

function ConfidenceBadgeCell({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const { label, className } = classifyConfidence(confidence);
  return <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-semibold border ${className}`}>{label}</span>;
}

// Exact-copy badges for the Trace dialog (full labels, unchanged from the
// old page's getSourceBadge / getConfidenceBadge helpers — literal Tailwind
// class strings, not built from `classifySource`, so the JIT scanner sees
// every hover variant at build time).
function getSourceBadge(sourceType: string) {
  const norm = (sourceType || "").toUpperCase();
  if (norm.includes("SR") || norm.includes("DICOM_SR")) {
    return <Badge className="bg-green-100 text-green-800 border-green-300 border hover:bg-green-100">DICOM SR</Badge>;
  }
  if (norm.includes("PRIVATE") || norm.includes("GE_PRIVATE_TAG")) {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-300 border hover:bg-blue-100">GE Private Tag</Badge>;
  }
  if (norm.includes("OCR")) {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border hover:bg-yellow-100">OCR</Badge>;
  }
  if (norm.includes("MANUAL")) {
    return <Badge className="bg-gray-100 text-gray-800 border-gray-300 border hover:bg-gray-100">Manual</Badge>;
  }
  return <Badge variant="outline">{sourceType}</Badge>;
}
function getConfidenceBadge(confidence: string) {
  const norm = (confidence || "").toLowerCase();
  if (norm === "low") return <Badge className="bg-red-100 text-red-800 border-red-300 border hover:bg-red-100 font-bold">⚠️ Low Confidence</Badge>;
  if (norm === "medium") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border hover:bg-yellow-100">Medium Confidence</Badge>;
  if (norm === "high") return <Badge className="bg-green-100 text-green-800 border-green-300 border hover:bg-green-100">High Confidence</Badge>;
  return <Badge variant="outline">{confidence}</Badge>;
}

// ── 5-step timeline indicator ───────────────────────────────────────────────

// R2.0 fix: dropped the earlier 5th "Mapped -> Form F" stage — this panel
// has no way to know whether a value was later mapped on the separate Form F
// page (that happens on a different page after "Review & Map to Form F" is
// clicked), so that dot was permanently unlit and misleading. Only track
// what this component actually knows.
const TIMELINE_LABELS = ["Extracted", "Reviewed", "Approved", "Inserted"];

function TimelineDots({ steps }: { steps: boolean[] }) {
  const title = TIMELINE_LABELS.map((l, i) => `${l}: ${steps[i] ? "done" : "pending"}`).join(" · ");
  return (
    <div className="flex items-center gap-0.5 shrink-0" title={title}>
      {steps.map((done, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-slate-300"}`} />
      ))}
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function MeasurementEntryRow({
  entry, inserted, canPin, canInsert, onInsert, onApproveInsert, onTrace, onOpenImage, onPin, onKeyDown,
}: {
  entry: MeasurementEntry;
  inserted: boolean;
  canPin: boolean;
  /** False on the standalone review page (no report/draft context) — Insert
   *  and Approve+Insert would otherwise be active buttons that silently do
   *  nothing there. */
  canInsert: boolean;
  onInsert: () => void;
  onApproveInsert: () => void;
  onTrace: () => void;
  onOpenImage: () => void;
  onPin: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const pending = entry.parent.status === "pending_review";
  const rejected = entry.parent.status === "rejected";
  const steps = [true, entry.parent.status !== "pending_review", entry.parent.status === "approved", inserted];

  return (
    <div
      tabIndex={0}
      onDoubleClick={canInsert && !rejected ? onInsert : undefined}
      onKeyDown={onKeyDown}
      className="rounded border px-1.5 py-1 text-[11px] hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer"
      title={canInsert ? "Double-click to insert · Ctrl+Enter to approve" : "Ctrl+Enter to approve"}
      data-testid={`usg-entry-${entry.key}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium truncate" title={entry.label}>{entry.label}</span>
        <TimelineDots steps={steps} />
      </div>
      <div className="flex items-center gap-1 flex-wrap mt-0.5">
        <span className="font-mono font-semibold">{entry.value}</span>
        {entry.unit && <span className="text-muted-foreground">{entry.unit}</span>}
        <ConfidenceBadgeCell confidence={entry.confidence} />
        <SourceBadgeCell sourceType={entry.source} />
      </div>
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {canInsert && !rejected && (
          <>
            <Button
              variant="outline" size="sm" className="h-5 px-1.5 text-[9px]"
              onClick={(e) => { e.stopPropagation(); onInsert(); }}
              title="Insert into report"
            >
              <ArrowDownToLine className="h-2.5 w-2.5 mr-0.5" /> Insert
            </Button>
            <Button
              variant="outline" size="sm" className="h-5 px-1.5 text-[9px]"
              onClick={(e) => { e.stopPropagation(); onApproveInsert(); }}
              title={pending ? "Approve & insert" : "Insert"}
            >
              <CheckCheck className="h-2.5 w-2.5 mr-0.5" /> {pending ? "Approve+Ins" : "Insert"}
            </Button>
          </>
        )}
        {canInsert && rejected && (
          <span className="text-[9px] text-red-700 italic px-0.5">Rejected — not inserted</span>
        )}
        <Button
          variant="ghost" size="sm" className="h-5 px-1.5 text-[9px] font-mono text-muted-foreground border border-muted hover:border-foreground"
          onClick={(e) => { e.stopPropagation(); onTrace(); }}
        >
          Trace
        </Button>
        <Button
          variant="ghost" size="sm" className="h-5 w-5 p-0" title="Open source image"
          onClick={(e) => { e.stopPropagation(); onOpenImage(); }}
        >
          <ImageIcon className="h-3 w-3" />
        </Button>
        {canPin && !rejected && (
          <Button
            variant="ghost" size="sm" className="h-5 w-5 p-0" title="Pin as key image"
            onClick={(e) => { e.stopPropagation(); onPin(); }}
          >
            <Pin className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsgMeasurementReviewPanel({
  studyInstanceUID, draftId = null, onInsertMeasurement, onApproved,
}: UsgMeasurementReviewPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // R2.0 fix: without a real onInsertMeasurement (the standalone review page
  // mounts this panel with none), Insert/Approve+Insert don't write into any
  // report — they were previously still shown as live buttons, and their
  // "inserted" state was tracked in a localStorage key shared by ALL mounts
  // of this panel for the same study. A radiologist could click "Insert" on
  // the standalone page (a no-op) and later find the SAME study's row
  // already marked "Inserted" (green dot) inside the workspace, wrongly
  // trusting that the value was already in the report and skip re-inserting
  // it. Gate both the UI and the tracking on whether the callback exists.
  const canInsert = !!onInsertMeasurement;

  const [reviewNotes, setReviewNotes] = useState("");
  const [traceEntry, setTraceEntry] = useState<MeasurementEntry | null>(null);
  const [insertedKeys, setInsertedKeys] = useState<Set<string>>(() => (canInsert ? loadInsertedKeys(studyInstanceUID) : new Set()));

  useEffect(() => {
    setInsertedKeys(canInsert ? loadInsertedKeys(studyInstanceUID) : new Set());
  }, [studyInstanceUID, canInsert]);

  const pacsSettingsQuery = useQuery<{ key: string; value: string; category: string }[]>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
  });
  const pacsSettingsRecord: Record<string, string> = {};
  if (pacsSettingsQuery.data) {
    for (const item of pacsSettingsQuery.data) pacsSettingsRecord[item.key] = item.value;
  }

  const measQuery = useQuery<UsgMeasurement[]>({
    queryKey: ["usg-measurements", studyInstanceUID],
    queryFn: () => api.get(`/api/usg-extraction/study/${encodeURIComponent(studyInstanceUID)}`),
    enabled: !!studyInstanceUID,
    staleTime: 30_000,
  });
  const measurement = measQuery.data?.[0];

  const dopplerQuery = useQuery<UsgDopplerMeasurement[]>({
    queryKey: ["usg-doppler", studyInstanceUID],
    queryFn: () => api.get(`/api/usg-doppler?studyInstanceUID=${encodeURIComponent(studyInstanceUID)}`),
    enabled: !!studyInstanceUID,
    staleTime: 30_000,
  });

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["usg-measurements", studyInstanceUID] });
    void qc.invalidateQueries({ queryKey: ["usg-doppler", studyInstanceUID] });
    // R2.0 fix: the standalone UsgMeasurementReview.tsx wrapper's Extraction
    // History section (["usg-logs", studyUID]) has no Re-Extract button of
    // its own anymore — extraction is fully delegated to this panel's
    // Re-Extract, so its onSuccess must invalidate that key too or the
    // history list never shows the run that just happened.
    void qc.invalidateQueries({ queryKey: ["usg-logs", studyInstanceUID] });
  };

  const extractMutation = useMutation({
    mutationFn: () => api.post("/api/usg-extraction/extract", { studyInstanceUID }),
    onSuccess: () => { toast({ title: "Extraction started", description: "Measurements will appear shortly" }); refetch(); },
    onError: (e: Error) => toast({ title: "Extraction failed", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/usg-extraction/measurements/${id}/approve`, { reviewNotes }),
    onSuccess: () => { toast({ title: "Measurements approved" }); refetch(); onApproved?.(); },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/usg-extraction/measurements/${id}/reject`, { reviewNotes }),
    onSuccess: () => { toast({ title: "Measurements rejected" }); refetch(); },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const staffUser = readStaffSession()?.user;
  const reviewerName = staffUser?.name || staffUser?.username || undefined;

  const dopplerApproveMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/usg-doppler/${id}/approve`, { reviewedBy: reviewerName, reviewNotes }),
    onSuccess: () => { toast({ title: "Doppler measurement approved" }); refetch(); onApproved?.(); },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const dopplerRejectMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/api/usg-doppler/${id}/reject`, { reviewedBy: reviewerName, reviewNotes }),
    onSuccess: () => { toast({ title: "Doppler measurement rejected" }); refetch(); },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const pinKeyImageMutation = useMutation({
    mutationFn: (entry: MeasurementEntry) => {
      const p = entry.provenance;
      const body: Record<string, unknown> = {
        draftId,
        studyInstanceUid: studyInstanceUID,
        seriesInstanceUid: p?.seriesInstanceUID,
        sopInstanceUid: p?.sopInstanceUID,
        description: entry.label,
        isKeyImage: true,
        displayOrder: 0,
      };
      const frame = Number(p?.frameNumber);
      if (Number.isFinite(frame) && frame >= 1) body.frameNumber = Math.floor(frame);
      return api.post("/api/radiology/report-generator/image-references", body);
    },
    onSuccess: () => {
      toast({ title: "Pinned as key image" });
      // R2.0 fix: ReportImagePicker (mounted in the workspace's left panel,
      // same draftId) reads ["report-image-references", draftId] — without
      // this the just-pinned image doesn't show there until the next
      // background refetch/window refocus.
      if (draftId != null) void qc.invalidateQueries({ queryKey: ["report-image-references", draftId] });
    },
    onError: (e: Error) => toast({ title: "Could not pin image", description: e.message, variant: "destructive" }),
  });

  // ── Insert / approve actions ─────────────────────────────────────────────
  // Rejected measurements are never inserted or pinned — there is no inline
  // correction UI here, so "rejected" means the radiologist has said this
  // value is wrong; the row-render layer already hides these actions for a
  // rejected entry, this is the second (defense-in-depth) gate.

  function handleInsert(entry: MeasurementEntry) {
    if (entry.parent.status === "rejected") return;
    onInsertMeasurement?.(entry.label, entry.value, entry.unit || undefined);
    setInsertedKeys((prev) => {
      const next = new Set(prev);
      next.add(entry.key);
      saveInsertedKeys(studyInstanceUID, next);
      return next;
    });
  }

  function handleApproveAndInsert(entry: MeasurementEntry) {
    if (entry.parent.status === "rejected") return;
    if (entry.parent.status === "pending_review") {
      if (entry.parent.kind === "measurement") {
        approveMutation.mutate(entry.parent.id, { onSuccess: () => handleInsert(entry) });
      } else {
        dopplerApproveMutation.mutate(entry.parent.id, { onSuccess: () => handleInsert(entry) });
      }
    } else {
      handleInsert(entry);
    }
  }

  // Row-level Ctrl+Enter → approve the row's PARENT measurement. Must stop
  // propagation BEFORE anything else: the workspace binds a window-level
  // keydown listener that treats plain Ctrl+Enter as "finalize the whole
  // report" (see RadiologyReportingWorkspace's matchWorkspaceShortcut). That
  // listener is attached in the bubble phase on `window`, so stopping
  // propagation here (a descendant, bubble-phase handler) keeps it from ever
  // seeing the event.
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>, entry: MeasurementEntry) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (entry.parent.status !== "pending_review") return;
      if (entry.parent.kind === "measurement") approveMutation.mutate(entry.parent.id);
      else dopplerApproveMutation.mutate(entry.parent.id);
    }
  }

  async function openSourceImage(entry: MeasurementEntry) {
    const seriesUid = entry.provenance?.seriesInstanceUID;
    const sopUid = entry.provenance?.sopInstanceUID;
    if (!seriesUid) {
      void launchViewer(studyInstanceUID, "OHIF", pacsSettingsRecord, toast);
      return;
    }
    const win = window.open("about:blank", "_blank");
    try {
      const qs = new URLSearchParams({ seriesInstanceUID: seriesUid });
      if (sopUid) qs.set("sopInstanceUID", sopUid);
      const launch = await api.get<LaunchResponse>(
        `/api/radiology/studies/${encodeURIComponent(studyInstanceUID)}/ohif-launch?${qs.toString()}`,
      );
      const safeUrl = ohifUrlForRef(launch.ohifUrl);
      if (!safeUrl) {
        win?.close();
        toast({ title: "Viewer not configured", description: launch.error ?? "", variant: "destructive" });
        return;
      }
      if (launch.requestedLevel && launch.requestedLevel !== "study" && launch.launchLevel === "study") {
        toast({ title: "Viewer opened at study level", description: "The configured viewer URL cannot navigate to the exact image." });
      }
      if (win) {
        try { win.opener = null; } catch { /* cross-origin after nav — fine */ }
        win.location.href = safeUrl;
      } else {
        window.open(safeUrl, "_blank", "noopener");
      }
    } catch (err) {
      win?.close();
      toast({ title: "Could not open viewer", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  // ── Derived entries ──────────────────────────────────────────────────────

  const measurementSections = buildMeasurementSections(measurement, studyInstanceUID);
  const dopplerRows = dopplerQuery.data ?? [];
  const dopplerGroups = dopplerRows
    .map((row) => ({ row, entries: buildDopplerEntries(row, studyInstanceUID) }))
    .filter((g) => g.entries.length > 0);

  const isLoading = measQuery.isLoading || dopplerQuery.isLoading;
  const hasAnyEntries = measurementSections.length > 0 || dopplerGroups.length > 0;

  function renderRow(entry: MeasurementEntry) {
    const canPin = !!draftId && !!entry.provenance?.sopInstanceUID;
    return (
      <MeasurementEntryRow
        key={entry.key}
        entry={entry}
        inserted={insertedKeys.has(entry.key)}
        canPin={canPin}
        canInsert={canInsert}
        onInsert={() => handleInsert(entry)}
        onApproveInsert={() => handleApproveAndInsert(entry)}
        onTrace={() => setTraceEntry(entry)}
        onOpenImage={() => void openSourceImage(entry)}
        onPin={() => pinKeyImageMutation.mutate(entry)}
        onKeyDown={(e) => handleRowKeyDown(e, entry)}
      />
    );
  }

  return (
    <div className="space-y-2" data-testid="usg-measurement-review-panel">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">USG Measurements</span>
          {measurement && (
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${STATUS_BADGE_MAP[measurement.status] ?? ""}`}>
              {measurement.status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <Button
          variant="outline" size="sm" className="h-6 px-2 text-[10px]"
          onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${extractMutation.isPending ? "animate-spin" : ""}`} />
          {extractMutation.isPending ? "Extracting…" : "Re-Extract"}
        </Button>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
        <AlertCircle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-[10px] text-amber-800 leading-snug">
          <strong>Human verification required.</strong> Review extracted values before approving — nothing is
          auto-finalized or inserted into the report without explicit action.
        </p>
      </div>

      {isLoading && <p className="text-[11px] text-muted-foreground text-center py-3">Loading measurements…</p>}

      {!isLoading && !hasAnyEntries && (
        <div className="text-center py-4 space-y-2">
          <p className="text-[11px] text-muted-foreground">No extracted measurements for this study.</p>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending}>
            <RefreshCw className={`h-3 w-3 mr-1 ${extractMutation.isPending ? "animate-spin" : ""}`} />
            Extract Now
          </Button>
        </div>
      )}

      {!isLoading && hasAnyEntries && (
        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-0.5">
          {measurementSections.map((section) => (
            <div key={section.section} className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-0.5">
                {section.section}
              </div>
              <div className="space-y-1">{section.entries.map(renderRow)}</div>
            </div>
          ))}

          {dopplerGroups.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-0.5">Doppler</div>
              <div className="space-y-1.5">
                {dopplerGroups.map(({ row, entries }) => (
                  <div key={row.id} className="rounded border p-1.5 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold truncate">
                        {row.vesselName}{row.side && row.side !== "unknown" ? ` (${capitalize(row.side)})` : ""}
                      </span>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${STATUS_BADGE_MAP[row.status] ?? ""}`}>
                        {row.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {row.status === "pending_review" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm" className="h-5 px-1.5 text-[9px] flex-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => dopplerApproveMutation.mutate(row.id)} disabled={dopplerApproveMutation.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm" variant="destructive" className="h-5 px-1.5 text-[9px] flex-1"
                          onClick={() => dopplerRejectMutation.mutate(row.id)} disabled={dopplerRejectMutation.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1">{entries.map(renderRow)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Whole-extraction review (single usg_measurements row — backend has no
          per-field approval, only per-row). */}
      {measurement && measurement.status === "pending_review" && (
        <div className="rounded border border-blue-200 bg-blue-50 p-2 space-y-1.5">
          <p className="text-[11px] font-semibold text-blue-900">Radiologist Review</p>
          <Textarea
            placeholder="Review notes (optional)…"
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            className="bg-white text-[11px]"
            rows={2}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm" className="h-7 text-[11px] flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => approveMutation.mutate(measurement.id)} disabled={approveMutation.isPending}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
            </Button>
            <Button
              size="sm" variant="destructive" className="h-7 text-[11px] flex-1"
              onClick={() => rejectMutation.mutate(measurement.id)} disabled={rejectMutation.isPending}
            >
              <XCircle className="h-3 w-3 mr-1" /> Reject
            </Button>
          </div>
        </div>
      )}
      {measurement && measurement.status === "approved" && (
        <div className="rounded border border-green-200 bg-green-50 p-2 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <p className="text-[11px] text-green-800">
            Approved by {measurement.reviewedBy}
            {measurement.reviewNotes ? <span className="block text-[10px] text-green-700">{measurement.reviewNotes}</span> : null}
          </p>
        </div>
      )}

      {/* Trace dialog */}
      <Dialog open={!!traceEntry} onOpenChange={(open) => !open && setTraceEntry(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Activity className="h-5 w-5 text-primary" />
              Measurement Provenance Traceability
            </DialogTitle>
            <DialogDescription>
              Tracing the precise DICOM acquisition or OCR origin of this measurement.
            </DialogDescription>
          </DialogHeader>

          {traceEntry && (() => {
            const item = traceEntry.provenance;
            const studyUid = item?.studyInstanceUID || traceEntry.studyInstanceUID;
            const seriesUid = item?.seriesInstanceUID || "N/A";
            const sopUid = item?.sopInstanceUID || "N/A";
            const frameNum = item?.frameNumber ?? 1;
            const sourceType = item?.sourceType || traceEntry.source || "OCR";
            const confidence = item?.sourceConfidence || traceEntry.confidence || "medium";
            const rawVal = item?.rawExtractedValue || traceEntry.value || "—";
            const normVal = item?.normalizedValue || traceEntry.value || "—";
            const unit = item?.unit || "N/A";
            const engineVer = item?.extractedByEngineVersion || traceEntry.engineVersion || "1.5.0";
            const extTime = item?.extractedAt
              ? new Date(item.extractedAt).toLocaleString()
              : traceEntry.createdAt ? new Date(traceEntry.createdAt).toLocaleString() : "N/A";

            const handleLaunch = (viewer: "OHIF" | "WEASIS") => {
              void launchViewer(studyUid, viewer, pacsSettingsRecord, toast);
            };

            const handleCopy = () => {
              const payload = item ?? {
                studyInstanceUID: studyUid, seriesInstanceUID: seriesUid, sopInstanceUID: sopUid,
                frameNumber: frameNum, sourceType, sourceLabel: traceEntry.label.toUpperCase(),
                sourceConfidence: confidence, sourcePath: "Default Trace fallback",
                rawExtractedValue: rawVal, normalizedValue: normVal, unit,
                extractedAt: traceEntry.createdAt || new Date().toISOString(), extractedByEngineVersion: engineVer,
              };
              // R2.0 fix: writeText() can reject (document not focused right
              // after a dialog opens/closes, denied permission, non-secure
              // context) — always catch it and only claim success when the
              // write actually resolved, instead of an unconditional toast.
              navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
                () => toast({
                  title: item ? "Trace JSON copied to clipboard" : "No trace JSON available — copied fallback metadata",
                }),
                (err: unknown) => toast({
                  title: "Could not copy to clipboard",
                  description: err instanceof Error ? err.message : "Clipboard write failed",
                  variant: "destructive",
                }),
              );
            };

            return (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4 border-b pb-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Measurement</label>
                    <div className="text-sm font-semibold">{traceEntry.label}</div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Final Value</label>
                    <div className="text-sm font-semibold text-primary">{traceEntry.value}{traceEntry.unit ? ` ${traceEntry.unit}` : ""}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs">Source Type</span>
                    <div className="mt-1">{getSourceBadge(sourceType)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Confidence</span>
                    <div className="mt-1">{getConfidenceBadge(confidence)}</div>
                  </div>

                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-xs">Source Path / Reference Tag</span>
                    <span className="font-mono text-xs break-all bg-muted p-1.5 rounded block mt-1">
                      {item?.sourcePath || "N/A (Default / Manual Entry)"}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-xs">Raw Extracted Value</span>
                    <span className="font-mono font-medium">{rawVal}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Normalized Value</span>
                    <span className="font-mono font-medium">{normVal}</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-xs">Unit</span>
                    <span>{unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Engine Version</span>
                    <span className="font-mono text-xs">{engineVer}</span>
                  </div>

                  <div className="col-span-2 border-t pt-3 mt-1 space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground block">DICOM Identifiers</label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Study UID:</span>
                        <div className="font-mono truncate select-all" title={studyUid}>{studyUid}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Series UID:</span>
                        <div className="font-mono truncate select-all" title={seriesUid}>{seriesUid}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SOP UID:</span>
                        <div className="font-mono truncate select-all" title={sopUid}>{sopUid}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Frame / Time:</span>
                        <div>Frame {frameNum} · {extTime}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end border-t pt-4 mt-2">
                  <Button size="sm" variant="outline" onClick={() => handleLaunch("OHIF")}>Open Source Image in OHIF</Button>
                  <Button size="sm" variant="outline" onClick={() => handleLaunch("WEASIS")}>Open Source Image in Weasis</Button>
                  <Button size="sm" variant="secondary" onClick={handleCopy}>Copy Trace JSON</Button>
                  <Button size="sm" onClick={() => setTraceEntry(null)}>Close</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
