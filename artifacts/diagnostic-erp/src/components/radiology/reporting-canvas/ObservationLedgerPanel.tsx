import { useState } from "react";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { formatAnchorChip } from "@/lib/observationAnchor";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";

export type CanvasViewMode = "narrative" | "split" | "ledger";

export function ObservationLedgerPanel({
  patches,
  findingsText,
  selectedId,
  onSelect,
  keyImageCounts,
  onOpenKeyImages,
}: {
  patches: AppliedPathologyPatch[];
  findingsText: string;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  /** Map observationId → attached frozen key image count. */
  keyImageCounts?: Record<string, number>;
  onOpenKeyImages?: (observationId: string) => void;
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
            return (
              <button
                key={p.id}
                type="button"
                className={[
                  "block w-full px-2 py-1.5 text-left hover:bg-slate-50",
                  active ? "bg-sky-50 ring-1 ring-inset ring-sky-300" : "",
                  p.stale ? "border-l-2 border-amber-400" : "",
                  p.protected ? "border-l-2 border-violet-400" : "",
                ].join(" ")}
                onClick={() => onSelect(active ? null : p.id)}
                data-testid={`ledger-row-${p.id}`}
              >
                <div className="flex flex-wrap gap-1 text-[9px] font-semibold text-slate-800">
                  <span>{obs?.region || "—"}</span>
                  <span className="text-slate-400">|</span>
                  <span>{obs?.concept || p.ownership.conflictGroup || "—"}</span>
                  {obs?.level ? (
                    <>
                      <span className="text-slate-400">|</span>
                      <span>{obs.level}</span>
                    </>
                  ) : null}
                  {obs?.laterality ? (
                    <>
                      <span className="text-slate-400">|</span>
                      <span>{obs.laterality}</span>
                    </>
                  ) : null}
                  {obs?.severity ? (
                    <>
                      <span className="text-slate-400">|</span>
                      <span>{obs.severity}</span>
                    </>
                  ) : null}
                  {imgCount > 0 ? (
                    <span
                      role="link"
                      tabIndex={0}
                      className="ml-auto rounded bg-sky-100 px-1 text-[8px] font-bold text-sky-800"
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
