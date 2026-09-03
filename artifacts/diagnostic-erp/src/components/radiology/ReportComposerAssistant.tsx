/**
 * AI Report Assistant — compact panel inside existing Reporting Workspace.
 * Review colors are render-time only; clinical text stays plain (Guard 4).
 */
import { Bot, Check, Loader2, RefreshCw, Trash2, X, Eye, EyeOff, AlertTriangle, Minus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComposeJobView, TrackedChange } from "@/lib/reportComposer/types";
import { AI_COMPOSE_STATUS_STYLE } from "@/lib/reportComposer/types";

type Props = {
  job: ComposeJobView | null;
  busy: boolean;
  reviewOpen: boolean;
  showAiChanges: boolean;
  isFinalized: boolean;
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  /** Drafting mode — default TEXT_ONLY. */
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  onAiModeChange: (mode: "TEXT_ONLY" | "SELECTED_IMAGES") => void;
  primaryRegionLabel: string;
  selectedKeyImageCount: number;
  onCompose: () => void;
  onImpression: () => void;
  onToggleReview: (open: boolean) => void;
  onToggleShowChanges: (on: boolean) => void;
  onAcceptChange: (id: string) => void;
  onRejectChange: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  microInstruction: string;
  onMicroInstructionChange: (v: string) => void;
  onMicroSubmit: () => void;
};

