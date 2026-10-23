import { useEffect, useRef, useMemo, useState } from "react";
import { useWorkspace, useWorkspaceSelector, EMPTY_FIELD_PROVENANCE } from "@/lib/zai-workspace/store";
import { COPILOT_TARGET_FIELDS } from "@/lib/zai-workspace/copilotAcceptanceContract";
import { aiProposalBindingForField } from "@/lib/zai-workspace/aiProposalContext";
import { runLintRules, type LintIssue } from "@/lib/zai-workspace/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  formatProvenanceHover,
  provenanceMapToSegments,
  provenanceVisualKind,
  sourceLabel,
  type InsertSource,
  type ProvenanceVisualKind,
} from "@/lib/reportFieldMerge";
import { formatProvenanceSummary, provenanceCounts } from "@/lib/reportSectionAccordion";
import { ClinicalTextTools } from "./clinical-text-tools";

import {
  breakObservationsAtSentenceEnds,
  interceptDictationRunOnsWithCaret,
  toClinicalTitleCase,
} from "@/lib/dictationObservationBreak";
import { cn } from "@/lib/utils";
import {
  buildAbnormalContributionSpans,
  buildStartingCanvasChangeHighlights,
  workspaceOverlayPieceClasses,
  workspaceOverlayPieces,
} from "@/lib/zai-workspace/startingCanvasHighlight";

interface Props {
  /**
   * This editor does not host a Quick Select strip, and did for most of its
   * life. Every section that wanted one already rendered `<QuickSelectStrip>`
   * itself — region-scoped, with the silent draft save wired — so the copy in
   * here was a second, blunter strip stacked directly under the first: no
   * `bodyPart`, so it scored every region-scoped box out, and no `onAfterPick`,
   * so a pick from it never saved. One control per section, rendered by the
   * section.
   */
  field: "findings" | "impression" | "recommendation" | "technique" | "clinicalHistory";
  label: string;
  placeholder?: string;
  minHeight?: string;
  showGhost?: boolean;
  /**
   * Transient display-only flash of an abnormal sentence after Quick Select /
   * Finding Composer. Never written into clinical text / PDF.
   */
  transientHighlight?: { needle: string; token: number } | null;
  /** Fired when the radiologist focuses this editor (mouse-first cockpit). */
  onClinicalFocus?: (field: Props["field"]) => void;
  /**
   * Auto-break dictation run-ons (". " → newline) and show cleanup tools.
   * Enabled for Findings / Impression in the live reporting cockpit.
   */
  enableDictationBreaks?: boolean;
  /**
   * Fill the expanded accordion: use CSS height from minHeight and skip
   * content-only auto-grow so Findings/Impression are not 1–2 line slits.
   */
  fillHeight?: boolean;
}

const G: Record<string, string> = { error: "✕", warning: "△", info: "◌" };
const C: Record<string, string> = { error: "text-rose-500", warning: "text-amber-500", info: "text-sky-500" };

const VISUAL_STYLES: Record<ProvenanceVisualKind, string> = {
  manual: "border-l-transparent bg-transparent text-muted-foreground",
  "quick-select": "border-l-sky-500 bg-sky-500/10 text-foreground",
  "quick-findings": "border-l-emerald-500 bg-emerald-500/10 text-foreground",
  merged: "border-l-amber-500 bg-amber-500/10 text-foreground",
  "template-a": "border-l-emerald-600 bg-emerald-100/60 text-emerald-900",
  "template-b": "border-l-sky-600 bg-sky-100/60 text-sky-900",
  "structured-template": "border-l-indigo-500 bg-indigo-500/10 text-foreground",
  "structured-candidate": "border-l-violet-400 bg-violet-500/10 text-foreground italic",
  other: "border-l-slate-400 bg-slate-500/10 text-foreground",
};

const LEGEND: Array<{ kind: ProvenanceVisualKind; label: string; box: string }> = [
  { kind: "quick-select", label: "Quick Select", box: "bg-sky-500/25 border-sky-500" },
  { kind: "quick-findings", label: "Quick Findings", box: "bg-emerald-500/25 border-emerald-500" },
  { kind: "structured-template", label: "Structured", box: "bg-indigo-500/25 border-indigo-500" },
  { kind: "structured-candidate", label: "Impression candidate", box: "bg-violet-500/25 border-violet-400" },
  { kind: "template-a", label: "Format A", box: "bg-emerald-500/30 border-emerald-600" },
  { kind: "template-b", label: "Format B", box: "bg-sky-500/30 border-sky-600" },
  { kind: "merged", label: "Merged", box: "bg-amber-500/25 border-amber-500" },
  { kind: "other", label: "Other assisted", box: "bg-slate-500/25 border-slate-400" },
  { kind: "manual", label: "Manual", box: "bg-transparent border-border" },
];

