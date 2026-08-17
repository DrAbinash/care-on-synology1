import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { api, getStaffToken } from "@/lib/fetchApi";
import { readStaffSession, ERP_SESSION_KEY, canAccess, normalizeRole } from "@/lib/staffSession";
import { toUnifiedStatus, worklistRoleView, priorityInfo, type WorklistRoleView } from "@/lib/radiologyStatus";
import { launchViewer, recordFailedLaunch, recordSuccessfulLaunch, resolveActiveProfile } from "@/lib/viewerService";
import { launchRadiologyStudy } from "@/lib/studyLaunchService";
import { normalizeModality, isUltrasoundModality } from "@/lib/usgModality";
import { DATE_PRESETS, toISTDateStr } from "@/lib/dateRangePresets";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ScanSearch, RefreshCw, ExternalLink, Sparkles, FileEdit, CheckCircle2,
  Search, Filter, Clock, CheckCheck, AlertCircle, MonitorPlay, Tv2,
  ClipboardList, CalendarDays, ShieldCheck, ShieldOff, Database,
  ChevronDown, ChevronUp, Eye, MessageSquare, ThumbsUp, ThumbsDown, Trash2,
  X, Activity, Stethoscope, Printer, Gem, FileUp, Loader2, Columns2, Maximize2, Link2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import QueueModalityFilter from "@/components/radiology/QueueModalityFilter";
import { aiClient } from "@/lib/aiClient";
import {
  OVERNIGHT_AGE_CHIPS,
  OVERNIGHT_STATUS_CHIPS,
  OVERNIGHT_STATUS_STYLE,
  compareOvernightWorklistRows,
  formatIstTime,
  formatRelativeAgo,
  overnightStatusMatches,
  studyInOvernightAgeView,
  type OvernightAgeChip,
  type OvernightAiPayload,
  type OvernightDisplayStatus,
  type OvernightStatusChip,
} from "@/lib/overnightAiDraft";

type WorklistEntry = {
  id: number;
  studyId: number | null;
  patientId: number | null;
  dicomPatientId: string | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  sourceAeTitle: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  overnightAi?: OvernightAiPayload;
  overnightEligible?: boolean;
  reportId: number | null;
  deliveryStatus: string | null;
  uhid?: string | null;        // Phase C: ERP UHID via patients join
  billNumber?: string | null;  // Phase C: bill number via study→bill join
  testName?: string | null;    // Catalog test from billing when study is linked
  priority?: string | null;    // Phase C: reuses radiology_studies.priority
  // R2.0 — canonical ultrasound integration: USG/Doppler measurement +
  // key-image counts and latest report-draft status, scalar-subqueried by
  // worklistId in GET /api/radiology/pacs-worklist. Present for every row;
  // 0/null for non-ultrasound studies with no USG data.
  usgMeasurementCount?: number;
  usgKeyImageCount?: number;
  usgReportStatus?: "draft" | "pending_review" | "verified" | "finalized" | "amended" | "archived" | null;
  createdAt: string;
  updatedAt: string;
  lockUserId?: number | null;
  lockUserName?: string | null;
  lockTime?: string | null;
  lockLastActivityAt?: string | null;
  lockWorkstation?: string | null;
};

function displayTestName(entry: Pick<WorklistEntry, "testName" | "studyDescription">): string {
  const name = entry.testName?.trim() || entry.studyDescription?.trim();
  return name || "\u2014";
}

function formatWorklistAgeSex(entry: Pick<WorklistEntry, "age" | "sex">): string | null {
  const parts = [entry.age, entry.sex].filter(Boolean);
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}

function formatWorklistStudyDate(raw: string | null | undefined): string {
  if (!raw) return "\u2014";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = parseInt(m, 10) - 1;
    if (mi >= 0 && mi < 12) return `${parseInt(day, 10)} ${months[mi]} ${y}`;
    return `${y}-${m}-${day}`;
  }
  return raw;
}

const WORKLIST_MODALITY_COLORS: Record<string, string> = {
  CT: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  MR: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
  MRI: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
  CR: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
  DX: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
  US: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800",
  USG: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800",
  NM: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
  PT: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  XA: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
};

function worklistModalityBadgeClass(modality: string): string {
  const key = modality?.toUpperCase() ?? "OT";
  return WORKLIST_MODALITY_COLORS[key] ?? "bg-muted/60 text-muted-foreground border-border";
}

function canLaunchViewer(entry: Pick<WorklistEntry, "studyInstanceUID" | "accessionNumber">): boolean {
  return Boolean(entry.studyInstanceUID?.trim() || entry.accessionNumber?.trim());
}

function formatWorklistUhid(entry: Pick<WorklistEntry, "uhid" | "dicomPatientId">): string | null {
  return entry.uhid?.trim() || entry.dicomPatientId?.trim() || null;
}

type WorklistActionBtnProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "weasis" | "ohif" | "report" | "ai" | "neutral" | "cc" | "warn";
};

function WorklistActionBtn({ icon: Icon, label, onClick, disabled, title, tone = "neutral" }: WorklistActionBtnProps) {
  const tones: Record<NonNullable<WorklistActionBtnProps["tone"]>, string> = {
    weasis: "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
    ohif: "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",
    report: "border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-600",
    ai: "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300",
    cc: "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 dark:bg-teal-950/30 dark:text-teal-300",
    warn: "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300",
    neutral: "border-border bg-background text-foreground hover:bg-muted/60",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 w-[46px] h-[40px] text-[9px] font-semibold leading-tight transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${tones[tone]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="text-center leading-none">{label}</span>
    </button>
  );
}

const WORKLIST_TH = "px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const WORKLIST_TD = "px-2 py-1.5 align-top text-[12px]";

const WORKLIST_COL_STORAGE_KEY = "radiologyWorklistColumnVisibility";

type WorklistOptionalColumn =
  | "measurements" | "images" | "usgReport" | "studyDescription"
  | "refDoctor" | "accession" | "sourceAe" | "studyDate" | "createdAt"
  | "radiologist" | "lockStatus" | "aiDraft";

type WorklistColumnVisibility = Record<WorklistOptionalColumn, boolean>;

const WORKLIST_COL_DEFAULTS: WorklistColumnVisibility = {
  measurements: false,
  images: false,
  usgReport: false,
  studyDescription: false,
  refDoctor: true,
  accession: true,
  sourceAe: false,
  studyDate: true,
  createdAt: true,
  radiologist: true,
  lockStatus: true,
  aiDraft: false,
};

/** When the worklist is opened for USG, surface USG-specific columns by default. */
const WORKLIST_COL_USG_DEFAULTS: WorklistColumnVisibility = {
  ...WORKLIST_COL_DEFAULTS,
  measurements: true,
  images: true,
  usgReport: true,
  aiDraft: true,
  sourceAe: true,
};

const WORKLIST_COL_LABELS: Record<WorklistOptionalColumn, string> = {
  measurements: "Measurements",
  images: "Images",
  usgReport: "USG Report",
  studyDescription: "Study Description",
  refDoctor: "Ref. Doctor",
  accession: "Accession No",
  sourceAe: "Source AE",
  studyDate: "Study Date",
  createdAt: "Created At",
  radiologist: "Radiologist",
  lockStatus: "Lock Status",
  aiDraft: "AI Draft",
};

function loadWorklistColumnVisibility(modalityHint?: string): WorklistColumnVisibility {
  const usg = modalityHint ? isUltrasoundModality(modalityHint) || normalizeModality(modalityHint) === "US" : false;
  const base = usg ? WORKLIST_COL_USG_DEFAULTS : WORKLIST_COL_DEFAULTS;
  try {
    const raw = localStorage.getItem(WORKLIST_COL_STORAGE_KEY);
    if (!raw) return { ...base };
    return { ...base, ...(JSON.parse(raw) as Partial<WorklistColumnVisibility>) };
  } catch {
    return { ...base };
  }
}

function saveWorklistColumnVisibility(cols: WorklistColumnVisibility) {
  localStorage.setItem(WORKLIST_COL_STORAGE_KEY, JSON.stringify(cols));
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  STUDY_RECEIVED: { label: "Received", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Clock className="h-3 w-3" /> },
  AI_DRAFT_READY: { label: "AI Draft Ready", color: "bg-purple-100 text-purple-800 border-purple-200", icon: <Sparkles className="h-3 w-3" /> },
  REPORT_IN_PROGRESS: { label: "In Progress", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: <FileEdit className="h-3 w-3" /> },
  REPORT_FINAL: { label: "Final", color: "bg-green-100 text-green-800 border-green-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  DELIVERED: { label: "Delivered", color: "bg-gray-100 text-gray-700 border-gray-200", icon: <CheckCheck className="h-3 w-3" /> },
};

function StatusBadge({ status, deliveryStatus }: { status: string; deliveryStatus?: string | null }) {
  // Phase C: staff always see the unified 7-step vocabulary. The raw
  // internal status stays visible in the tooltip for troubleshooting.
  const u = toUnifiedStatus(status, deliveryStatus);
  const icon = STATUS_CONFIG[status]?.icon ?? null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${u.color}`}
      title={`Internal status: ${status}${deliveryStatus ? ` · delivery: ${deliveryStatus}` : ""}`}
    >
      {icon}
      {u.label}
    </span>
  );
}

function LockBadge({ entry, currentUserId }: { entry: any; currentUserId?: number | null }) {
  const lastAct = entry.lockLastActivityAt || entry.lockTime;
  // M1.6A — prefer the SERVER-computed expiry (lock_last_activity_at + the
  // configured TTL); the 30-minute window is only the pre-lock-era fallback.
  const isLocked = entry.lockUserId && (
    entry.lockExpiresAt
      ? new Date(entry.lockExpiresAt).getTime() > Date.now()
      : lastAct && (Date.now() - new Date(lastAct).getTime()) <= 30 * 60 * 1000
  );
  
  if (!isLocked) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
        <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
        Available
      </span>
    );
  }

  const isMine = entry.lockUserId === currentUserId;
  const timeStr = entry.lockTime ? new Date(entry.lockTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

  if (isMine) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-900/50" title={`Locked by you at ${timeStr}`}>
        <span className="w-1 h-1 rounded-full bg-yellow-500" />
        Opened by You
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50" title={`Locked by ${entry.lockUserName || "another user"} at ${timeStr}`}>
      <span className="w-1 h-1 rounded-full bg-red-500" />
      Locked by {entry.lockUserName || "User"}
    </span>
  );
}

const MODALITY_OPTIONS = ["all", "CR", "MR", "CT", "US", "MG", "BMD", "OT"];
const STATUS_OPTIONS = ["all", "STUDY_RECEIVED", "AI_DRAFT_READY", "REPORT_IN_PROGRESS", "REPORT_FINAL", "DELIVERED"];

const AI_DRAFT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  NONE:    { label: "None",    color: "bg-gray-100 text-gray-600 border-gray-200" },
  PENDING: { label: "Pending", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  READY:   { label: "Ready",   color: "bg-purple-50 text-purple-700 border-purple-200" },
  ERROR:   { label: "Error",   color: "bg-red-50 text-red-700 border-red-200" },
};

// R2.0 — USG/Doppler report-draft lifecycle status badge, styled consistently
// with STATUS_CONFIG/AI_DRAFT_STATUS_CONFIG's Record<label,color> + rounded
// pill convention above.
const USG_REPORT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:          { label: "Draft",          color: "bg-gray-100 text-gray-600 border-gray-200" },
  pending_review: { label: "Pending Review", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  verified:       { label: "Verified",       color: "bg-blue-50 text-blue-700 border-blue-200" },
  finalized:      { label: "Finalized",      color: "bg-green-100 text-green-800 border-green-200" },
  amended:        { label: "Amended",        color: "bg-purple-50 text-purple-700 border-purple-200" },
  archived:       { label: "Archived",       color: "bg-gray-100 text-gray-500 border-gray-200" },
};

function UsgReportStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg = USG_REPORT_STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// R2.0 — small count badge for the Measurements/Images columns. Zero renders
// as a muted em-dash (matching the file's existing empty-cell convention,
// e.g. fmtDate/entry.studyDescription above), matching counts render as a
// colored pill.
function UsgCountBadge({ count, color }: { count: number; color: string }) {
  if (!count) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${color}`}>
      {count}
    </span>
  );
}