function statusBadge(status: string) {
  const cfg = AI_COMPOSE_STATUS_STYLE[status] ?? AI_COMPOSE_STATUS_STYLE.NONE;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function ChangeRow({
  c,
  showColors,
  onAccept,
  onReject,
  disabled,
}: {
  c: TrackedChange;
  showColors: boolean;
  onAccept: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  const addCls = showColors ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/30" : "";
  const delCls = showColors ? "text-amber-800 dark:text-amber-200 line-through bg-amber-50/60 dark:bg-amber-950/20" : "line-through opacity-70";
  return (
    <div className="rounded-md border p-2 space-y-1.5 text-xs" data-testid={`ai-change-${c.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">
          {c.field} · {c.changeType} · {c.reviewState}
        </span>
        {c.clinicalSignificance && (
          <span className="inline-flex items-center gap-1 rounded bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold">
            <AlertTriangle className="h-3 w-3" /> CLINICALLY SIGNIFICANT
          </span>
        )}
      </div>
      {c.clinicalSignificanceReasons?.length > 0 && (
        <ul className="text-[10px] text-red-700 list-disc pl-4">
          {c.clinicalSignificanceReasons.slice(0, 6).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {c.originalText ? (
        <div>
          <div className="text-[10px] font-medium text-muted-foreground">CURRENT / WILL REMOVE</div>
          <p className={`whitespace-pre-wrap rounded px-1.5 py-1 ${delCls}`}>{c.originalText}</p>
        </div>
      ) : null}
      <div>
        <div className="text-[10px] font-medium text-muted-foreground">AI PROPOSED</div>
        <p className={`whitespace-pre-wrap rounded px-1.5 py-1 ${addCls}`}>{c.proposedText}</p>
      </div>
      {c.reviewState === "PENDING" && (
        <div className="flex gap-1.5 pt-0.5">
          <Button type="button" size="sm" className="h-7 text-[10px] gap-1" disabled={disabled} onClick={onAccept}>
            <Check className="h-3 w-3" /> Accept
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px] gap-1" disabled={disabled} onClick={onReject}>
            <X className="h-3 w-3" /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function provenanceFromJob(job: ComposeJobView | null): {
  aiMode?: string;
  model?: string;
  personaVersion?: string;
  imagesLoaded?: number;
  degradedReason?: string | null;
  warnings?: string[];
} {
  const v = job?.validation as
    | {
        provenance?: {
          aiMode?: string;
          model?: string;
          personaVersion?: string;
          imagesLoaded?: number;
          degradedReason?: string | null;
        };
        warnings?: string[];
      }
    | null
    | undefined;
  return {
    ...(v?.provenance ?? {}),
    warnings: v?.warnings,
  };
}

export function ReportComposerAssistant(props: Props) {
  const sources = props.job?.sources ?? {};
  const sourceLine = [
    sources["quick-select"] ? `Quick Select ${sources["quick-select"]}` : null,
    sources["quick-findings"] ? `Quick Findings ${sources["quick-findings"]}` : null,
    sources.macro ? `Macros ${sources.macro}` : null,
    sources.manual ? `Manual ${sources.manual}` : null,
    sources.voice ? `Voice ${sources.voice}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const canApply =
    props.job &&
    ["READY"].includes(props.job.status) &&
    !props.isFinalized;

  const selectedImagesDisabled = props.selectedKeyImageCount <= 0;
  const provenance = provenanceFromJob(props.job);

  if (props.minimized) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 shadow-md hover:bg-sky-100"
        data-testid="ai-report-assistant-minimized"
        title="Expand AI Report Assistant"
        onClick={() => props.onMinimizedChange?.(false)}
      >
        <Bot className="h-3.5 w-3.5" />
        AI Assistant
        {props.job ? statusBadge(props.job.status) : null}
        <Maximize2 className="h-3 w-3 opacity-70" />
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50/80 to-white dark:from-sky-950/20 dark:to-background p-3 space-y-2"
      data-testid="ai-report-assistant"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-sky-700 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">AI Report Assistant</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {sourceLine || "Radiologist-guided composition — never auto-signs"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {props.job ? statusBadge(props.job.status) : statusBadge("NONE")}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Minimize"
            data-testid="ai-report-assistant-minimize"
            onClick={() => props.onMinimizedChange?.(true)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-white/70 dark:bg-background/40 px-2 py-1.5 space-y-1" data-testid="ai-compose-mode">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="font-semibold text-muted-foreground uppercase tracking-wide">Mode</span>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="ai-compose-mode"
              checked={props.aiMode === "TEXT_ONLY"}
              onChange={() => props.onAiModeChange("TEXT_ONLY")}
              data-testid="ai-mode-observations"
            />
            Draft from Observations
          </label>
          <label className={`inline-flex items-center gap-1 ${selectedImagesDisabled ? "opacity-50" : "cursor-pointer"}`}>
            <input
              type="radio"
              name="ai-compose-mode"
              checked={props.aiMode === "SELECTED_IMAGES"}
              disabled={selectedImagesDisabled}
              onChange={() => props.onAiModeChange("SELECTED_IMAGES")}
              data-testid="ai-mode-selected-images"
            />
            Draft with Selected Images
          </label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Region: <span className="font-medium text-foreground">{props.primaryRegionLabel}</span>
          {" · "}
          AI-selected images: <span className="font-medium text-foreground">{props.selectedKeyImageCount}</span>
        </p>
        <p className="text-[10px] text-muted-foreground">
          Selected images support the draft; radiologist observations remain authoritative.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={
            props.busy ||
            props.isFinalized ||
            (props.aiMode === "SELECTED_IMAGES" && selectedImagesDisabled)
          }
          onClick={props.onCompose}
          data-testid="compose-in-background"
        >
          {props.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          {props.aiMode === "SELECTED_IMAGES" ? "Draft with Selected Images" : "Draft from Observations"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={props.busy || props.isFinalized}
          onClick={props.onImpression}
          title="Generate Impression is always text-only"
        >
          Generate Impression
        </Button>
        {props.job && ["READY", "STALE_READY"].includes(props.job.status) && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => props.onToggleReview(!props.reviewOpen)}
          >
            {props.reviewOpen ? "Hide Review" : "Review Draft"}
          </Button>
        )}
      </div>

      <div className="flex gap-1.5 items-center">
        <input
          className="flex-1 h-8 rounded-md border bg-background px-2 text-xs"
          placeholder="Ask AI to improve selected / current section…"
          value={props.microInstruction}
          onChange={(e) => props.onMicroInstructionChange(e.target.value)}
          disabled={props.isFinalized}
          data-testid="ai-micro-command"
        />
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={props.isFinalized || !props.microInstruction.trim()} onClick={props.onMicroSubmit}>
          Run
        </Button>
      </div>

      {props.job?.safeError && props.job.status === "FAILED" && (
        <p className="text-[11px] text-red-700" data-testid="ai-compose-failed">
          AI composition failed — report unchanged. ({props.job.safeError})
          {provenance.degradedReason ? ` ${provenance.degradedReason}` : ""}
        </p>
      )}

      {props.job?.status === "STALE_READY" && (
        <div className="rounded-md border border-orange-300 bg-orange-50 text-orange-950 p-2 text-[11px]">
          <strong>STALE</strong> — report, observations, study context, or image selection changed since this draft. Compare or Regenerate. Blind apply is blocked.
        </div>
      )}

      {(provenance.warnings?.length ?? 0) > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-950 p-2 text-[11px] space-y-0.5" data-testid="ai-validation-warnings">
          <p className="font-semibold">Validation warnings</p>
          <ul className="list-disc pl-4">
            {provenance.warnings!.slice(0, 8).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {props.reviewOpen && props.job && (
        <div className="space-y-2 border-t pt-2" data-testid="ai-report-review">
          <div className="text-[10px] text-muted-foreground space-y-0.5" data-testid="ai-compose-provenance">
            <p>
              Provenance: {provenance.aiMode === "SELECTED_IMAGES" ? "Selected images" : "Observations only"}
              {provenance.model ? ` · model ${provenance.model}` : ""}
              {provenance.personaVersion ? ` · ${provenance.personaVersion}` : ""}
              {typeof provenance.imagesLoaded === "number" ? ` · images loaded ${provenance.imagesLoaded}` : ""}
            </p>
            <p className="font-medium text-foreground">AI Draft — Requires Radiologist Review</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] gap-1"
              onClick={() => props.onToggleShowChanges(!props.showAiChanges)}
            >
              {props.showAiChanges ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {props.showAiChanges ? "Show AI Changes: ON" : "Show AI Changes: OFF"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={props.onAcceptAll}>
              Accept all
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={props.onRejectAll}>
              Reject all
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={props.onRegenerate}>
              <RefreshCw className="h-3 w-3" /> Regenerate
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-red-700" onClick={props.onDiscard}>
              <Trash2 className="h-3 w-3" /> Discard
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {(props.job.trackedChanges ?? []).map((c) => (
              <ChangeRow
                key={c.id}
                c={c}
                showColors={props.showAiChanges}
                disabled={props.isFinalized}
                onAccept={() => props.onAcceptChange(c.id)}
                onReject={() => props.onRejectChange(c.id)}
              />
            ))}
            {(props.job.trackedChanges ?? []).length === 0 && (
              <div className="text-[11px] text-muted-foreground space-y-1">
                <p className="font-medium">CURRENT vs AI PROPOSED</p>
                <p><span className="text-muted-foreground">Findings now:</span> {(props.job.proposedFindings ?? "").slice(0, 200)}</p>
                <p><span className="text-muted-foreground">Impression:</span> {(props.job.proposedImpression ?? "").slice(0, 200)}</p>
              </div>
            )}
          </div>

          <Button
            type="button"
            className="w-full h-8 text-xs"
            disabled={!canApply}
            onClick={props.onApply}
            data-testid="ai-apply-accepted"
          >
            Apply accepted changes
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Print / PDF always use accepted black text only. Review colors never leave this panel.
          </p>
        </div>
      )}
    </div>
  );
}
