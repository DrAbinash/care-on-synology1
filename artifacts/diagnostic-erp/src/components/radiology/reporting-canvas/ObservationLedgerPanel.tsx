import { useState } from "react";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { formatAnchorChip } from "@/lib/observationAnchor";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";
import { observationIncludesInImpression } from "@/lib/findingComposerModel";

export type CanvasViewMode = "narrative" | "split" | "ledger";

export function ObservationLedgerPanel({
  patches,
  findingsText,
  selectedId,
  onSelect,
  keyImageCounts,
  onOpenKeyImages,
  measurementChips,
  onJumpToMeasurement,
  onEdit,
  onToggleImpression,
  impressionDisabled,
}: {
  patches: AppliedPathologyPatch[];
  findingsText: string;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  /** Map observationId → attached frozen key image count. */
  keyImageCounts?: Record<string, number>;
  onOpenKeyImages?: (observationId: string) => void;
  /** Map observationId → compact measurement chip text (e.g. "22 × 18 mm"). */
  measurementChips?: Record<string, string>;
  onJumpToMeasurement?: (observationId: string) => void;
  /** Open Finding Composer prefilled for this observation. */
  onEdit?: (observationId: string) => void;
  /** Include / exclude from Impression (reuses lastRendered.impression). */
  onToggleImpression?: (observationId: string, include: boolean) => void;
  impressionDisabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white" data-testid="observation-ledger-panel">
      <div className="border-b border-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-700">
        Observation Ledger ({patches.length})
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
        {patches.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground">No structured observations yet.</p>
        ) : (
          patches.map((p) => {
            const obs = p.observation;
            const active = selectedId === p.id;
            const inNarrative = Boolean(
              p.lastRendered.findings
              && findingsText
              && findingsText.toLowerCase().includes((p.lastRendered.findings ?? "").slice(0, 40).toLowerCase()),
            );
            const imgCount = keyImageCounts?.[p.id] ?? 0;
            const measChip = measurementChips?.[p.id];
            const inImpression = observationIncludesInImpression(p);
            const conceptLabel = (obs?.concept || p.ownership.conflictGroup || "—").replace(/_/g, " ");
            return (
              <div
                key={p.id}
                className={[
                  "block w-full px-2 py-1.5 text-left",
                  active ? "bg-sky-50 ring-1 ring-inset ring-sky-300" : "hover:bg-slate-50",
                  p.stale ? "border-l-2 border-amber-400" : "",
                  p.protected ? "border-l-2 border-violet-400" : "",
                ].join(" ")}
                data-testid={`ledger-row-${p.id}`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onSelect(active ? null : p.id)}
                >
                  <div className="flex flex-wrap gap-1 text-[9px] font-semibold text-slate-800">
                    {obs?.level ? <span>{obs.level}</span> : <span>{obs?.region || "—"}</span>}
                    <span className="text-slate-400">·</span>
                    <span className="capitalize">{conceptLabel}</span>
                    {obs?.severity ? (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="capitalize">{obs.severity}</span>
                      </>
                    ) : null}
                    {obs?.laterality ? (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="capitalize">{obs.laterality}</span>
                      </>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1">
                      {measChip ? (
                        <span
                          className="rounded bg-emerald-100 px-1 text-[8px] font-bold text-emerald-800"
                          data-testid={`ledger-measurement-badge-${p.id}`}
                          title="Linked measurement"
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onJumpToMeasurement?.(p.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onJumpToMeasurement?.(p.id);
                            }
                          }}
                        >
                          {measChip}
                        </span>
                      ) : null}
                      {imgCount > 0 ? (
                        <span
                          role="link"
                          tabIndex={0}
                          className="rounded bg-sky-100 px-1 text-[8px] font-bold text-sky-800"
                          data-testid={`ledger-key-image-badge-${p.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenKeyImages?.(p.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onOpenKeyImages?.(p.id);
                            }
                          }}
                          title="Show attached key images"
                        >
                          📷 {imgCount}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[8px] text-slate-500">
                    <span>src: {p.source}</span>
                    {p.protected ? <span className="text-violet-700">MANUAL</span> : null}
                    {p.stale ? <span className="text-amber-700">STALE</span> : null}
                    {inNarrative ? <span className="text-emerald-700">WIRED</span> : <span>PARTIAL</span>}
                    {active ? <span className="text-sky-700">SELECTED</span> : null}
                  </div>
                  {obs?.anchor ? (
                    <div className="mt-0.5 font-mono text-[8px] text-sky-800">{formatAnchorChip(obs.anchor)}</div>
                  ) : null}
                  {p.lastRendered.findings ? (
                    <p className="mt-0.5 line-clamp-2 text-[9px] text-slate-700">{p.lastRendered.findings}</p>
                  ) : null}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label
                    className="inline-flex items-center gap-1 text-[9px] text-slate-700"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      data-testid={`ledger-impression-${p.id}`}
                      disabled={impressionDisabled}
                      checked={inImpression}
                      onChange={(e) => onToggleImpression?.(p.id, e.target.checked)}
                    />
                    Impression
                  </label>
                  {onEdit ? (
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 hover:bg-slate-50"
                      data-testid={`ledger-edit-${p.id}`}
                      disabled={impressionDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(p.id);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function CanvasViewModeToggle({
  mode,
  onChange,
}: {
  mode: CanvasViewMode;
  onChange: (m: CanvasViewMode) => void;
}) {
  const modes: CanvasViewMode[] = ["narrative", "split", "ledger"];
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" data-testid="canvas-view-mode">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={[
            "rounded px-2 py-0.5 text-[9px] font-semibold uppercase",
            mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
          ].join(" ")}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/** Derive display badges from existing patch/provenance facts — no new state machine. */
export function deriveObservationBadges(p: AppliedPathologyPatch, findingsText: string): string[] {
  const badges: string[] = [];
  if (p.protected) badges.push("MANUAL");
  if (p.stale) badges.push("NEEDS REFRESH");
  if (p.source === "ai-draft") badges.push("AI");
  if (p.source === "radiologist-voice") badges.push("VOICE");
  if (p.source === "quick-findings" || p.source === "structured-template") badges.push("STRUCTURED");
  if (p.source === "macro") badges.push("MACRO");
  if (p.source === "companion") badges.push("MEASUREMENT");
  const frag = (p.lastRendered.findings ?? "").trim();
  if (frag && findingsText.includes(frag.slice(0, Math.min(48, frag.length)))) {
    badges.push("WIRED");
  } else if (frag) {
    const key = normalizeForDedupe(frag).slice(0, 24);
    if (key && normalizeForDedupe(findingsText).includes(key)) badges.push("WIRED");
    else badges.push("PARTIAL");
  }
  return badges;
}

export function useCanvasViewMode(initial: CanvasViewMode = "split") {
  return useState<CanvasViewMode>(initial);
}
