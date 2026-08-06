/**
 * Collapsible top chrome for the Radiology Reporting Workspace.
 * Focus mode hides the bulky header + queue toolbar so the report editor
 * (Clinical History → Findings) gets maximum vertical space.
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
import { DATE_PRESETS } from "@/lib/dateRangePresets";
import { QUEUE_SCOPE_LABELS, lockStatusMessage, type QueueScope } from "@/lib/studyLockState";
import type { StudyLockStatus } from "@/hooks/useStudyLock";
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock,
  Maximize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, PauseCircle, RefreshCw, SlidersHorizontal, X,
} from "lucide-react";

/** Primary modality buckets shown as dedicated chrome buttons. */
export const QUEUE_MODALITY_PRIMARY = [
  { value: "US", label: "USG" },
  { value: "MR", label: "MRI" },
] as const;

/** Remaining modalities live in the third-button dropdown. */
export const QUEUE_MODALITY_REST = [
  { value: "CT", label: "CT" },
  { value: "CR", label: "CR / X-ray" },
  { value: "DX", label: "DX" },
  { value: "all", label: "All modalities" },
] as const;

export const WORKSPACE_CHROME_COLLAPSED_KEY = "radiology_workspace_chrome_collapsed";

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
};

function QueueModalityButtons(props: Pick<ReportingWorkspaceChromeProps, "queueModalityFilter" | "onQueueModalityFilterChange">) {
  const active = props.queueModalityFilter;
  const restActive = QUEUE_MODALITY_REST.some((m) => m.value === active);
  const restLabel = QUEUE_MODALITY_REST.find((m) => m.value === active)?.label
    ?? (active !== "US" && active !== "MR" && active !== "all" ? active : "More");

  const btn = (selected: boolean) =>
    `h-7 px-2 text-[10px] font-semibold border transition-colors ${
      selected
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background text-muted-foreground border-border hover:bg-muted"
    }`;

  return (
    <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Study modality filter" data-testid="queue-modality-buttons">
      {QUEUE_MODALITY_PRIMARY.map((m) => (
        <Button
          key={m.value}
          type="button"
          size="sm"
          variant="outline"
          className={btn(active === m.value)}
          data-testid={`queue-modality-${m.value}`}
          aria-pressed={active === m.value}
          onClick={() => props.onQueueModalityFilterChange(m.value)}
        >
          {m.label}
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={`${btn(restActive)} gap-0.5`}
            data-testid="queue-modality-rest"
            aria-pressed={restActive}
            title="Other modalities"
          >
            {restLabel}
            <ChevronDown size={11} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {QUEUE_MODALITY_REST.map((m) => (
            <DropdownMenuItem
              key={m.value}
              data-testid={`queue-modality-rest-${m.value}`}
              className={active === m.value ? "bg-muted font-semibold" : ""}
              onClick={() => props.onQueueModalityFilterChange(m.value)}
            >
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function activeFilterCount(props: ReportingWorkspaceChromeProps): number {
  let n = 0;
  if (props.queueFilterText.trim()) n++;
  if (props.queueModalityFilter !== "all") n++;
  if (props.queueDateFrom || props.queueDateTo) n++;
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
      <PopoverContent align="end" className="w-80 p-3 space-y-3">
        <div className="text-xs font-semibold">Queue filters</div>
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
            placeholder="Patient, accession, modality…"
            className="h-8 text-xs"
            data-testid="queue-filter-text"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Modality</Label>
          <select
            className="h-8 w-full text-xs border rounded-md px-2 bg-background"
            value={props.queueModalityFilter}
            data-testid="queue-filter-modality"
            onChange={(e) => props.onQueueModalityFilterChange(e.target.value)}
          >
            <option value="all">All modalities</option>
            <option value="US">USG</option>
            <option value="MR">MRI</option>
            <option value="CT">CT</option>
            <option value="CR">CR</option>
            <option value="DX">DX</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Date range</Label>
          <select
            className="h-8 w-full text-xs border rounded-md px-2 bg-background mb-1.5"
            defaultValue=""
            onChange={(e) => {
              const idx = Number(e.target.value);
              if (!Number.isFinite(idx) || idx < 0) return;
              const p = DATE_PRESETS[idx];
              if (p) props.onQueueDatePreset(p.from(), p.to());
              e.target.value = "";
            }}
          >
            <option value="">Quick preset…</option>
            {DATE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <Input type="date" value={props.queueDateFrom} onChange={(e) => props.onQueueDatePreset(e.target.value, props.queueDateTo)} className="h-8 text-xs flex-1" data-testid="queue-filter-date-from" />
            <span className="text-muted-foreground text-xs">–</span>
            <Input type="date" value={props.queueDateTo} onChange={(e) => props.onQueueDatePreset(props.queueDateFrom, e.target.value)} className="h-8 text-xs flex-1" data-testid="queue-filter-date-to" />
            {(props.queueDateFrom || props.queueDateTo) && (
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => props.onQueueDatePreset("", "")} data-testid="queue-filter-date-clear">
                <X size={12} />
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Jump to study</Label>
          <select
            className="h-8 w-full text-xs border rounded-md px-2 bg-background"
            value=""
            data-testid="queue-jump"
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) props.onJumpStudy(id);
            }}
          >
            <option value="">
              Queue ({props.jumpQueue.length === props.workflow.position.total
                ? props.workflow.position.total
                : `${props.jumpQueue.length}/${props.workflow.position.total}`})…
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
      <div className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" data-testid="workspace-chrome-collapsed">
        <div className="flex items-center gap-1.5 px-2 py-0.5 min-h-8">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onBackToWorklist} title="Back to worklist">
            <ArrowLeft size={14} />
          </Button>
          <div className="min-w-0 flex items-center gap-1.5 text-[11px] shrink">
            <span className="font-semibold truncate max-w-[140px] sm:max-w-[220px]" title={patientBanner}>{patientBanner || "Reporting"}</span>
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
          <QueueModalityButtons
            queueModalityFilter={props.queueModalityFilter}
            onQueueModalityFilterChange={props.onQueueModalityFilterChange}
          />
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
    <div className="shrink-0 border-b bg-white" data-testid="workspace-chrome-expanded">
      {/* Primary header — single tight row */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-white flex-wrap">
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

      {/* Queue workflow + voice — one row; voice fills the former dead middle */}
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
          <QueueModalityButtons
            queueModalityFilter={props.queueModalityFilter}
            onQueueModalityFilterChange={props.onQueueModalityFilterChange}
          />
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