function uniqueAssistedSources(segments: Array<{ sources: InsertSource[] }>): Set<ProvenanceVisualKind> {
  const kinds = new Set<ProvenanceVisualKind>();
  for (const seg of segments) {
    const kind = provenanceVisualKind(seg.sources);
    if (kind !== "manual") kinds.add(kind);
  }
  return kinds;
}

/**
 * A snippet macro with nothing to fill expands inside `setField`: the ":code" the
 * caret sits behind becomes the sentence, and the browser leaves the cursor at its
 * old offset — which is now in the middle of that sentence, so the next keystroke
 * lands inside clinical text. This returns the caret for AFTER that write.
 *
 * The expansion is identified by the trigger being gone from the stored text, not
 * merely by the text differing: the system-normal withdrawal above can replace this
 * same field inside the same call, and there the cursor must stay where the browser
 * put it rather than shift by the length difference.
 */
function caretAfterMacroExpansion(field: Props["field"], asked: string, wanted: number): number {
  const trigger = asked.match(/:[a-z][a-z0-9_]*$/i)?.[0];
  if (!trigger) return wanted;
  const written = useWorkspace.getState()[`${field}Text` as "findingsText"] as string;
  if (written === asked || written.includes(trigger)) return wanted;
  return wanted + (written.length - asked.length);
}

