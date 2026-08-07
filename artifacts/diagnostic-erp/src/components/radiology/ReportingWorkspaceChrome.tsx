/**
 * Collapsible top chrome for the Radiology Reporting Workspace.
 * Focus mode hides the bulky header + queue toolbar so the report editor
 * (Clinical History → Findings) gets maximum vertical space.
 *
 * Modality USG/MRI/More lives on the Worklist — not here.
 * Patient switching is a compact Today/Yesterday dropdown.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daysAgoISO, todayISO } from "@/lib/dateRangePresets";
import { QUEUE_SCOPE_LABELS, lockStatusMessage, type QueueScope } from "@/lib/studyLockState";
import type { StudyLockStatus } from "@/hooks/useStudyLock";
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock,
  Maximize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, PauseCircle, RefreshCw, SlidersHorizontal, Users, X,
} from "lucide-react";

/** @deprecated Prefer QueueModalityFilter on the worklist — kept for any leftover imports. */
export { QUEUE_MODALITY_PRIMARY, QUEUE_MODALITY_REST } from "@/components/radiology/QueueModalityFilter";

export const WORKSPACE_CHROME_COLLAPSED_KEY = "radiology_workspace_chrome_collapsed";

/** Compact day window for the workspace patient picker (today / yesterday only). */
export const WORKSPACE_DAY_PRESETS = [
  { id: "today", label: "Today", from: () => todayISO(), to: () => todayISO() },
  { id: "yesterday", label: "Yesterday", from: () => daysAgoISO(1), to: () => daysAgoISO(1) },
  { id: "today_yesterday", label: "Today + Yesterday", from: () => daysAgoISO(1), to: () => todayISO() },
] as const;

export type LayoutModeOption = {
  mode: string;
  label: string;
  title: string;
  icon: ReactNode;
};

export type WorkflowQueueRow = {
  id: number;
  patientName: string;
  modality: string;
  accessionNumber: string;
};

export type WorkflowIndicators = {
  id: number;
  current?: boolean;
  completed?: boolean;
  parked?: boolean;
  lockedByOther?: boolean;
};

export type ReportingWorkspaceChromeProps = {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  onEnterFocusMode: () => void;
  onBackToWorklist: () => void;
  patientBanner?: string;
  reportStatusLabel: string;
  reportStatusClass: string;
  isOnline: boolean;
  isLoadingDraft: boolean;
  hasExistingDraft: boolean;
  dirty: boolean;
  lastSavedAt: Date | null;
  useStructured: boolean;
  onStructuredChange: (v: boolean) => void;
  structuredDisabled: boolean;
  layoutMode: string;
  layoutModeOptions: LayoutModeOption[];
  onLayoutModeChange: (mode: string) => void;
  isLeftPanelCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  readingSessionEnabled: boolean;
  readingSessionDone: number;
  onToggleReadingSession: () => void;
  workflow: {
    position: { index: number; total: number };
    completedCount: number;
    parkedCount: number;
    transitioning: boolean;
    queueRefreshing: boolean;
    historyDepth: number;
    isParked: (id: number) => boolean;
    parked: Array<{ id: number; reason?: string | null }>;
    queue: WorkflowQueueRow[];
    indicators: WorkflowIndicators[];
  };
  studyId: number;
  parkedReason?: string;
  saving: boolean;
  finalizing: boolean;
  studyLock: {
    status: StudyLockStatus;
    ownerName: string | null;
    expiresAt: string | null;
  };
  viewerBusy: boolean;
  viewerConnected: boolean;
  viewerNetworkMode?: string;
  queueScope: QueueScope | string;
  onQueueScopeChange: (scope: QueueScope | string) => void;
  radiologists: Array<{ id: number; name: string }>;
  queueFilterText: string;
  onQueueFilterTextChange: (v: string) => void;
  queueModalityFilter: string;
  onQueueModalityFilterChange: (v: string) => void;
  queueDateFrom: string;
  queueDateTo: string;
  onQueueDatePreset: (from: string, to: string) => void;
  jumpQueue: WorkflowQueueRow[];
  onJumpStudy: (id: number) => void;
  onPreviousStudy: () => void;
  onNextStudy: () => void;
  onParkStudy: () => void;
  onRefreshQueue: () => void;
  onReloadStudy: () => void;
  hasEntry: boolean;
  voiceBar?: ReactNode;
  /** Compact modality chip (MRI / USG / CT) — shown in collapsed + expanded chrome. */
  modalityAccent?: { label: string; className: string } | null;
};

