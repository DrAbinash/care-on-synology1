/**
 * MriDorsalLevelBlock.tsx — per-level editor for dorsal/thoracic disc levels.
 *
 * Architectural reference: MriLumbarLevelBlock.tsx
 *
 * Supports clinically appropriate dorsal selections:
 *   DISC: normal / desiccation / bulge / protrusion / extrusion
 *   CANAL: indentation / compression / stenosis (mild/mod/severe)
 *   FORAMINA: left / right / bilateral + severity
 *   CORD: normal / compression / T2 signal change
 *   VERTEBRAL: marrow edema / endplate erosion / fracture / collapse
 *   INFECTION (structured, NOT one-click TB):
 *     disc involvement / paravertebral collection / epidural component
 */

import { useEffect, useMemo, useState } from "react";
import {
  DORSAL_CANAL_OPTIONS,
  DORSAL_CORD_OPTIONS,
  DORSAL_DISC_MORPHOLOGY_OPTIONS,
  DORSAL_FORAMINAL_OPTIONS,
  DORSAL_FORAMINAL_SEVERITY,
  DORSAL_INFECTION_OPTIONS,
  DORSAL_VERTEBRAL_OPTIONS,
  type DorsalLevelSelection,
} from "@/lib/mriDorsalLevelState";
import {
  dorsalLevelApplyHasContent,
  deriveDorsalLevelBlockDisplay,
  deriveDorsalLevelSelection,
} from "@/lib/mriDorsalLevelState";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { MriDorsalRegionDef } from "@/lib/mriSpineCanvasRegions";