export function FindingsEditor({
  field,
  label,
  placeholder,
  minHeight = "200px",
  showGhost = false,
  transientHighlight = null,
  onClinicalFocus,
  enableDictationBreaks = false,
  fillHeight = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const canvasOverlayRef = useRef<HTMLDivElement>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [highlightActive, setHighlightActive] = useState(false);
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const value = useWorkspaceSelector(s => s[`${field}Text` as "findingsText"] as string);
  const setField = useWorkspaceSelector(s => s.setField);
  const provenance = useWorkspaceSelector(s => s.fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE);
  const gt = useWorkspaceSelector(s => showGhost ? s.ghostText : null);
  const gTarget = useWorkspaceSelector(s => showGhost ? s.ghostTextTarget : null);
  const accept = useWorkspaceSelector(s => s.acceptGhostText);
  const setGhost = useWorkspaceSelector(s => s.setGhostText);
  // C2 — read the verdict, do not compute one: this is the same call
  // `acceptGhostText` makes, so the colour on screen and the answer at acceptance
  // cannot disagree. Recomputed per render rather than stored, so it cannot itself
  // go out of date.
  const ghostStale = useWorkspaceSelector(s => (showGhost ? s.ghostProposalStale() : false));
  const sid = useWorkspaceSelector(s => s.activeStudyId);
  const studies = useWorkspaceSelector(s => s.studies);
  const startingCanvasBaseline = useWorkspaceSelector((s) => s.startingCanvasBaseline);
  const appliedPathologyPatches = useWorkspaceSelector((s) => s.appliedPathologyPatches);
  const findingsText = useWorkspaceSelector((s) => s.findingsText);
  const impressionText = useWorkspaceSelector((s) => s.impressionText);
  const valueDebounced = useDebouncedValue(value, 200);
  const issues: LintIssue[] = useMemo(() => {
    if (!valueDebounced) return [];
    const st = studies.find(s => s.id === sid);
    return runLintRules(valueDebounced, { modality: st?.modality ?? "XR", sex: st?.patient?.sex });
  }, [valueDebounced, sid, studies]);

  const segments = useMemo(
    () => provenanceMapToSegments(typeof value === "string" ? value : "", provenance),
    [value, provenance],
  );

  useEffect(() => {
    if (field !== "findings") return;
    if (!transientHighlight?.needle) {
      setHighlightActive(false);
      return;
    }
    setHighlightActive(true);
    const ms = reduceMotion ? 400 : 1400;
    const t = window.setTimeout(() => setHighlightActive(false), ms);
    return () => window.clearTimeout(t);
  }, [field, transientHighlight?.token, transientHighlight?.needle, reduceMotion]);

  const highlightOverlay = useMemo(() => {
    if (field !== "findings" || !highlightActive || !transientHighlight?.needle) return null;
    const text = typeof value === "string" ? value : "";
    const needle = transientHighlight.needle;
    const idx = text.indexOf(needle);
    if (idx < 0) return null;
    const before = text.slice(0, idx);
    const after = text.slice(idx + needle.length);
    return { before, mid: needle, after };
  }, [field, highlightActive, transientHighlight?.needle, value]);

  const canvasChangePieces = useMemo(() => {
    if (field !== "findings" && field !== "impression") return null;
    // With the Starting Canvas reference, show every change from it. Without it
    // — after a save and reopen, or a report not begun from a complete normal —
    // still colour what a Quick Select box contributed, because that is the
    // distinction being asked for and it must not vanish in those cases.
    const spans = startingCanvasBaseline
      ? buildStartingCanvasChangeHighlights({
        baseline: startingCanvasBaseline,
        findingsText,
        impressionText,
        patches: appliedPathologyPatches,
      })
      : buildAbnormalContributionSpans({ findingsText, impressionText, patches: appliedPathologyPatches });
    if (spans.length === 0) return null;
    const text = typeof value === "string" ? value : "";
    return workspaceOverlayPieces(text, spans, field);
  }, [
    field,
    startingCanvasBaseline,
    findingsText,
    impressionText,
    appliedPathologyPatches,
    value,
  ]);

  const assistedKinds = useMemo(() => uniqueAssistedSources(segments), [segments]);
  const showProvenanceUi = assistedKinds.size > 0;
  // Read-only attribution: CARE already knows how each segment got here, so the
  // default view is a single counted line ("Manual 8 • Quick Select 4"). The
  // full per-segment map stays available behind "details".
  const sourceCounts = useMemo(
    () =>
      provenanceCounts(
        segments.map((seg) => {
          const kind = provenanceVisualKind(seg.sources);
          return { kind, label: LEGEND.find((l) => l.kind === kind)?.label ?? "Other assisted" };
        }),
      ),
    [segments],
  );

  useEffect(() => {
    if (!ref.current) return;
    if (fillHeight) {
      // Accordion owns height — clear inline content-grow so CSS minHeight/height win.
      ref.current.style.height = "";
      return;
    }
    ref.current.style.height = "auto";
    ref.current.style.height = Math.max(parseInt(minHeight, 10) || 0, ref.current.scrollHeight) + "px";
  }, [value, minHeight, fillHeight]);
  useEffect(() => {
    if (gTarget === field && gt && ref.current) {
      ref.current.focus();
      const e = ref.current.value.length;
      ref.current.setSelectionRange(e, e);
    }
  }, [gTarget, gt, field]);

  const hk = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && gt && gTarget === field) { e.preventDefault(); accept(); return; }
    if (e.key === "Escape" && gt) { e.preventDefault(); setGhost(null, null); return; }
    if (e.ctrlKey && !e.shiftKey && e.key === "Enter") { e.preventDefault(); sg(); return; }
  };
  const sg = () => {
    let s: string | null = null;
    if (field === "impression") s = /mass|lesion|tumor/.test(value) ? "Findings are concerning for malignancy. Recommend tissue diagnosis." : /normal|unremarkable/.test(value) ? "No acute abnormality. Clinical correlation advised." : "Clinical correlation and follow-up.";
    else if (field === "findings") s = /measur/.test(value) ? "measuring approximately ___ × ___ × ___ cm." : /normal$/.test(value) ? "in size and configuration. No acute abnormality." : /mass|lesion|tumor/.test(value) ? "with irregular margins and heterogeneous enhancement." : "No evidence of acute infarct, hemorrhage, or mass lesion.";
    else if (field === "recommendation") s = "Clinical correlation advised. Follow-up as clinically indicated.";
    if (!s) { setGhost(null, null); return; }
    // C2 — this completion is deterministic (no model involved), but it is still a
    // suggestion resting on text the radiologist may change before pressing Tab, so
    // it carries the same binding as a model's: generated FROM this field's text
    // now, destined for this field. A field outside the narrative set gets no
    // binding, and an unbound suggestion fails closed at acceptance.
    const narrative = (COPILOT_TARGET_FIELDS as readonly string[]).includes(field)
      ? (field as (typeof COPILOT_TARGET_FIELDS)[number])
      : null;
    const binding = narrative
      ? aiProposalBindingForField(useWorkspace.getState(), narrative, narrative)
      : null;
    setGhost(s, narrative, binding);
  };
  const lines = (typeof value === "string" ? value : "").split("\n");

  return (
    <div
      className={cn("relative w-full", fillHeight && "flex min-h-0 flex-1 flex-col")}
      data-report-field={field}
      data-testid={`findings-editor-${field}`}
      data-fill-height={fillHeight ? "true" : undefined}
    >
      {enableDictationBreaks && (
        <ClinicalTextTools
          className="mb-1.5"
          onBreakLines={() => setField(field, breakObservationsAtSentenceEnds(typeof value === "string" ? value : ""))}
          onTitleCase={() => setField(field, toClinicalTitleCase(typeof value === "string" ? value : ""))}
          onClear={() => setField(field, "")}
        />
      )}
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-emerald-600/80">{label}</label>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {issues.length > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{issues.length} lint</span>}
          <button onClick={sg} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition shadow-sm" title="Phrase suggestion — local template, not AI (Ctrl+Enter)"><span className="font-mono text-[10px]">⌃↵</span> Phrase</button>
        </div>
      </div>

      {showProvenanceUi && (
        <div
          className="mb-1.5 flex flex-wrap items-center gap-1.5"
          data-testid={`provenance-legend-${field}`}
          data-editor-only="provenance"
        >
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sources</span>
          <span
            className="text-[10px] font-semibold text-foreground/80"
            data-testid={`provenance-summary-${field}`}
            title="How this text entered the report — tracked automatically, never printed"
          >
            {formatProvenanceSummary(sourceCounts)}
          </span>
          <button
            type="button"
            onClick={() => setProvenanceOpen((v) => !v)}
            className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            data-testid={`provenance-details-toggle-${field}`}
            aria-expanded={provenanceOpen}
          >
            {provenanceOpen ? "hide details" : "details"}
          </button>
          {provenanceOpen &&
            LEGEND.filter((item) => item.kind === "manual" || assistedKinds.has(item.kind)).map((item) => (
              <span
                key={item.kind}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-bold",
                  item.box,
                )}
                title={item.label}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm border", item.box)} aria-hidden />
                {item.label}
              </span>
            ))}
        </div>
      )}

      <div className={cn("relative flex", fillHeight && "min-h-0 flex-1")}>
        <div className="flex-none w-8 select-none border-r border-emerald-200/40 bg-gradient-to-b from-emerald-50/40 to-emerald-50/10 text-right text-[10px] leading-[1.6] font-mono pt-2.5 text-emerald-600/60" aria-hidden>
          {lines.map((_, i) => {
            const ln = i + 1;
            const li = issues.find(x => x.line === ln);
            return (
              <div key={i} className="h-[1.6em] pr-1.5 relative">
                {li && (
                  <span
                    className={`absolute right-0.5 top-0 cursor-pointer ${C[li.severity]}`}
                    title={li.message}
                    onClick={() => {
                      if (ref.current) {
                        const la = value.split("\n");
                        let pos = 0;
                        for (let k = 0; k < i; k++) pos += la[k].length + 1;
                        ref.current.focus();
                        ref.current.setSelectionRange(pos, pos + la[i].length);
                      }
                    }}
                  >
                    {G[li.severity]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className={cn("grid flex-1", fillHeight && "min-h-0")}>
          {/*
            FindingsHighlightEditor technique: CSS-grid stacks an aria-hidden
            highlight layer behind a transparent-background textarea so scroll
            and box size stay in sync. Display-only — never written into clinical text.
          */}
          {(canvasChangePieces || highlightOverlay) && (
            <div
              ref={canvasOverlayRef}
              className={cn(
                "col-start-1 row-start-1 overflow-hidden whitespace-pre-wrap break-words pointer-events-none px-3 py-2.5 text-sm leading-[1.6] text-foreground",
                fillHeight && "h-full min-h-[inherit]",
              )}
              data-testid={canvasChangePieces ? `canvas-change-overlay-${field}` : "abnormal-highlight-overlay"}
              data-editor-only={canvasChangePieces ? "canvas-change" : "abnormal-highlight"}
              aria-hidden
            >
              {canvasChangePieces
                ? canvasChangePieces.map((piece, i) => (
                  <span
                    key={`${i}-${piece.text.slice(0, 12)}`}
                    className={workspaceOverlayPieceClasses(piece)}
                    data-canvas-change={piece.highlight ? (piece.abnormal ? "abnormal" : "manual") : undefined}
                  >
                    {piece.text}
                  </span>
                ))
                : highlightOverlay && (
                  <>
                    <span className="text-transparent">{highlightOverlay.before}</span>
                    <span
                      className={cn(
                        "rounded-sm bg-amber-200/70 dark:bg-amber-700/40 text-transparent",
                        !reduceMotion && "animate-pulse",
                      )}
                    >
                      {highlightOverlay.mid}
                    </span>
                    <span className="text-transparent">{highlightOverlay.after}</span>
                  </>
                )}
            </div>
          )}
          <textarea
            ref={ref}
            value={value}
            onChange={e => {
              const el = e.target;
              const raw = el.value;
              const caret = el.selectionStart ?? raw.length;
              if (!enableDictationBreaks) {
                setField(field, raw);
                const next = caretAfterMacroExpansion(field, raw, caret);
                if (next !== caret) {
                  requestAnimationFrame(() => {
                    if (ref.current) ref.current.setSelectionRange(next, next);
                  });
                }
                return;
              }
              const { text, caret: nextCaret } = interceptDictationRunOnsWithCaret(raw, caret);
              setField(field, text);
              const macroCaret = caretAfterMacroExpansion(field, text, nextCaret);
              // Restore caret after React re-render so live ". " → newline
              // does not jump the cursor (abbreviation guards are length-safe),
              // and so a macro that expanded under the cursor does not either.
              if (text !== raw || macroCaret !== caret) {
                requestAnimationFrame(() => {
                  if (ref.current) ref.current.setSelectionRange(macroCaret, macroCaret);
                });
              }
            }}
            onScroll={() => {
              if (canvasOverlayRef.current && ref.current) {
                canvasOverlayRef.current.scrollTop = ref.current.scrollTop;
                canvasOverlayRef.current.scrollLeft = ref.current.scrollLeft;
              }
            }}
            onFocus={() => onClinicalFocus?.(field)}
            onKeyDown={hk}
            placeholder={placeholder ?? "Begin typing..."}
            spellCheck={false}
            aria-label={label}
            className={cn(
              "col-start-1 row-start-1 relative w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-[1.6] outline-none placeholder:text-muted-foreground/50",
              canvasChangePieces ? "text-transparent caret-foreground" : "text-foreground",
              enableDictationBreaks && "whitespace-pre-wrap",
              fillHeight && "h-full min-h-[inherit] overflow-y-auto",
            )}
            style={fillHeight ? { minHeight, height: minHeight } : { minHeight }}
            data-testid={`canonical-${field}-editor`}
          />
          {gt && gTarget === field && (
            <div className="pointer-events-none col-start-1 row-start-1 relative z-[1] px-3 py-2.5 text-sm leading-[1.6] whitespace-pre-wrap">
              <span className="invisible">{value}{value.endsWith("\n") ? "" : " "}</span>
              <span className={ghostStale ? "italic text-amber-700/70" : "italic text-emerald-600/60"}>{gt}</span>
              <span
                className={cn(
                  "ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono not-italic",
                  ghostStale ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700",
                )}
                data-testid={ghostStale ? `ghost-stale-${field}` : undefined}
              >
                {ghostStale ? "out of date" : "Tab"}
              </span>
            </div>
          )}
        </div>
      </div>

      {showProvenanceUi && provenanceOpen && (
        <div
          className="mt-1.5 space-y-1"
          data-testid={`provenance-map-${field}`}
          data-editor-only="provenance"
          aria-label="Source provenance (editor only)"
        >
          {segments.map((seg, i) => {
            const kind = provenanceVisualKind(seg.sources);
            if (kind === "manual") return null;
            return (
              <div
                key={`${seg.key}-${i}`}
                className={cn(
                  "border-l-2 px-2 py-1 text-[11px] leading-snug underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                  VISUAL_STYLES[kind],
                )}
                title={formatProvenanceHover(seg.sources)}
                data-provenance-kind={kind}
              >
                <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wide opacity-80">
                  {kind === "merged"
                    ? seg.sources.filter((s) => s !== "manual").map(sourceLabel).join(" + ")
                    : sourceLabel(seg.sources.find((s) => s !== "manual") ?? seg.sources[0]!)}
                </span>
                <span className="text-foreground/80">{seg.text.length > 120 ? `${seg.text.slice(0, 117)}…` : seg.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {issues.slice(0, 3).map(i => (
            <div key={`${i.line}-${i.column}-${i.code}`} className="flex items-start gap-2 text-[10px]">
              <span className={`font-mono ${C[i.severity]}`}>{G[i.severity]}</span>
              <span className="text-muted-foreground"><span className="font-mono">L{i.line}</span> · {i.message}</span>
            </div>
          ))}
          {issues.length > 3 && <div className="text-[10px] text-muted-foreground/70 pl-5">+{issues.length - 3} more</div>}
        </div>
      )}
    </div>
  );
}