function activeDayPresetId(from: string, to: string): string {
  for (const p of WORKSPACE_DAY_PRESETS) {
    if (p.from() === from && p.to() === to) return p.id;
  }
  return "";
}

function CompactPatientPicker(props: ReportingWorkspaceChromeProps) {
  const dayId = activeDayPresetId(props.queueDateFrom, props.queueDateTo);
  const dayLabel = WORKSPACE_DAY_PRESETS.find((p) => p.id === dayId)?.label
    ?? (props.queueDateFrom || props.queueDateTo ? "Custom" : "Today + Yesterday");

  return (
    <div className="flex items-center gap-1 shrink-0" data-testid="compact-patient-picker">
      <select
        className="h-7 max-w-[7.5rem] text-[10px] border rounded-md px-1.5 bg-background"
        aria-label="Queue day"
        data-testid="queue-day-preset"
        value={dayId || "today_yesterday"}
        onChange={(e) => {
          const p = WORKSPACE_DAY_PRESETS.find((x) => x.id === e.target.value);
          if (p) props.onQueueDatePreset(p.from(), p.to());
        }}
      >
        {WORKSPACE_DAY_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <select
        className="h-7 min-w-[8rem] max-w-[14rem] text-[10px] border rounded-md px-1.5 bg-background"
        value=""
        data-testid="queue-jump"
        aria-label="Select patient"
        onChange={(e) => {
          const id = Number(e.target.value);
          if (id) props.onJumpStudy(id);
        }}
      >
        <option value="">
          {props.patientBanner
            ? `${props.patientBanner.slice(0, 28)}${props.patientBanner.length > 28 ? "…" : ""}`
            : `Patients (${props.jumpQueue.length}) — ${dayLabel}`}
        </option>
        {props.jumpQueue.map((s) => {
          const ind = props.workflow.indicators.find((i) => i.id === s.id);
          const prefix = ind?.current ? "→ " : ind?.completed ? "✓ " : ind?.parked ? "⏸ " : ind?.lockedByOther ? "🔒 " : "";
          return (
            <option key={s.id} value={s.id}>
              {prefix}{s.patientName} · {s.modality} · {s.accessionNumber}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function activeFilterCount(props: ReportingWorkspaceChromeProps): number {
  let n = 0;
  if (props.queueFilterText.trim()) n++;
  if (props.queueModalityFilter !== "all") n++;
  if (props.queueScope !== "mine") n++;
  return n;
}

function QueueFiltersPopover(props: ReportingWorkspaceChromeProps) {
  const filters = activeFilterCount(props);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 px-2"
          data-testid="queue-filters-popover"
        >
          <SlidersHorizontal size={11} />
          Filters{filters > 0 ? ` (${filters})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3">
        <div className="text-xs font-semibold flex items-center gap-1">
          <Users size={12} /> Queue filters
        </div>
        <p className="text-[10px] text-muted-foreground">
          Day and patient are in the toolbar. Modality filter belongs on the Worklist (USG / MRI / More).
        </p>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Scope</Label>
          <select
            className="h-8 w-full text-xs border rounded-md px-2 bg-background"
            value={props.queueScope}
            data-testid="queue-scope"
            onChange={(e) => props.onQueueScopeChange(e.target.value)}
          >
            {(Object.keys(QUEUE_SCOPE_LABELS) as Array<keyof typeof QUEUE_SCOPE_LABELS>).map((s) => (
              <option key={s} value={s}>{QUEUE_SCOPE_LABELS[s]}</option>
            ))}
            {props.radiologists.length > 0 && (
              <optgroup label="By radiologist">
                {props.radiologists.map((r) => (
                  <option key={r.id} value={`rad:${r.id}`}>{r.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Find in queue</Label>
          <Input
            value={props.queueFilterText}
            onChange={(e) => props.onQueueFilterTextChange(e.target.value)}
            placeholder="Patient, accession…"
            className="h-8 text-xs"
            data-testid="queue-filter-text"
          />
        </div>
        {(props.queueFilterText || props.queueScope !== "mine") && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] w-full"
            onClick={() => {
              props.onQueueFilterTextChange("");
              props.onQueueScopeChange("mine");
            }}
          >
            <X size={11} className="mr-1" /> Clear extra filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function WorkflowNavButtons(props: ReportingWorkspaceChromeProps) {
  return (
    <div className="flex items-center gap-0.5">
      <Button size="sm" variant="outline" className="h-7 w-7 p-0"
        onClick={props.onPreviousStudy} disabled={props.workflow.historyDepth === 0 || props.workflow.transitioning}
        title="Previous study (Ctrl+Shift+P)" data-testid="btn-previous-study">
        <ChevronLeft size={14} />
      </Button>
      <Button size="sm" variant="outline" className="h-7 w-7 p-0"
        onClick={props.onNextStudy} disabled={props.workflow.transitioning}
        title="Next study (Ctrl+Shift+N)" data-testid="btn-next-study">
        <ChevronRight size={14} />
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-[10px] gap-0.5 px-1.5"
        onClick={props.onParkStudy} disabled={!props.hasEntry || props.workflow.transitioning}
        title={props.workflow.isParked(props.studyId) ? "Unpark this study" : "Park and move on (Ctrl+Shift+K)"}
        data-testid="btn-park-study">
        <PauseCircle size={11} />
        <span className="hidden xl:inline">{props.workflow.isParked(props.studyId) ? "Unpark" : "Park"}</span>
      </Button>
    </div>
  );
}

export default function ReportingWorkspaceChrome(props: ReportingWorkspaceChromeProps) {
  const {
    collapsed, onCollapsedChange, onEnterFocusMode, onBackToWorklist,
    patientBanner, reportStatusLabel, reportStatusClass,
    workflow, studyId, voiceBar,
  } = props;

  const lockStatus = props.studyLock.status;
  const showLock = lockStatus !== "idle" && lockStatus !== "not-found" && lockStatus !== "completed";

  if (collapsed) {
    return (
      <div
        className="shrink-0 border-b bg-gradient-to-r from-teal-50/50 via-amber-50/40 to-violet-50/50 dark:from-teal-950/20 dark:via-amber-950/15 dark:to-violet-950/20 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        data-testid="workspace-chrome-collapsed"
      >
        <div
          className="flex h-1 w-full"
          aria-hidden
          data-testid="chrome-section-hues"
        >
          <span className="flex-1 bg-teal-500/80" title="Clinical History" />
          <span className="flex-1 bg-sky-500/80" title="Technique" />
          <span className="flex-1 bg-amber-500/80" title="Findings" />
          <span className="flex-1 bg-violet-500/80" title="Impression" />
          <span className="flex-1 bg-emerald-500/80" title="Recommendation" />
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 min-h-8">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onBackToWorklist} title="Back to worklist">
            <ArrowLeft size={14} />
          </Button>
          <div className="min-w-0 flex items-center gap-1.5 text-[11px] shrink">
            {props.modalityAccent && (
              <Badge className={`shrink-0 text-[9px] py-0 h-4 border ${props.modalityAccent.className}`} data-testid="chrome-modality-badge">
                {props.modalityAccent.label}
              </Badge>
            )}
            <span className="text-muted-foreground shrink-0" data-testid="queue-position">
              {workflow.position.index >= 0 ? `${workflow.position.index + 1}/${workflow.position.total}` : `—/${workflow.position.total}`}
            </span>
            <Badge className={`shrink-0 text-[9px] py-0 h-4 ${reportStatusClass}`}>{reportStatusLabel}</Badge>
            {props.dirty && <span className="text-amber-600 shrink-0" title="Unsaved changes">●</span>}
            {props.saving && <span className="text-blue-600 shrink-0">Saving…</span>}
            {showLock && (
              <span className="text-[10px] text-muted-foreground truncate hidden lg:inline max-w-[10rem]" title={lockStatusMessage(lockStatus, props.studyLock.ownerName)}>
                <Lock size={9} className="inline mr-0.5" />
                {lockStatus === "connection-lost" ? "Lock may expire" : lockStatusMessage(lockStatus, props.studyLock.ownerName)}
              </span>
            )}
          </div>
          {voiceBar ? <div className="min-w-0 flex-1 overflow-hidden">{voiceBar}</div> : <div className="flex-1" />}
          <CompactPatientPicker {...props} />
          <WorkflowNavButtons {...props} />
          <QueueFiltersPopover {...props} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" title="More actions">
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={props.onRefreshQueue} disabled={workflow.queueRefreshing}>
                <RefreshCw size={12} className={workflow.queueRefreshing ? "animate-spin mr-2" : "mr-2"} />
                Refresh queue
              </DropdownMenuItem>
              <DropdownMenuItem onClick={props.onReloadStudy} disabled={!studyId}>
                <RefreshCw size={12} className="mr-2" />
                Reload study
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCollapsedChange(false)}>
                <ChevronDown size={12} className="mr-2" />
                Show full toolbar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEnterFocusMode}>
                <Maximize2 size={12} className="mr-2" />
                Maximize report area
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" onClick={() => onCollapsedChange(false)} title="Expand toolbar">
            <ChevronDown size={14} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b bg-background" data-testid="workspace-chrome-expanded">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-gradient-to-r from-sky-50/80 via-background to-violet-50/60 dark:from-sky-950/20 dark:via-background dark:to-violet-950/20 flex-wrap">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs shrink-0" onClick={onBackToWorklist}>
          <ArrowLeft size={13} /> Worklist
        </Button>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className="font-semibold text-sm shrink-0 hidden sm:inline">Reporting</span>
          {patientBanner && (
            <span className="text-xs text-muted-foreground truncate">{patientBanner}</span>
          )}
        </div>
        <Button type="button" size="sm" variant={props.readingSessionEnabled ? "default" : "outline"} className="h-7 px-2 text-[10px] shrink-0" onClick={props.onToggleReadingSession} title="Reading session — auto-advance after finalize">
          {props.readingSessionEnabled ? `Session · ${props.readingSessionDone}` : "Session"}
        </Button>
        <Badge className={`shrink-0 text-[10px] ${reportStatusClass}`}>{reportStatusLabel}</Badge>
        {props.modalityAccent && (
          <Badge className={`shrink-0 text-[10px] border ${props.modalityAccent.className}`} data-testid="chrome-modality-badge">
            {props.modalityAccent.label}
          </Badge>
        )}
        {!props.isOnline && <Badge className="shrink-0 text-[10px] bg-red-100 text-red-700 border-red-200">Offline</Badge>}
        {props.dirty ? (
          <Badge variant="outline" className="shrink-0 text-[10px] bg-amber-50 text-amber-800 border-amber-300">Unsaved</Badge>
        ) : props.lastSavedAt ? (
          <span className="shrink-0 text-[10px] text-muted-foreground hidden lg:inline">Saved {props.lastSavedAt.toLocaleTimeString()}</span>
        ) : null}
        <div className="flex items-center gap-1 shrink-0">
          <Switch id="structured" checked={props.useStructured} onCheckedChange={props.onStructuredChange} disabled={props.structuredDisabled} />
          <Label htmlFor="structured" className="text-[10px] cursor-pointer select-none">Structured</Label>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 rounded-md border p-0.5 bg-muted/30" role="radiogroup" aria-label="Layout mode" data-testid="layout-mode-selector">
          {props.layoutModeOptions.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={props.layoutMode === opt.mode}
              title={opt.title}
              data-testid={`layout-mode-${opt.mode}`}
              onClick={() => props.onLayoutModeChange(opt.mode)}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
                props.layoutMode === opt.mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.icon}
              <span className="hidden lg:inline">{opt.label}</span>
            </button>
          ))}
        </div>
        <button type="button" title={props.isLeftPanelCollapsed ? "Expand patient panel" : "Collapse patient panel"} data-testid="toggle-left-panel" onClick={props.onToggleLeftPanel} className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted">
          {props.isLeftPanelCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <button type="button" title={props.isRightPanelCollapsed ? "Expand tools" : "Collapse tools"} data-testid="toggle-right-panel" onClick={props.onToggleRightPanel} className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted">
          {props.isRightPanelCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px] gap-1 px-2 shrink-0" onClick={onEnterFocusMode} title="Collapse toolbar and side panels for maximum report space (Ctrl+Shift+F)">
          <Maximize2 size={12} /> Focus
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => onCollapsedChange(true)} title="Collapse toolbar">
          <ChevronUp size={14} />
        </Button>
      </div>

      <div className="flex items-center gap-2 px-2 py-1 bg-muted/15 text-[11px]" data-testid="workflow-status-bar">
        <span className="text-muted-foreground font-medium shrink-0" data-testid="queue-position">
          Study {workflow.position.index >= 0 ? `${workflow.position.index + 1} of ${workflow.position.total}` : `— of ${workflow.position.total}`}
        </span>
        <span className="text-green-700 shrink-0">✓ {workflow.completedCount}</span>
        <span className={`shrink-0 ${workflow.parkedCount > 0 ? "text-amber-700" : "text-muted-foreground"}`}>⏸ {workflow.parkedCount}</span>
        {workflow.isParked(studyId) && (
          <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] py-0 shrink-0" data-testid="parked-badge">
            PARKED{props.parkedReason ? ` — ${props.parkedReason}` : ""}
          </Badge>
        )}
        {props.finalizing && <span className="text-blue-700 shrink-0">Finalizing…</span>}
        {workflow.transitioning && <span className="text-blue-700 shrink-0">Switching…</span>}
        {showLock && (
          <span data-testid="lock-status" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-semibold shrink-0 max-w-[10rem] truncate ${
            lockStatus === "mine" ? "bg-green-100 text-green-800 border-green-300"
            : lockStatus === "locked-by-other" ? "bg-red-100 text-red-800 border-red-300"
            : "bg-amber-100 text-amber-800 border-amber-300"
          }`}>
            <Lock size={9} /> {lockStatusMessage(lockStatus, props.studyLock.ownerName)}
          </span>
        )}
        {voiceBar ? (
          <div className="min-w-0 flex-1 overflow-hidden" data-testid="chrome-expanded-voice">
            {voiceBar}
          </div>
        ) : (
          <div className="flex-1 min-w-0" />
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <CompactPatientPicker {...props} />
          <WorkflowNavButtons {...props} />
          <QueueFiltersPopover {...props} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" title="Refresh / reload">
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={props.onRefreshQueue} disabled={workflow.queueRefreshing} data-testid="btn-refresh-queue">
                <RefreshCw size={12} className={workflow.queueRefreshing ? "animate-spin mr-2" : "mr-2"} />
                Refresh queue
              </DropdownMenuItem>
              <DropdownMenuItem onClick={props.onReloadStudy} disabled={!studyId} data-testid="btn-reload-study">
                Refresh study from server
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