export function MriDorsalLevelBlock({
  region,
  patches,
  findingsText,
  disabled,
  highlighted,
  forceOpen,
  onApply,
  onFocus,
  onInsertRegionPhrase,
}: {
  region: MriDorsalRegionDef;
  patches: AppliedPathologyPatch[];
  findingsText?: string;
  disabled?: boolean;
  highlighted?: boolean;
  forceOpen?: boolean | null;
  onApply: (sel: DorsalLevelSelection) => void;
  onFocus?: () => void;
  onInsertRegionPhrase?: (regionKey: string, phrase: string, concept: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (forceOpen == null) return;
    setOpen(forceOpen);
  }, [forceOpen]);

  const display = useMemo(
    () => deriveDorsalLevelBlockDisplay(patches, region.label, findingsText ?? "", []),
    [patches, region.label, findingsText],
  );
  const ledgerSel = useMemo(
    () => deriveDorsalLevelSelection(patches, region.label),
    [patches, region.label],
  );
  const [sel, setSel] = useState<DorsalLevelSelection>({});

  useEffect(() => {
    if (!open) {
      setSel({ ...ledgerSel });
    }
  }, [ledgerSel, open]);

  if (region.kind !== "disc-level") {
    const phrases = regionQuickPhrases(region.key);
    return (
      <div
        className={[
          "rounded-md border border-slate-200 bg-white px-2 py-1.5",
          highlighted ? "ring-1 ring-sky-400" : "",
        ].join(" ")}
        data-testid={`mri-dors-region-${region.key}`}
        onFocus={onFocus}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-slate-800">{region.label}</span>
          <span className="text-[9px] text-muted-foreground">
            {display.patches.length > 0 ? `${display.patches.length} obs` : display.kind === "template-narrative" ? "Narrative" : "QS / phrase"}
          </span>
        </div>
        {display.summaryLines.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {display.summaryLines.slice(0, 4).map((line) => (
              <li key={line} className="text-[10px] text-slate-700 line-clamp-2">{line}</li>
            ))}
          </ul>
        ) : null}
        {!disabled && onInsertRegionPhrase ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {phrases.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-800 hover:border-amber-400"
                onClick={() => {
                  onFocus?.();
                  onInsertRegionPhrase(region.key, p.phrase, p.concept);
                }}
                data-testid={`mri-dors-region-phrase-${region.key}-${p.id}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const statusClass =
    display.kind === "conflict"
      ? "border-rose-300 from-rose-50/50"
      : display.kind === "stale"
        ? "border-amber-400 from-amber-100/60"
        : display.kind === "template-narrative"
          ? "border-indigo-200 from-indigo-50/40"
          : display.kind === "structured"
            ? "border-teal-200/80 from-teal-50/40"
            : "border-slate-200 from-slate-50/40";

  return (
    <div
      className={[
        "rounded-md border bg-gradient-to-br to-white px-2 py-1.5",
        statusClass,
        highlighted ? "ring-1 ring-sky-400" : "",
      ].join(" ")}
      data-testid={`mri-dors-level-${region.key}`}
      data-display-kind={display.kind}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => {
          setOpen((v) => !v);
          onFocus?.();
        }}
        disabled={disabled}
      >
        <span className="text-[11px] font-bold text-teal-950">{region.label}</span>
        <span className="text-[9px] text-teal-800/80" data-testid={`mri-dors-level-status-${region.key}`}>
          {display.kind === "empty"
            ? "Empty"
            : display.kind === "template-narrative"
              ? "Template / narrative"
              : display.kind === "stale"
                ? "Stale"
                : display.kind === "conflict"
                  ? "Conflict"
                  : display.summaryLines.length > 1
                    ? `${display.summaryLines.length} findings`
                    : (display.label || "Structured")}
        </span>
      </button>
      {display.summaryLines.length > 0 ? (
        <ul className="mt-1 space-y-0.5" data-testid={`mri-dors-level-summary-${region.key}`}>
          {display.summaryLines.slice(0, 6).map((line) => (
            <li key={line} className="text-[10px] leading-snug text-slate-800 line-clamp-2">{line}</li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-teal-100 pt-2" data-testid={`mri-dors-level-editor-${region.key}`}>
          <ChipRow
            label="Disc"
            options={DORSAL_DISC_MORPHOLOGY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.morphology}
            onChange={(id) => setSel((s) => ({ ...s, morphology: id as DorsalLevelSelection["morphology"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Canal"
            options={DORSAL_CANAL_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.canal}
            onChange={(id) => setSel((s) => ({ ...s, canal: id as DorsalLevelSelection["canal"] }))}
            disabled={disabled}
          />
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase text-slate-500">Foram</span>
            {DORSAL_FORAMINAL_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminal: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminal === o.id
                    ? "border-teal-500 bg-teal-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
            {DORSAL_FORAMINAL_SEVERITY.map((o) => (
              <button
                key={`sev-${o.id}`}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminalSeverity: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminalSeverity === o.id
                    ? "border-teal-500 bg-teal-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <ChipRow
            label="Cord"
            options={DORSAL_CORD_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.cord}
            onChange={(id) => setSel((s) => ({ ...s, cord: id as DorsalLevelSelection["cord"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Vert"
            options={DORSAL_VERTEBRAL_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.vertebral}
            onChange={(id) => setSel((s) => ({ ...s, vertebral: id as DorsalLevelSelection["vertebral"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Infx"
            options={DORSAL_INFECTION_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.infection}
            onChange={(id) => setSel((s) => ({ ...s, infection: id as DorsalLevelSelection["infection"] }))}
            disabled={disabled}
          />
          <button
            type="button"
            disabled={disabled || !dorsalLevelApplyHasContent(sel)}
            className="h-7 rounded-md bg-teal-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
            onClick={() => onApply(sel)}
            data-testid={`mri-dors-level-apply-${region.key}`}
          >
            Apply to report
          </button>
        </div>
      ) : null}
    </div>
  );
}

function regionQuickPhrases(key: string): Array<{ id: string; label: string; phrase: string; concept: string }> {
  switch (key) {
    case "alignment":
      return [
        { id: "kyphosis", label: "Kyphosis", phrase: "Thoracic kyphosis is maintained.", concept: "alignment" },
        { id: "scoliosis", label: "Scoliosis", phrase: "Mild thoracic scoliosis is noted.", concept: "alignment" },
      ];
    case "vertebral-marrow":
      return [
        { id: "normal-marrow", label: "Normal marrow", phrase: "Dorsal vertebral body heights and marrow signal are preserved.", concept: "endplate" },
      ];
    case "cord":
      return [
        { id: "normal-cord", label: "Normal cord", phrase: "Thoracic cord shows normal signal with no compression.", concept: "cord_signal" },
      ];
    case "posterior-elements":
      return [
        { id: "facet", label: "Facet OA", phrase: "Facet arthropathy is noted.", concept: "facet_joint" },
      ];
    case "paraspinal":
      return [
        { id: "normal-ps", label: "Unremarkable", phrase: "Paravertebral soft tissues are unremarkable.", concept: "paraspinal" },
      ];
    default:
      return [];
  }
}

function ChipRow({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-10 shrink-0 text-[8px] font-bold uppercase text-slate-500">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={[
            "rounded border px-1.5 py-0.5 text-[9px] font-medium",
            value === o.id
              ? "border-teal-500 bg-teal-500 text-white"
              : "border-slate-200 bg-white text-slate-800 hover:border-teal-300",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