function OvernightAiDraftCell({
  entry,
  overnightMode,
  onViewDraft,
  onHelpful,
  onNeedsImprovement,
  onRetry,
}: {
  entry: WorklistEntry;
  overnightMode: boolean;
  onViewDraft: () => void;
  onHelpful: () => void;
  onNeedsImprovement: () => void;
  onRetry?: () => void;
}) {
  const display = (entry.overnightAi?.displayStatus ?? (
    entry.aiDraftStatus === "READY" ? "READY"
      : entry.aiDraftStatus === "ERROR" ? "ERROR"
        : entry.aiDraftStatus === "PENDING" ? "QUEUED"
          : "NONE"
  )) as OvernightDisplayStatus;
  const ai = entry.overnightAi;
  const style = overnightMode
    ? (OVERNIGHT_STATUS_STYLE[display] ?? OVERNIGHT_STATUS_STYLE.NONE)
    : (AI_DRAFT_STATUS_CONFIG[entry.aiDraftStatus]?.color ?? OVERNIGHT_STATUS_STYLE.NONE);
  const queuedAgo = formatRelativeAgo(ai?.queuedAt);
  const startedAgo = formatRelativeAgo(ai?.startedAt);
  const completedAt = formatIstTime(ai?.completedAt);
  let detail: string | null = null;
  if (display === "QUEUED" || display === "RETRYING") {
    const pos = ai?.queuePosition != null ? `Queue #${ai.queuePosition}` : null;
    detail = [pos, queuedAgo ? `Queued ${queuedAgo}` : null].filter(Boolean).join(" · ");
  } else if (display === "RUNNING") {
    detail = startedAgo ? `Started ${startedAgo}` : "Ollama processing";
  } else if (display === "READY") {
    detail = completedAt ? `Completed ${completedAt}` : null;
  } else if (display === "ERROR") {
    detail = ai?.attemptCount ? `Attempt ${ai.attemptCount}` : null;
  } else if (display === "STUCK") {
    detail = startedAgo ? `No progress ${startedAgo}` : "Stale worker lock";
  }
  const label = overnightMode
    ? (display === "NONE" ? "—" : display === "STUCK" ? "STUCK?" : display)
    : (entry.aiDraftStatus === "NONE" ? "—" : entry.aiDraftStatus);

  return (
    <div className="flex flex-col gap-0.5 min-w-[7.5rem]">
      <div className="flex items-center gap-1">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${style}`}>
          {display === "RUNNING" && <RefreshCw className="h-3 w-3 animate-spin" />}
          {display === "QUEUED" || display === "RETRYING" ? label : label}
        </span>
        {display === "READY" && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs" title="View AI Draft" onClick={onViewDraft}>
            <Eye className="h-3 w-3" />
          </Button>
        )}
        {display === "READY" && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs text-green-600" title="Helpful" onClick={onHelpful}>
            <ThumbsUp className="h-3 w-3" />
          </Button>
        )}
        {display === "READY" && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-xs text-red-500" title="Needs Improvement" onClick={onNeedsImprovement}>
            <ThumbsDown className="h-3 w-3" />
          </Button>
        )}
        {display === "ERROR" && ai?.lastError && (
          <Button size="sm" variant="ghost" className="h-6 px-1 text-[10px]" title={ai.lastError} onClick={() => window.alert(ai.lastError)}>
            View error
          </Button>
        )}
        {display === "ERROR" && onRetry && (
          <Button size="sm" variant="ghost" className="h-6 px-1 text-[10px]" title="Retry this study (idempotent; will not start a second in-flight job)" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      {overnightMode && detail && (
        <span className="text-[10px] text-muted-foreground leading-tight">{detail}</span>
      )}
    </div>
  );
}

/**
 * Usability: hours a non-final study has been waiting, computed purely from
 * the existing createdAt timestamp already returned by the API. No new
 * column, no DB change. Threshold is configurable (see Settings → General
 * → Radiology → "Aging alert after (hours)"), default 4h.
 */
function agingHours(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return (Date.now() - created) / (1000 * 60 * 60);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "\u2014";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function StudyQueuePanel() {
  const session = readStaffSession();
  const { data: studies = [], isLoading, refetch, isFetching } = useQuery<{
    id: number; patientName: string; modality: string; status: string;
    createdAt: string; assignedRadiologist: string | null;
    lockUserId?: number | null;
    lockUserName?: string | null;
    lockTime?: string | null;
    lockLastActivityAt?: string | null;
    lockWorkstation?: string | null;
  }[]>({
    queryKey: ["study-queue-brief"],
    queryFn: () => api.get("/api/radiology/worklist"),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{studies.length} studies in queue</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin mr-1.5" : "mr-1.5"} /> Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : studies.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No studies in queue</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Patient</th>
                <th className="px-3 py-2 text-left">Modality</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Lock Status</th>
                <th className="px-3 py-2 text-left">Radiologist</th>
                <th className="px-3 py-2 text-left">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {studies.slice(0, 100).map((s) => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-medium">{s.patientName}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">{s.modality}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-xs">{s.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    <LockBadge entry={s} currentUserId={session?.user?.id} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{s.assignedRadiologist ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Live Debug Panel ─────────────────────────────────────────────────────────
function PacsDebugPanel({
  entries,
  filtered,
  isLoading,
  isError,
  error,
  lastRefresh,
  statusFilter,
  modalityFilter,
  search,
  dbTotalRows,
  onForceRefresh,
  onClearCache,
  showSentinel,
  onToggleSentinel,
}: {
  entries: WorklistEntry[];
  filtered: WorklistEntry[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  lastRefresh: Date | null;
  statusFilter: string;
  modalityFilter: string;
  search: string;
  dbTotalRows: number | null;
  onForceRefresh: () => void;
  onClearCache: () => void;
  showSentinel: boolean;
  onToggleSentinel: () => void;
}) {
  const session = readStaffSession();
  const hasToken = !!session?.token;
  const tokenSnippet = session?.token
    ? session.token.slice(0, 12) + "…"
    : "none";

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border-2 border-blue-400 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-600 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900/70 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 font-mono text-xs font-bold text-blue-900 dark:text-blue-200">
          <Database className="h-3.5 w-3.5" />
          PACS WORKLIST / DICOM RECEIVED STUDIES — LIVE DIAGNOSTIC PANEL
          {isLoading && <span className="ml-2 text-blue-500 animate-pulse">● fetching…</span>}
          {isError && <span className="ml-2 text-red-600">⚠ ERROR</span>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-blue-600" /> : <ChevronDown className="h-4 w-4 text-blue-600" />}
      </button>

      {expanded && (
        <div className="p-3 font-mono text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {/* Auth */}
          <div className="col-span-full flex items-center gap-2 mb-1">
            {hasToken
              ? <><ShieldCheck className="h-3.5 w-3.5 text-green-600" /><span className="text-green-700 dark:text-green-400 font-semibold">AUTH: ACTIVE</span></>
              : <><ShieldOff className="h-3.5 w-3.5 text-red-600" /><span className="text-red-700 font-semibold">AUTH: NO TOKEN — will get 401</span></>
            }
          </div>

          <div><span className="text-blue-500 select-none">Username      : </span>{session?.user?.name ?? "—"}</div>
          <div><span className="text-blue-500 select-none">Email         : </span>{session?.user?.email ?? "—"}</div>
          <div><span className="text-blue-500 select-none">Role          : </span><span className="font-bold">{session?.user?.role ?? "—"}</span></div>
          <div><span className="text-blue-500 select-none">Token prefix  : </span>{tokenSnippet}</div>
          <div><span className="text-blue-500 select-none">Permissions   : </span>{session?.user?.permissions?.join(", ") || "none"}</div>

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div><span className="text-blue-500 select-none">API endpoint  : </span>GET /api/radiology/pacs-worklist</div>
          <div><span className="text-blue-500 select-none">Active status : </span>{statusFilter === "all" ? "ALL (no filter)" : statusFilter}</div>
          <div><span className="text-blue-500 select-none">Active modality: </span>{modalityFilter === "all" ? "ALL (no filter)" : modalityFilter}</div>
          <div><span className="text-blue-500 select-none">Search text   : </span>{search || "(empty)"}</div>

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div>
            <span className="text-blue-500 select-none">DB total rows : </span>
            {dbTotalRows === null
              ? <span className="text-blue-400">loading…</span>
              : <span className={dbTotalRows === 0 ? "text-red-600 font-bold" : "text-green-700 dark:text-green-400 font-bold"}>{dbTotalRows} rows in radiology_worklist</span>
            }
          </div>
          <div>
            <span className="text-blue-500 select-none">API returned  : </span>
            <span className={entries.length === 0 && !isLoading ? "text-orange-600 font-bold" : "font-bold"}>{isLoading ? "…" : `${entries.length} rows`}</span>
          </div>
          <div><span className="text-blue-500 select-none">After filter  : </span>{isLoading ? "…" : `${filtered.length} rows visible`}</div>
          <div><span className="text-blue-500 select-none">Last refresh  : </span>{lastRefresh ? lastRefresh.toLocaleTimeString() : "pending…"}</div>

          {isError && (
            <div className="col-span-full text-red-700 font-semibold">
              Error: {error?.message ?? "unknown"}
            </div>
          )}

          <div className="col-span-full border-t border-blue-200 dark:border-blue-700 my-1" />

          <div className="col-span-full flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-100" onClick={onForceRefresh}>
              <RefreshCw className="h-3 w-3 mr-1" /> Force Refetch
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-100" onClick={onClearCache}>
              Clear RQ Cache + Refetch
            </Button>
            <Button
              size="sm"
              variant={showSentinel ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={onToggleSentinel}
              title="Inject a fake hardcoded row to confirm the table renders correctly"
            >
              {showSentinel ? "Hide" : "Show"} Sentinel Row
            </Button>
          </div>
          <div className="col-span-full text-blue-400 mt-1">
            Check browser Console → filter "[PACS" for request/response logs.
          </div>
        </div>
      )}
    </div>
  );
}

// Hardcoded sentinel row — proves the table renders when shown
const SENTINEL_ROW: WorklistEntry = {
  id: -1,
  studyId: null,
  patientId: null,
  dicomPatientId: "TEST-001",
  patientName: "SENTINEL TEST PATIENT",
  age: "40Y",
  sex: "M",
  modality: "CT",
  studyDescription: "HARDCODED SENTINEL — table render test",
  studyDate: new Date().toISOString().slice(0, 10),
  accessionNumber: "ACC-SENTINEL-001",
  studyInstanceUID: null,
  aeTitle: "SENTINEL_AE",
  ipAddress: null,
  port: null,
  referringDoctor: "Debug Doctor",
  weasisUrl: null,
  sourceAeTitle: "SENTINEL_AE",
  status: "STUDY_RECEIVED",
  assignedRadiologist: null,
  aiDraftStatus: "NONE",
  reportId: null,
  deliveryStatus: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Single open-report path — Reporting Workspace for every modality (USG Companion is embedded there). */
function reportingWorkspacePath(entry: Pick<WorklistEntry, "id">, focus = false): string {
  const base = `/radiology/report/${entry.id}`;
  return focus ? `${base}?focus=1` : base;
}

export default function RadiologyWorklist() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const session = readStaffSession();
  // Hope / partner deep-links may pass ?q=Patient+Name alongside ?modality=MR.
  const [search, setSearch] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("q") ?? "";
    } catch {
      return "";
    }
  });
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Phase C: role-based view. Page ACCESS is still governed solely by the
  // existing permission system; this only decides which action buttons render.
  const viewRole: WorklistRoleView = worklistRoleView(normalizeRole(session?.user?.role || ""));
  const isOwnerView = viewRole === "owner";
  const isRadView = viewRole === "radiologist" || isOwnerView;
  const isTechView = viewRole === "technician";
  const isReceptionView = viewRole === "reception";
  const may = (path: string) => canAccess(session, path);
  // PR B — USG Platform Consolidation: the "USG Worklist" sidebar entry links
  // here with `?modality=USG` so it reuses this SAME worklist pre-filtered,
  // instead of a second worklist component. Any ultrasound spelling
  // ("USG", "Ultrasound", "Doppler", ...) normalizes to the existing "US"
  // filter bucket via the same normalizer the modality Select already uses.
  const [modalityFilter, setModalityFilter] = useState(() => {
    const param = new URLSearchParams(window.location.search).get("modality");
    if (!param) return "all";
    const normalized = normalizeModality(param);
    return MODALITY_OPTIONS.includes(normalized) ? normalized : "all";
  });
  const [lockFilter, setLockFilter] = useState("all");
  const [aiDraftFilter, setAiDraftFilter] = useState<"all" | "overnight">("all");
  const [overnightAgeChip, setOvernightAgeChip] = useState<OvernightAgeChip>("last_24h");
  const [overnightStatusChip, setOvernightStatusChip] = useState<OvernightStatusChip>("all");
  const [selectedOvernightIds, setSelectedOvernightIds] = useState<Set<number>>(new Set());
  const [autoLinking, setAutoLinking] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  function setDatePreset(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
  }
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showSentinel, setShowSentinel] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  // Reports are composed in Word, not this app's structured builder — this
  // tracks which row's file input is mid-upload, matching OutsourceWorklist's
  // "Attach Report" pattern exactly.
  const [attachingStudyId, setAttachingStudyId] = useState<number | null>(null);
  const [draftViewer, setDraftViewer] = useState<{ id: number; draft: Record<string, unknown> | null } | null>(null);
  // M1.6B1 — assignment management + live workload
  const [showWorkload, setShowWorkload] = useState(false);
  const [feedbackEntry, setFeedbackEntry] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<WorklistColumnVisibility>(() =>
    loadWorklistColumnVisibility(new URLSearchParams(window.location.search).get("modality") ?? undefined),
  );

  // When filtering to USG, ensure USG ops columns are visible (without wiping user prefs permanently).
  useEffect(() => {
    if (modalityFilter === "US" || isUltrasoundModality(modalityFilter)) {
      setColumnVisibility((prev) => ({
        ...prev,
        measurements: true,
        images: true,
        usgReport: true,
        aiDraft: true,
        sourceAe: true,
      }));
    }
  }, [modalityFilter]);
  const prevEntriesLen = useRef(-1);

  function toggleColumn(col: WorklistOptionalColumn) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [col]: !prev[col] };
      saveWorklistColumnVisibility(next);
      return next;
    });
  }

  const col = columnVisibility;

  const overnightMode = aiDraftFilter === "overnight";
  const { data: entries = [], isLoading, isError, error, refetch } = useQuery<WorklistEntry[]>({
    queryKey: ["radiology-pacs-worklist", { overnightDrafts: overnightMode }],
    queryFn: async () => {
      const url = overnightMode ? `/api/radiology/pacs-worklist?overnightDrafts=1` : `/api/radiology/pacs-worklist`;
      console.log("[PACS-WORKLIST] Fetching:", url);
      const session = readStaffSession();
      console.log("[PACS-WORKLIST] Auth token present:", !!session?.token, "| role:", session?.user?.role);
      try {
        const result = await api.get<WorklistEntry[]>(url);
        console.log("PACS API RESPONSE", result);
        console.log("[PACS-WORKLIST] Rows returned:", result.length);
        if (result.length > 0) {
          console.log("[PACS-WORKLIST] First row:", JSON.stringify(result[0]).slice(0, 400));
        } else {
          console.warn("[PACS-WORKLIST] API returned 0 rows. Check radiology_worklist table in DB.");
        }
        return result;
      } catch (err) {
        console.error("[PACS-WORKLIST] Fetch/auth error:", err);
        throw err;
      }
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
  });

  // Live refresh when Orthanc pushes a study (SSE; falls back to 30s poll above).
  useEffect(() => {
    const token = getStaffToken();
    if (!token) return;
    const base = (import.meta as { env: { BASE_URL?: string } }).env.BASE_URL || "/";
    const url = `${base}api/radiology/pacs-worklist-stream?staffToken=${encodeURIComponent(token)}`.replace(/\/+/g, "/").replace(":/", "://");
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
      es.onmessage = () => {
        void refetch();
        void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist-count"] });
      };
    } catch {
      /* SSE unavailable — 30s poll remains */
    }
    return () => { es?.close(); };
  }, [refetch, qc]);

  // DB total count — separate query, no filters, for debug panel
  const { data: countData } = useQuery<{ totalRows: number }>({
    queryKey: ["radiology-pacs-worklist-count"],
    queryFn: async () => {
      const result = await api.get<{ totalRows: number }>("/api/radiology/pacs-worklist/count");
      console.log("[PACS-WORKLIST] DB total rows:", result.totalRows);
      return result;
    },
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // M1.6B1 — assignable radiologists + assignment writes + live workload.
  const { data: radiologistsData } = useQuery<{ success: boolean; radiologists: Array<{ id: number; name: string; role: string }> }>({
    queryKey: ["radiology-radiologists"],
    queryFn: () => api.get("/api/radiology/radiologists"),
    staleTime: 5 * 60_000,
  });
  const radiologists = radiologistsData?.radiologists ?? [];

  const assignMutation = useMutation({
    mutationFn: async ({ worklistId, radiologistId }: { worklistId: number; radiologistId: number | null }) => {
      const path = radiologistId === null
        ? `/api/radiology/worklist-assignment/${worklistId}/unassign`
        : `/api/radiology/worklist-assignment/${worklistId}/assign`;
      return api.post<{ success: boolean; outcome: string; assignment?: { assignedRadiologistName?: string | null } }>(
        path, radiologistId === null ? {} : { radiologistId },
      );
    },
    onSuccess: (res) => {
      if (!res.success) {
        toast({ title: "Assignment not changed", description: res.outcome.replaceAll("_", " ").toLowerCase(), variant: "destructive" });
      }
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      void qc.invalidateQueries({ queryKey: ["radiology-workload"] });
    },
    onError: (err) => {
      toast({ title: "Assignment failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    },
  });

  const { data: workload } = useQuery<{
    success: boolean;
    radiologists: Array<{ radiologistId: number; radiologistName: string; assignedPending: number; lockedNow: number; completedToday: number; avgPendingAgeHours: number | null }>;
    unassignedPending: number;
  }>({
    queryKey: ["radiology-workload"],
    queryFn: () => api.get("/api/radiology/workload"),
    enabled: showWorkload,
    refetchInterval: showWorkload ? 60_000 : false,
  });

  const { data: pacsViewerSettings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<{ key: string; value: string; category: string }[]>("/api/radiology/pacs-settings");
      const map: Record<string, string> = {};
      for (const r of rows) if (r.category === "viewer" || r.category === "radiology") map[r.key] = r.value;
      return map;
    },
    staleTime: 120_000,
  });

  // Phase E "Highlight Urgent / VIP studies" toggle (default ON when unset)
  const urgentHighlightOn = (pacsViewerSettings["urgent_highlight_enabled"] ?? "true") !== "false";

  const [activeNetworkProfile, setActiveNetworkProfile] = useState<"LAN" | "TAILSCALE" | "PUBLIC" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolveActiveProfile(pacsViewerSettings).then(({ profile }) => {
      if (!cancelled) setActiveNetworkProfile(profile);
    });
    return () => { cancelled = true; };
  }, [pacsViewerSettings]);

  const preferWeasis =
    pacsViewerSettings["default_viewer"] === "WEASIS" || activeNetworkProfile === "LAN";

  async function launchWorklistWeasis(entry: WorklistEntry) {
    if (!canLaunchViewer(entry)) {
      toast({
        title: "Cannot open Weasis",
        description: "This study has no DICOM Study UID or accession number yet.",
        variant: "destructive",
      });
      return;
    }
    const openTarget = window.open("about:blank", "_blank");
    try {
      const res = await launchRadiologyStudy(
        {
          studyInstanceUID: entry.studyInstanceUID,
          accessionNumber: entry.accessionNumber,
          worklistId: entry.id,
          viewer: "WEASIS",
          requestedMode: "AUTO",
        },
        pacsViewerSettings,
        {
          openTarget,
          pageIsHttps: window.location.protocol === "https:",
          recordSuccess: recordSuccessfulLaunch,
          recordFailure: recordFailedLaunch,
        },
      );
      if (!res.success) {
        openTarget?.close();
        // Fallback: server-built weasis:// URL (still needs StudyInstanceUID)
        if (entry.studyInstanceUID?.trim()) {
          const { openWeasisLaunchRedirect } = await import("@/lib/viewerService");
          await openWeasisLaunchRedirect(entry.studyInstanceUID, toast);
          return;
        }
        toast({
          title: "Failed to open Weasis",
          description: res.diagnostics.slice(-2).join(" · ") || res.errorCode || "Check Radiology Settings → Viewers.",
          variant: "destructive",
        });
      }
    } catch (err) {
      openTarget?.close();
      toast({
        title: "Failed to open Weasis",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    if (!isLoading && prevEntriesLen.current !== entries.length) {
      setLastRefresh(new Date());
      prevEntriesLen.current = entries.length;
      // Auto-show raw JSON if API returned rows but table is likely empty (first load)
      if (entries.length > 0) setShowRawJson(false);
    }
  }, [entries, isLoading]);

  const aiDraftMutation = useMutation({
    mutationFn: (entry: WorklistEntry) =>
      api.post("/api/internal/radiology/ai-draft", {
        studyId: entry.id,
        modality: entry.modality,
        studyDescription: entry.studyDescription ?? entry.modality,
        patientName: entry.patientName,
        age: entry.age ?? "",
        sex: entry.sex ?? "",
        accessionNumber: entry.accessionNumber,
        studyDate: entry.studyDate ?? "",
      }),
    onSuccess: (_data, entry) => {
      toast({ title: "AI Draft Ready", description: `Draft generated for ${entry.patientName}` });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to generate draft", variant: "destructive" });
    },
  });

  const markFinalMutation = useMutation({
    mutationFn: ({ entry, reason }: { entry: WorklistEntry; reason: string }) =>
      api.post("/api/internal/radiology/report-status", {
        accessionNumber: entry.accessionNumber,
        studyInstanceUID: entry.studyInstanceUID,
        status: "REPORT_FINAL",
        actor: "staff",
        softFinalOverride: true,
        softFinalReason: reason,
      }),
    onSuccess: (_data, { entry }) => {
      toast({ title: "Admin mark final", description: `Study ${entry.accessionNumber} marked as final (override)` });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Update failed", variant: "destructive" });
    },
  });

  // Attach an externally-produced (Word → PDF/DOCX) final report to a study.
  // Same two-step shape as OutsourceWorklist's "Attach Report": upload via
  // the existing generic /api/uploads (module "reports"), then link the
  // returned storagePath to the study.
  const attachReportMutation = useMutation({
    mutationFn: ({ studyId, filePath, fileName }: { studyId: number; filePath: string; fileName: string }) =>
      api.post("/api/radiology/report-attachments", { studyId, filePath, fileName }),
    onSuccess: () => {
      toast({
        title: "Report attached",
        description: "Stored on the study. Open Report Delivery to print/share — attach is not yet mirrored into the patient portal.",
      });
      setAttachingStudyId(null);
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to attach report", description: e.message, variant: "destructive" });
      setAttachingStudyId(null);
    },
  });

  const handleAttachReport = (studyId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed attempt
    if (!file) return;

    setAttachingStudyId(studyId);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = (reader.result as string).split(",")[1];
      try {
        const uploadRes = await api.post<{ storagePath: string }>("/api/uploads", {
          module: "reports",
          fileName: file.name,
          mimeType: file.type,
          base64Data,
        });
        attachReportMutation.mutate({ studyId, filePath: uploadRes.storagePath, fileName: file.name });
      } catch (err) {
        toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
        setAttachingStudyId(null);
      }
    };
    reader.onerror = () => {
      toast({ title: "File read failed", variant: "destructive" });
      setAttachingStudyId(null);
    };
    reader.readAsDataURL(file);
  };

  const filtered = entries.filter((e) => {
    // Client-side status filter
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    // Client-side modality filter — normalize both sides so raw PACS
    // spellings ("USG", "Doppler", "OB US", ...) fold into the one "US"
    // filter chip instead of silently failing exact-string equality (R2.0).
    if (modalityFilter !== "all" && normalizeModality(e.modality) !== normalizeModality(modalityFilter)) return false;

    // Client-side lock filter — server-computed expiry first (M1.6A)
    const lastAct = e.lockLastActivityAt || e.lockTime;
    const isLocked = e.lockUserId && (
      (e as { lockExpiresAt?: string | null }).lockExpiresAt
        ? new Date((e as { lockExpiresAt?: string | null }).lockExpiresAt as string).getTime() > Date.now()
        : lastAct && (Date.now() - new Date(lastAct).getTime()) <= 30 * 60 * 1000
    );
    const isMine = isLocked && e.lockUserId === session?.user?.id;

    if (lockFilter === "available" && isLocked) return false;
    if (lockFilter === "mine" && !isMine) return false;
    if (lockFilter === "locked" && (!isLocked || isMine)) return false;

    if (aiDraftFilter === "overnight") {
      const display = (e.overnightAi?.displayStatus ?? (
        e.aiDraftStatus === "READY" ? "READY" : e.aiDraftStatus === "ERROR" ? "ERROR" : e.aiDraftStatus === "PENDING" ? "QUEUED" : "NONE"
      )) as OvernightDisplayStatus;
      const inOvernightSet = display !== "NONE" || Boolean(e.overnightEligible);
      if (!inOvernightSet) return false;
      if (!overnightStatusMatches(display, overnightStatusChip)) return false;
      if (!studyInOvernightAgeView({
        chip: overnightAgeChip,
        studyDate: e.studyDate,
        createdAt: e.createdAt,
        customFrom: dateFrom || undefined,
        customTo: dateTo || undefined,
      })) return false;
    }

    // Client-side date-range filter (IST calendar day), keyed off study received time.
    // Overnight AI Drafts uses its own study-age chips; custom chip reuses these dates.
    if (!overnightMode || overnightAgeChip === "custom") {
      if (dateFrom || dateTo) {
        const entryDate = e.createdAt ? toISTDateStr(e.createdAt) : null;
        if (!entryDate) return false;
        if (dateFrom && entryDate < dateFrom) return false;
        if (dateTo && entryDate > dateTo) return false;
      }
    }

    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.patientName ?? "").toLowerCase().includes(s) ||
      (e.accessionNumber ?? "").toLowerCase().includes(s) ||
      (e.studyDescription ?? "").toLowerCase().includes(s) ||
      (e.referringDoctor ?? "").toLowerCase().includes(s)
    );
  });

  const overnightFiltered = overnightMode
    ? [...filtered].sort(compareOvernightWorklistRows)
    : filtered;

  const aiDraftCounts = useMemo(() => {
    let ready = 0, error = 0, processing = 0, queued = 0, running = 0;
    for (const e of entries) {
      const display = (e.overnightAi?.displayStatus ?? (
        e.aiDraftStatus === "READY" ? "READY" : e.aiDraftStatus === "ERROR" ? "ERROR" : e.aiDraftStatus === "PENDING" ? "QUEUED" : "NONE"
      )) as OvernightDisplayStatus;
      const inSet = display !== "NONE" || Boolean(e.overnightEligible);
      if (overnightMode) {
        if (!inSet) continue;
        if (!studyInOvernightAgeView({
          chip: overnightAgeChip,
          studyDate: e.studyDate,
          createdAt: e.createdAt,
          customFrom: dateFrom || undefined,
          customTo: dateTo || undefined,
        })) continue;
      }
      if (display === "READY") ready++;
      else if (display === "ERROR" || display === "STUCK") error++;
      else if (display === "RUNNING") running++;
      else if (display === "QUEUED" || display === "RETRYING") queued++;
      else if (e.aiDraftStatus === "PENDING") processing++;
    }
    return { ready, error, processing, queued, running };
  }, [entries, overnightMode, overnightAgeChip, dateFrom, dateTo]);

  // Rows to render in table — real rows + optional sentinel
  const tableRows = [
    ...(showSentinel ? [SENTINEL_ROW] : []),
    ...overnightFiltered,
  ];

  // /api/patient-reports/:id/print is staff-authed (Authorization: Bearer
  // <token>, checked only on the request header — this app has no cookie
  // fallback), so a plain window.open(url) navigation can never carry it and
  // always 401'd here (opened a blank tab showing the JSON error body
  // instead of the report). Same fix ReportHub.tsx's openPrint() already
  // uses: open a blank tab synchronously (popup-blocker safe), fetch the
  // HTML via the authenticated client, then write it into that tab.
  async function openPrintReport(reportId: number) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" });
      return;
    }
    try {
      const html = await api.get<string>(`/api/patient-reports/${reportId}/print`);
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch (err) {
      w.close();
      toast({ title: "Could not open print view", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  function handleClearCache() {
    void qc.resetQueries({ queryKey: ["radiology-pacs-worklist"] });
    void qc.resetQueries({ queryKey: ["radiology-pacs-worklist-count"] });
    window.localStorage.removeItem("pacs_worklist_cache");
    console.log("[PACS-WORKLIST] React Query cache cleared, re-fetching…");
    setTimeout(() => void refetch(), 100);
  }

  // Phase 8: View stored AI draft
  async function viewAiDraft(id: number) {
    try {
      const result = await api.get<{ draft: Record<string, unknown> | null; safetyNote: string }>(`/api/radiology/pacs-worklist/${id}/ai-draft`);
      setDraftViewer({ id, draft: result.draft });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to load draft", variant: "destructive" });
    }
  }

  // Phase 11: Submit feedback (thumbs up/down) with optional text
  async function submitFeedback(id: number, verdict: "helpful" | "needs_improvement" | "inaccurate") {
    if (verdict === "needs_improvement" || verdict === "inaccurate") {
      setFeedbackEntry(id);
      return; // wait for text dialog
    }
    try {
      await api.post(`/api/radiology/pacs-worklist/${id}/ai-feedback`, { verdict, notes: "" });
      toast({ title: "Feedback saved" });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save feedback", variant: "destructive" });
    }
  }

  async function submitFeedbackWithNotes() {
    if (!feedbackEntry) return;
    try {
      await api.post(`/api/radiology/pacs-worklist/${feedbackEntry}/ai-feedback`, { verdict: "needs_improvement", notes: feedbackText });
      toast({ title: "Feedback saved" });
      setFeedbackEntry(null);
      setFeedbackText("");
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to save feedback", variant: "destructive" });
    }
  }

  const trulyEmpty = entries.length === 0 && !isLoading;
  const filteredEmpty = entries.length > 0 && tableRows.length === 0;
  const unlinkedPacsCount = entries.filter((e) => e.studyId == null).length;

  async function autoLinkUnlinkedBills() {
    const ids = entries.filter((e) => e.studyId == null && e.id > 0).map((e) => e.id).slice(0, 80);
    if (ids.length === 0) return;
    setAutoLinking(true);
    try {
      let linked = 0;
      // Small batches so the API stays responsive during desk hours.
      for (let i = 0; i < ids.length; i += 8) {
        const chunk = ids.slice(i, i + 8);
        const results = await Promise.allSettled(
          chunk.map((id) =>
            api.post<{ linked?: boolean; studyId?: number }>(
              `/api/radiology/pacs-worklist/${id}/auto-link-billed-study`,
              {},
            ),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && (r.value as { linked?: boolean; success?: boolean })?.linked) linked++;
        }
      }
      toast({
        title: linked > 0 ? `Linked ${linked} billed stud${linked === 1 ? "y" : "ies"}` : "No auto-links found",
        description:
          linked > 0
            ? "Bill numbers should appear after refresh. Remaining rows still need DICOM Match."
            : "PACS rows still have no matching radiology_studies for that patient — check DICOM Match Center.",
      });
      void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      void refetch();
    } catch (err) {
      toast({
        title: "Auto-link failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setAutoLinking(false);
    }
  }

  function toggleOvernightAiDrafts() {
    setAiDraftFilter((v) => {
      const next = v === "overnight" ? "all" : "overnight";
      if (next === "overnight") {
        setColumnVisibility((prev) => {
          const nextCols = { ...prev, aiDraft: true };
          saveWorklistColumnVisibility(nextCols);
          return nextCols;
        });
      } else {
        setSelectedOvernightIds(new Set());
      }
      return next;
    });
  }

  function toggleOvernightSelect(id: number) {
    setSelectedOvernightIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedOvernightRows = overnightFiltered.filter((e) => selectedOvernightIds.has(e.id) && e.id > 0);

  async function queueSelectedOvernight() {
    const uids = selectedOvernightRows.map((e) => e.studyInstanceUID).filter((u): u is string => !!u);
    const modalities: Record<string, string | null> = {};
    for (const e of selectedOvernightRows) {
      if (e.studyInstanceUID) modalities[e.studyInstanceUID] = e.modality ?? null;
    }
    if (uids.length === 0) return;
    try {
      const res = await aiClient.queueSelected(uids, modalities, false);
      toast({ title: `Queued ${res.queued}`, description: res.skipped.length ? `${res.skipped.length} skipped (READY or already in queue)` : "Added to overnight AI queue" });
      setSelectedOvernightIds(new Set());
      void refetch();
    } catch (err) {
      toast({ title: "Queue failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  async function retrySelectedOvernight() {
    const jobIds = selectedOvernightRows
      .filter((e) => e.overnightAi?.canRetry && e.overnightAi.jobId)
      .map((e) => e.overnightAi!.jobId as number);
    if (jobIds.length === 0) {
      toast({ title: "Nothing to retry", description: "Retry is only for ERROR jobs that are not already running." });
      return;
    }
    try {
      const res = await aiClient.retryOvernightJobs(jobIds);
      toast({ title: `Retried ${res.retried}`, description: res.skippedInFlight ? `${res.skippedInFlight} skipped (already in flight)` : undefined });
      setSelectedOvernightIds(new Set());
      void refetch();
    } catch (err) {
      toast({ title: "Retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  async function cancelSelectedOvernight() {
    const jobIds = selectedOvernightRows
      .filter((e) => e.overnightAi?.canCancel && e.overnightAi.jobId)
      .map((e) => e.overnightAi!.jobId as number);
    const blocked = selectedOvernightRows.filter((e) => e.overnightAi?.displayStatus === "RUNNING").length;
    if (jobIds.length === 0) {
      toast({
        title: "Cancel not available",
        description: blocked ? "RUNNING jobs cannot be cancelled (Ollama request is in flight)." : "Select queued studies only.",
      });
      return;
    }
    try {
      const res = await aiClient.cancelQueuedOvernight(jobIds);
      toast({
        title: `Cancelled ${res.cancelled}`,
        description: res.skippedRunning ? `${res.skippedRunning} running jobs left untouched` : undefined,
      });
      setSelectedOvernightIds(new Set());
      void refetch();
    } catch (err) {
      toast({ title: "Cancel failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader title="Worklist Hub" subtitle="RIS study queue and PACS intake worklist" />

      <Tabs defaultValue="pacs-worklist" className="flex-1 min-h-0 flex flex-col px-3 sm:px-4 pb-3 sm:pb-4 space-y-3 overflow-hidden">
        <TabsList className="shrink-0 grid w-full grid-cols-1 sm:grid-cols-2 h-auto gap-1.5 p-1.5 bg-muted/40 rounded-xl border border-border/60">
          <TabsTrigger
            value="study-queue"
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/60"
          >
            <ClipboardList size={15} />
            <span className="text-center leading-tight">RIS Study Queue</span>
          </TabsTrigger>
          <TabsTrigger
            value="pacs-worklist"
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/60"
          >
            <ScanSearch size={15} />
            <span className="text-center leading-tight">PACS Worklist</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="study-queue" className="flex-1 min-h-0 overflow-y-auto mt-0 data-[state=inactive]:hidden">
          <StudyQueuePanel />
        </TabsContent>

        <TabsContent value="pacs-worklist" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">

            {/* ── LIVE DEBUG PANEL ── */}
            <div className="shrink-0 space-y-3 overflow-y-auto max-h-[40vh]">
            <PacsDebugPanel
              entries={entries}
              filtered={filtered}
              isLoading={isLoading}
              isError={isError}
              error={error as Error | null}
              lastRefresh={lastRefresh}
              statusFilter={statusFilter}
              modalityFilter={modalityFilter}
              search={search}
              dbTotalRows={countData?.totalRows ?? null}
              onForceRefresh={() => void refetch()}
              onClearCache={handleClearCache}
              showSentinel={showSentinel}
              onToggleSentinel={() => setShowSentinel((v) => !v)}
            />

            {/* Summary bar */}
            <div className="flex items-center justify-between bg-slate-100 dark:bg-muted/40 border border-slate-200 dark:border-card-border rounded-lg px-4 py-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                PACS Worklist / DICOM Received Studies: <span className="text-lg text-slate-900 dark:text-foreground tabular-nums">{entries.length}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {isLoading ? "Loading..." : filtered.length === entries.length ? "All visible" : `${filtered.length} filtered`}
                </span>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
              </div>
            </div>

            {unlinkedPacsCount > 0 && (
              <div className="flex flex-wrap items-start gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200 dark:bg-orange-950/30 dark:border-orange-800 text-sm text-orange-900 dark:text-orange-200">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-600" />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">
                    {unlinkedPacsCount} PACS scan{unlinkedPacsCount === 1 ? "" : "s"} not linked to a bill in ERP
                  </span>
                  <span className="text-xs text-orange-800/90 dark:text-orange-300/90 block mt-0.5">
                    Images can exist in Orthanc while Bill column stays —. Auto-link matches by accession (MWL work id); if the modality did not use MWL, open DICOM Match Center and link manually.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-orange-300 text-orange-900 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-200"
                  disabled={autoLinking}
                  onClick={() => void autoLinkUnlinkedBills()}
                  data-testid="pacs-auto-link-bills"
                >
                  {autoLinking ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Link2 className="h-3.5 w-3.5 mr-1" />}
                  Auto-link bills
                </Button>
                <Link
                  href="/radiology/my-collection?filter=unbilled"
                  className="text-xs font-semibold text-orange-800 dark:text-orange-300 underline shrink-0 hover:text-orange-900 self-center"
                >
                  Open DICOM Match →
                </Link>
              </div>
            )}

            {/* Filters + date range (dates aligned right) */}
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
              <div className="relative flex-1 min-w-[180px] max-w-md">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search patient, accession..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <Filter className="h-4 w-4 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : toUnifiedStatus(s).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <QueueModalityFilter
                value={modalityFilter}
                onChange={setModalityFilter}
                size="md"
              />
              <button
                type="button"
                data-testid="overnight-ai-drafts-filter"
                onClick={() => toggleOvernightAiDrafts()}
                className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border text-xs font-medium transition ${
                  aiDraftFilter === "overnight"
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
                title="Overnight AI Drafts: QUEUED vs RUNNING from dicom_retry_queue. READY = draft available. Does not change ordinary worklist sorting."
              >
                <Sparkles className="h-3.5 w-3.5" />
                Overnight AI Drafts
              </button>
              <span
                className="text-[11px] text-muted-foreground whitespace-nowrap"
                data-testid="ai-draft-summary"
              >
                {overnightMode
                  ? `Queued: ${aiDraftCounts.queued} · Running: ${aiDraftCounts.running} · Ready: ${aiDraftCounts.ready} · Errors: ${aiDraftCounts.error}`
                  : `AI Drafts: ${aiDraftCounts.ready} READY | ${aiDraftCounts.error} ERROR | ${aiDraftCounts.queued + aiDraftCounts.processing} PROCESSING`}
              </span>
              <Select value={lockFilter} onValueChange={setLockFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Lock Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locks</SelectItem>
                  <SelectItem value="available">🟢 Available</SelectItem>
                  <SelectItem value="mine">🟡 Opened by You</SelectItem>
                  <SelectItem value="locked">🔴 Locked by Others</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5">
                    <Columns2 className="h-4 w-4" />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-2">
                  <p className="text-xs font-semibold text-muted-foreground px-2 py-1">Show columns</p>
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {(Object.keys(WORKLIST_COL_LABELS) as WorklistOptionalColumn[]).map((key) => (
                      <label key={key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={col[key]}
                          onChange={() => toggleColumn(key)}
                        />
                        {WORKLIST_COL_LABELS[key]}
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full mt-1 h-7 text-xs"
                    onClick={() => {
                      setColumnVisibility({ ...WORKLIST_COL_DEFAULTS });
                      saveWorklistColumnVisibility({ ...WORKLIST_COL_DEFAULTS });
                    }}
                  >
                    Reset to defaults
                  </Button>
                </PopoverContent>
              </Popover>
              {(statusFilter !== "all" || modalityFilter !== "all" || lockFilter !== "all" || aiDraftFilter !== "all" || search || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => { setSearch(""); setStatusFilter("all"); setModalityFilter("all"); setLockFilter("all"); setAiDraftFilter("all"); setDateFrom(""); setDateTo(""); }}
                >
                  Clear filters
                </Button>
              )}
              </div>
              {overnightMode && (
                <div className="flex flex-wrap items-center gap-2 w-full" data-testid="overnight-ai-drafts-filters">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Study age</span>
                  {OVERNIGHT_AGE_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setOvernightAgeChip(chip.id)}
                      className={`h-7 px-2 rounded-md border text-[11px] ${
                        overnightAgeChip === chip.id
                          ? "border-indigo-500 bg-indigo-600 text-white"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-2">AI status</span>
                  {OVERNIGHT_STATUS_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setOvernightStatusChip(chip.id)}
                      className={`h-7 px-2 rounded-md border text-[11px] ${
                        overnightStatusChip === chip.id
                          ? "border-indigo-500 bg-indigo-600 text-white"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {selectedOvernightIds.size > 0 && (
                    <span className="flex flex-wrap items-center gap-1 ml-auto">
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void queueSelectedOvernight()}>
                        Queue selected
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void retrySelectedOvernight()}>
                        Retry selected errors
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void cancelSelectedOvernight()}>
                        Cancel selected queued
                      </Button>
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 w-[140px] text-sm"
                />
                <span className="text-muted-foreground text-sm">→</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 w-[140px] text-sm"
                />
                <div className="flex gap-1 flex-wrap">
                  {DATE_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs px-2.5"
                      onClick={() => setDatePreset(p.from(), p.to())}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Status chips + DICOM intake shortcut */}
            <div className="flex gap-2 flex-wrap items-center">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const count = entries.filter((e) => e.status === key).length;
                if (count === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-opacity ${cfg.color} ${statusFilter === key ? "opacity-100 ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100"}`}
                  >
                    {cfg.icon} {cfg.label} ({count})
                  </button>
                );
              })}
              {entries.filter((e) => e.status === "STUDY_RECEIVED").length > 0 && (
                <button
                  type="button"
                  data-testid="dicom-intake-filter"
                  onClick={() => setStatusFilter(statusFilter === "STUDY_RECEIVED" ? "all" : "STUDY_RECEIVED")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-sky-300 bg-sky-50 text-sky-900"
                  title="DICOM intake — studies just received from PACS/modality"
                >
                  <Database className="h-3 w-3" />
                  Intake queue ({entries.filter((e) => e.status === "STUDY_RECEIVED").length})
                </button>
              )}
            </div>

            {/* M1.6B1 — live radiologist workload (reuses worklist data only) */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowWorkload((v) => !v)} data-testid="btn-workload">
                {showWorkload ? "Hide workload" : "Workload"}
              </Button>
            </div>
            {showWorkload && (
              <div className="rounded-lg border p-3 bg-muted/10" data-testid="workload-panel">
                <div className="text-xs font-semibold mb-2">
                  Radiologist workload
                  <span className="text-muted-foreground font-normal ml-2">
                    {workload ? `${workload.unassignedPending} unassigned pending` : "loading…"}
                  </span>
                </div>
                {workload && (
                  <table className="text-xs w-full max-w-2xl">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-4 py-0.5 font-medium">Radiologist</th>
                        <th className="pr-4 py-0.5 font-medium">Assigned</th>
                        <th className="pr-4 py-0.5 font-medium">Locked now</th>
                        <th className="pr-4 py-0.5 font-medium">Done today</th>
                        <th className="pr-4 py-0.5 font-medium">Avg pending age</th>
                        <th className="pr-4 py-0.5 font-medium">Parked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workload.radiologists.map((r) => (
                        <tr key={r.radiologistId}>
                          <td className="pr-4 py-0.5">{r.radiologistName}</td>
                          <td className="pr-4 py-0.5">{r.assignedPending}</td>
                          <td className="pr-4 py-0.5">{r.lockedNow}</td>
                          <td className="pr-4 py-0.5">{r.completedToday}</td>
                          <td className="pr-4 py-0.5">{r.avgPendingAgeHours != null ? `${r.avgPendingAgeHours} h` : "—"}</td>
                          <td className="pr-4 py-0.5 text-muted-foreground">
                            {/* Parked state is browser-local (M1.5) — only this
                                workstation's own count is truthfully knowable. */}
                            {r.radiologistId === session?.user?.id
                              ? (() => { try { return (JSON.parse(localStorage.getItem("radiology_parked_studies_v1") ?? "[]") as unknown[]).length; } catch { return 0; } })()
                              : "n/a"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            </div>

            {/* Table */}
            {isLoading ? (
              <div className="flex items-center justify-center flex-1 py-16">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : trulyEmpty && !showSentinel ? (
              <div className="flex flex-col items-center justify-center flex-1 py-16 gap-3 text-muted-foreground">
                <ScanSearch className="h-12 w-12" />
                <p className="text-base font-semibold">No PACS studies found</p>
                <p className="text-sm max-w-md text-center">
                  {(countData?.totalRows ?? 0) === 0
                    ? "The radiology_worklist table is empty. Push a study via your DICOM agent / Conquest PACS to see entries here."
                    : `DB has ${countData?.totalRows} rows but API returned 0. Check auth token / filters above.`
                  }
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSentinel(true)}
                  className="mt-1"
                >
                  Show sentinel row (render test)
                </Button>
              </div>
            ) : filteredEmpty ? (
              <div className="flex flex-col items-center justify-center flex-1 py-16 gap-2 text-muted-foreground">
                <ScanSearch className="h-10 w-10" />
                <p className="text-sm font-semibold">No studies match your filters</p>
                <p className="text-xs">{entries.length} total in database. Try clearing search or changing filters.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => { setSearch(""); setStatusFilter("all"); setModalityFilter("all"); }}>
                  Clear All Filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 rounded-lg border shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left border-b">
                      {showSentinel && <th className={`${WORKLIST_TH} text-orange-600`}>⚠ Debug</th>}
                      {overnightMode && <th className={`${WORKLIST_TH} w-8`}></th>}
                      <th className={`${WORKLIST_TH} min-w-[160px] sticky left-0 z-30 bg-muted/40 border-r border-border/50`}>Patient</th>
                      <th className={WORKLIST_TH}>Bill</th>
                      <th className={`${WORKLIST_TH} min-w-[180px]`}>Study</th>
                      {col.studyDate && <th className={`${WORKLIST_TH} tabular-nums`}>Study Date</th>}
                      <th className={WORKLIST_TH}>Priority</th>
                      <th className={WORKLIST_TH}>Status</th>
                      {col.measurements && <th className={`${WORKLIST_TH} text-center`}>Meas.</th>}
                      {col.images && <th className={`${WORKLIST_TH} text-center`}>Img</th>}
                      {col.usgReport && <th className={WORKLIST_TH}>USG Rpt</th>}
                      {col.studyDescription && <th className={`${WORKLIST_TH} max-w-[160px]`}>Study Desc</th>}
                      {col.refDoctor && <th className={WORKLIST_TH}>Ref. Dr</th>}
                      {col.accession && <th className={WORKLIST_TH}>Accession</th>}
                      {col.sourceAe && <th className={WORKLIST_TH}>Source AE</th>}
                      {col.radiologist && <th className={WORKLIST_TH}>Radiologist</th>}
                      {col.lockStatus && <th className={WORKLIST_TH}>Lock</th>}
                      {col.aiDraft && <th className={WORKLIST_TH}>AI</th>}
                      {col.createdAt && <th className={`${WORKLIST_TH} text-right`}>Received</th>}
                      <th className={`${WORKLIST_TH} text-right sticky right-0 z-30 bg-muted/40 border-l border-border/50`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {tableRows.map((entry) => (
                      <tr
                        key={entry.id}
                        className={`group hover:bg-muted/25 transition-colors ${entry.id === -1 ? "bg-orange-50 dark:bg-orange-950/20" : (urgentHighlightOn && priorityInfo(entry.priority).highlight) ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                      >
                        {showSentinel && (
                          <td className={`${WORKLIST_TD} text-xs text-orange-600 font-mono`}>
                            {entry.id === -1 ? "SENTINEL" : "real"}
                          </td>
                        )}
                        {overnightMode && (
                          <td className={`${WORKLIST_TD} w-8`}>
                            {entry.id === -1 ? null : (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                checked={selectedOvernightIds.has(entry.id)}
                                onChange={() => toggleOvernightSelect(entry.id)}
                                aria-label={`Select ${entry.patientName} for overnight AI`}
                              />
                            )}
                          </td>
                        )}
                        <td className={`${WORKLIST_TD} min-w-[160px] sticky left-0 z-10 bg-background group-hover:bg-muted/25 border-r border-border/40`}>
                          {(() => {
                            const ageSex = formatWorklistAgeSex(entry);
                            const uhid = formatWorklistUhid(entry);
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-semibold text-sm leading-snug text-foreground">{entry.patientName}</span>
                                {ageSex && (
                                  <span className="text-[11px] text-muted-foreground leading-tight">{ageSex}</span>
                                )}
                                {uhid && (
                                  <span className="font-mono text-[10px] text-muted-foreground/90 leading-tight" title={entry.dicomPatientId ?? undefined}>
                                    UHID {uhid}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className={`${WORKLIST_TD} font-mono text-xs whitespace-nowrap`}>
                          {entry.billNumber ? (
                            <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                              {entry.billNumber}
                            </span>
                          ) : entry.studyId == null ? (
                            <span
                              className="text-[10px] font-medium text-orange-700 dark:text-orange-300"
                              title="PACS row not linked to a billed radiology study — bill may still exist in Billing Desk"
                            >
                              Unlinked
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{"\u2014"}</span>
                          )}
                        </td>
                        <td className={`${WORKLIST_TD} min-w-[180px] max-w-[280px]`}>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium leading-snug line-clamp-2" title={displayTestName(entry)}>
                              {displayTestName(entry)}
                            </span>
                            <Badge variant="outline" className={`w-fit font-mono text-[10px] px-1.5 py-0 ${worklistModalityBadgeClass(entry.modality)}`}>
                              {entry.modality}
                            </Badge>
                          </div>
                        </td>
                        {col.studyDate && (
                        <td className={`${WORKLIST_TD} text-muted-foreground text-xs whitespace-nowrap tabular-nums`}>
                          {formatWorklistStudyDate(entry.studyDate)}
                        </td>
                        )}
                        <td className={`${WORKLIST_TD} whitespace-nowrap`}>
                          {(() => { const pr = priorityInfo(entry.priority); return (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${pr.color}`}>
                              {pr.label}
                            </span>
                          ); })()}
                        </td>
                        <td className={`${WORKLIST_TD} whitespace-nowrap`}>
                          <StatusBadge status={entry.status} deliveryStatus={entry.deliveryStatus} />
                          {entry.status !== "REPORT_FINAL" && entry.status !== "DELIVERED" && (() => {
                            const threshold = Number(pacsViewerSettings["radiology_aging_alert_hours"] ?? "4") || 4;
                            const hrs = agingHours(entry.createdAt);
                            if (hrs < threshold) return null;
                            return (
                              <span
                                title={`Waiting ${hrs.toFixed(1)}h since received — configurable in Radiology Settings`}
                                className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900"
                              >
                                {hrs >= 24 ? `${Math.floor(hrs / 24)}d` : `${Math.floor(hrs)}h`}
                              </span>
                            );
                          })()}
                        </td>
                        {col.measurements && (
                        <td className="px-2 py-2 whitespace-nowrap text-center">
                          {entry.id !== -1 && isUltrasoundModality(entry.modality) ? (() => {
                            const count = entry.usgMeasurementCount ?? 0;
                            const target = entry.id != null
                              ? `/radiology/report/${entry.id}`
                              : entry.studyInstanceUID
                                ? `/radiology/usg-measurements/${entry.studyInstanceUID}`
                                : null;
                            const badge = (
                              <UsgCountBadge
                                count={count}
                                color="bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-400 dark:border-teal-900"
                              />
                            );
                            if (!target) return badge;
                            return (
                              <button
                                type="button"
                                className="inline-flex hover:opacity-80 transition-opacity"
                                onClick={() => navigate(target)}
                                title="Open USG measurements"
                              >
                                {badge}
                              </button>
                            );
                          })() : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        )}
                        {col.images && (
                        <td className="px-2 py-2 whitespace-nowrap text-center">
                          {entry.id !== -1 && isUltrasoundModality(entry.modality) ? (
                            <UsgCountBadge
                              count={entry.usgKeyImageCount ?? 0}
                              color="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        )}
                        {col.usgReport && (
                        <td className="px-2 py-2 whitespace-nowrap">
                          {entry.id !== -1 && isUltrasoundModality(entry.modality) ? (
                            <UsgReportStatusBadge status={entry.usgReportStatus} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        )}
                        {col.studyDescription && (
                        <td className="px-3 py-2 max-w-[160px] truncate text-xs" title={entry.studyDescription ?? ""}>
                          {entry.studyDescription || "\u2014"}
                        </td>
                        )}
                        {col.refDoctor && (
                        <td className="px-3 py-2 text-xs whitespace-nowrap max-w-[120px] truncate" title={entry.referringDoctor ?? ""}>
                          {entry.referringDoctor ?? "\u2014"}
                        </td>
                        )}
                        {col.accession && (
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{entry.accessionNumber}</td>
                        )}
                        {col.sourceAe && (
                        <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                          {entry.sourceAeTitle ?? entry.aeTitle ?? "\u2014"}
                        </td>
                        )}
                        {col.radiologist && (
                        <td className="px-3 py-2 text-xs whitespace-nowrap max-w-[100px] truncate" title={entry.assignedRadiologist ?? ""}>
                          {entry.assignedRadiologist ?? "\u2014"}
                        </td>
                        )}
                        {col.lockStatus && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <LockBadge entry={entry} currentUserId={session?.user?.id} />
                            {entry.id !== -1 && (
                              <select
                                className="h-6 max-w-[130px] text-[10px] border rounded px-1 bg-background text-muted-foreground"
                                value={(entry as { assignedRadiologistId?: number | null }).assignedRadiologistId ?? ""}
                                disabled={assignMutation.isPending || entry.status === "REPORT_FINAL" || entry.status === "DELIVERED"}
                                title={(() => {
                                  const e = entry as { assignedAt?: string | null; assignedByName?: string | null };
                                  return e.assignedAt
                                    ? `Assigned ${new Date(e.assignedAt).toLocaleString()}${e.assignedByName ? ` by ${e.assignedByName}` : ""}`
                                    : entry.assignedRadiologist
                                      ? `Assigned to ${entry.assignedRadiologist} (legacy, no timestamp)`
                                      : "Unassigned — pick a radiologist to assign";
                                })()}
                                onChange={(ev) => {
                                  const v = ev.target.value;
                                  assignMutation.mutate({ worklistId: entry.id, radiologistId: v === "" ? null : Number(v) });
                                }}
                                data-testid={`assign-select-${entry.id}`}
                              >
                                <option value="">
                                  {(entry as { assignedRadiologistId?: number | null }).assignedRadiologistId == null && entry.assignedRadiologist
                                    ? `Unassigned (was: ${entry.assignedRadiologist})`
                                    : "Unassigned"}
                                </option>
                                {radiologists.map((r) => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        )}
                        {col.aiDraft && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {entry.id === -1 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <OvernightAiDraftCell
                              entry={entry}
                              overnightMode={overnightMode}
                              onViewDraft={() => viewAiDraft(entry.id)}
                              onHelpful={() => submitFeedback(entry.id, "helpful")}
                              onNeedsImprovement={() => submitFeedback(entry.id, "needs_improvement")}
                              onRetry={entry.overnightAi?.canRetry && entry.overnightAi.jobId
                                ? () => { void aiClient.retryOvernightJobs([entry.overnightAi!.jobId as number]).then(() => refetch()); }
                                : undefined}
                            />
                          )}
                        </td>
                        )}
                        {col.createdAt && (
                        <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap text-right tabular-nums">
                          {fmtDate(entry.createdAt)}
                        </td>
                        )}
                        <td className={`${WORKLIST_TD} sticky right-0 z-10 bg-background group-hover:bg-muted/25 border-l border-border/50 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] min-w-[260px]`}>
                          <div className="flex flex-nowrap items-stretch justify-end gap-0.5 ml-auto" data-testid="worklist-actions-row">
                            {entry.id !== -1 && !isReceptionView && (
                              <>
                                <WorklistActionBtn
                                  icon={Tv2}
                                  label="Weasis"
                                  tone={preferWeasis ? "weasis" : "neutral"}
                                  disabled={!canLaunchViewer(entry)}
                                  title={canLaunchViewer(entry) ? "Open in Weasis" : "Study UID missing — cannot launch Weasis"}
                                  onClick={() => void launchWorklistWeasis(entry)}
                                />
                                {isRadView && may("/radiology/report") && (
                                  <WorklistActionBtn
                                    icon={Maximize2}
                                    label="Focus"
                                    tone="report"
                                    title="Open Reporting Workspace in focus mode (maximized editor)"
                                    onClick={() => navigate(reportingWorkspacePath(entry, true))}
                                  />
                                )}
                                <WorklistActionBtn
                                  icon={MonitorPlay}
                                  label="OHIF"
                                  tone={!preferWeasis ? "ohif" : "neutral"}
                                  disabled={!canLaunchViewer(entry)}
                                  title={canLaunchViewer(entry) ? "Open in OHIF" : "Study UID missing — cannot launch OHIF"}
                                  onClick={() => void launchViewer(entry.studyInstanceUID, "OHIF", pacsViewerSettings, toast)}
                                />
                              </>
                            )}

                            {entry.status !== "REPORT_FINAL" && entry.status !== "DELIVERED" && entry.id !== -1 && isRadView && (
                              <WorklistActionBtn
                                icon={Sparkles}
                                label="AI"
                                tone="ai"
                                disabled={aiDraftMutation.isPending}
                                title="Generate AI Draft"
                                onClick={() => aiDraftMutation.mutate(entry)}
                              />
                            )}

                            {entry.id !== -1 && isOwnerView && (
                              <WorklistActionBtn
                                icon={Activity}
                                label="Command"
                                tone="cc"
                                title="Open in Command Center"
                                onClick={() => navigate(`/radiology/command-center/${entry.id}`)}
                              />
                            )}

                            {entry.id !== -1 && isRadView && may("/radiology/report") && (
                              <WorklistActionBtn
                                icon={Stethoscope}
                                label="Report"
                                tone="report"
                                title="Open in the Reporting Workspace"
                                onClick={() => navigate(reportingWorkspacePath(entry))}
                              />
                            )}

                            {(entry.status === "REPORT_IN_PROGRESS" || entry.status === "AI_DRAFT_READY") && entry.id !== -1 && isOwnerView && (
                              <WorklistActionBtn
                                icon={CheckCircle2}
                                label="Final"
                                tone="warn"
                                disabled={markFinalMutation.isPending}
                                title="Admin only — mark FINAL without signed report (audited)"
                                onClick={() => {
                                  const reason = window.prompt(
                                    `Admin override: mark ${entry.accessionNumber} FINAL without workspace Finalize & Sign?\n\nEnter reason (external report attached / emergency):`,
                                  );
                                  if (reason && reason.trim().length >= 3) {
                                    markFinalMutation.mutate({ entry, reason: reason.trim() });
                                  }
                                }}
                              />
                            )}

                            {entry.status === "REPORT_FINAL" && (
                              <span className="inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border border-green-300 bg-green-50 text-green-800 w-[46px] h-[40px] text-[9px] font-semibold shrink-0 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Final
                              </span>
                            )}

                            {entry.id !== -1 && isRadView &&
                              (entry.reportId != null || entry.status === "REPORT_IN_PROGRESS" || entry.status === "REPORT_FINAL") && (
                              <WorklistActionBtn
                                icon={Gem}
                                label="Print UI"
                                tone="warn"
                                title="Open Reporting Workspace print / layout tab"
                                onClick={() => navigate(`/radiology/report/${entry.id}?tab=print`)}
                              />
                            )}

                            {entry.id !== -1 && entry.reportId != null && (
                              <WorklistActionBtn
                                icon={Printer}
                                label="Print"
                                tone="neutral"
                                title="Print / Share report"
                                onClick={() => void openPrintReport(entry.reportId!)}
                              />
                            )}

                            {entry.id !== -1 && entry.studyId != null && (
                              attachingStudyId === entry.studyId ? (
                                <div className="inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-muted/30 w-[46px] h-[40px] text-[9px] text-muted-foreground shrink-0">
                                  <Loader2 size={14} className="animate-spin text-primary" />
                                  Wait
                                </div>
                              ) : (
                                <>
                                  <input
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                    id={`attach-report-${entry.studyId}`}
                                    className="hidden"
                                    onChange={(e) => handleAttachReport(entry.studyId as number, e)}
                                  />
                                  <WorklistActionBtn
                                    icon={FileUp}
                                    label="Attach"
                                    tone="neutral"
                                    title="Attach the final report (Word/PDF) produced outside this app"
                                    onClick={() => document.getElementById(`attach-report-${entry.studyId}`)?.click()}
                                  />
                                </>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Emergency fallback: raw JSON cards ── */}
            {entries.length > 0 && (
              <div>
                <button
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() => setShowRawJson((v) => !v)}
                >
                  {showRawJson ? "Hide" : "Show"} raw API response ({entries.length} rows) — use if table appears blank
                </button>
                {showRawJson && (
                  <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
                    {entries.map((entry, idx) => (
                      <pre
                        key={entry.id ?? idx}
                        className="rounded border bg-slate-50 dark:bg-muted/40 p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all"
                      >
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="shrink-0 text-xs text-muted-foreground text-right">
              {filtered.length} of {entries.length} entries
              {entries.length > 0 && <span> &middot; Auto-refreshes every 30s</span>}
            </div>

            <div className="shrink-0 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-semibold">Safety: </span>
                AI drafts are never automatically marked as final. Prefer{" "}
                <button type="button" className="underline font-medium" onClick={() => navigate("/radiology/reporting-workspace")}>
                  Reporting Workspace
                </button>{" "}
                finalize for portal/WhatsApp delivery. External Word/PDF attach stores on the study only — use{" "}
                <button type="button" className="underline font-medium" onClick={() => navigate("/report-delivery")}>
                  Report Delivery
                </button>{" "}
                to print/share. Automated email delivery is not enabled (READY_TO_SEND only).
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Phase 8: AI Draft Viewer Dialog */}
      <Dialog open={!!draftViewer} onOpenChange={() => setDraftViewer(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" /> AI Draft Viewer
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              AI Draft — Requires Radiologist Review
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {draftViewer?.draft ? (
              <div className="rounded border bg-muted/40 p-3 max-h-96 overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(draftViewer.draft, null, 2)}</pre>
              </div>
            ) : (
              <p className="text-muted-foreground">No draft stored for this study.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Phase 11: Feedback Text Dialog */}
      <Dialog open={!!feedbackEntry} onOpenChange={() => { setFeedbackEntry(null); setFeedbackText(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">AI Draft Feedback</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Describe what was wrong or what needs improvement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="e.g. Findings were inaccurate, impression was too vague, missed a lesion...
              "
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setFeedbackEntry(null); setFeedbackText(""); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={submitFeedbackWithNotes} disabled={!feedbackText.trim()}>
                Submit Feedback
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
