/**
 * MriCervicalLevelBlock.tsx — per-level editor for cervical disc levels.
 *
 * Architectural reference: MriLumbarLevelBlock.tsx
 *
 * Supports clinically appropriate cervical selections:
 *   DISC: normal / desiccation / bulge / protrusion / disc-osteophyte / extrusion
 *   CANAL: indentation / compression / stenosis (mild/mod/severe)
 *   FORAMINA: left / right / bilateral + severity
 *   CORD: normal / compression / T2 signal change (myelopathy)
 *   FACET: arthropathy / uncovertebral hypertrophy
 *   LIGAMENT: LF hypertrophy / PLL thickening
 *   AP canal diameter (numeric)
 *
 * CERVICAL ROOT HINT:
 *   Shows "Corresponding exiting nerve root: C6" as a read-only hint for
 *   foraminal disease. Does NOT emit a lumbar-style traversing-root
 *   observation. Radiologist may override.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CERVICAL_CANAL_OPTIONS,
  CERVICAL_CORD_OPTIONS,
  CERVICAL_DISC_MORPHOLOGY_OPTIONS,
  CERVICAL_FACET_OPTIONS,
  CERVICAL_FORAMINAL_OPTIONS,
  CERVICAL_FORAMINAL_SEVERITY,
  CERVICAL_LIGAMENT_OPTIONS,
  type CervicalLevelSelection,
} from "@/lib/mriCervicalLevelState";
import {
  cervicalLevelApplyHasContent,
  deriveCervicalLevelBlockDisplay,
  deriveCervicalLevelSelection,
  cervicalExitingRootHint,
} from "@/lib/mriCervicalLevelState";
import type { MriCervicalRegionDef } from "@/lib/mriSpineCanvasRegions";

export function MriCervicalLevelBlock({
  region,
  patches,
  findingsText,
  disabled,
  highlighted,
  forceOpen,
  onApply,
  onFocus,
  onInsertRegionPhrase,
  canalApMm,
}: {
  region: MriCervicalRegionDef;
  patches: AppliedPathologyPatch[];
  findingsText?: string;
  disabled?: boolean;
  highlighted?: boolean;
  forceOpen?: boolean | null;
  onApply: (sel: CervicalLevelSelection) => void;
  onFocus?: () => void;
  onInsertRegionPhrase?: (regionKey: string, phrase: string, concept: string) => void;
  canalApMm?: number | null;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (forceOpen == null) return;
    setOpen(forceOpen);
  }, [forceOpen]);

  const display = useMemo(
    () => deriveCervicalLevelBlockDisplay(patches, region.label, findingsText ?? "", []),
    [patches, region.label, findingsText],
  );
  const ledgerSel = useMemo(
    () => deriveCervicalLevelSelection(patches, region.label),
    [patches, region.label],
  );
  const [sel, setSel] = useState<CervicalLevelSelection>({});

  useEffect(() => {
    if (!open) {
      setSel({
        ...ledgerSel,
        canalApMm: ledgerSel.canalApMm ?? canalApMm ?? null,
      });
    }
  }, [ledgerSel, open, canalApMm]);

  useEffect(() => {
    if (open && canalApMm != null && sel.canalApMm == null) {
      setSel((s) => ({ ...s, canalApMm }));
    }
  }, [open, canalApMm, sel.canalApMm]);

  const exitingRootHint = useMemo(
    () => region.kind === "disc-level" ? cervicalExitingRootHint(region.label) : null,
    [region.kind, region.label],
  );

  if (region.kind !== "disc-level") {
    const phrases = regionQuickPhrases(region.key);
    return (
      <div
        className={[
          "rounded-md border border-slate-200 bg-white px-2 py-1.5",
          highlighted ? "ring-1 ring-sky-400" : "",
        ].join(" ")}
        data-testid={`mri-cerv-region-${region.key}`}
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
                data-testid={`mri-cerv-region-phrase-${region.key}-${p.id}`}
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
            ? "border-emerald-200/80 from-emerald-50/40"
            : "border-slate-200 from-slate-50/40";

  return (
    <div
      className={[
        "rounded-md border bg-gradient-to-br to-white px-2 py-1.5",
        statusClass,
        highlighted ? "ring-1 ring-sky-400" : "",
      ].join(" ")}
      data-testid={`mri-cerv-level-${region.key}`}
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
        <span className="text-[11px] font-bold text-emerald-950">{region.label}</span>
        <span className="text-[9px] text-emerald-800/80" data-testid={`mri-cerv-level-status-${region.key}`}>
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
        <ul className="mt-1 space-y-0.5" data-testid={`mri-cerv-level-summary-${region.key}`}>
          {display.summaryLines.slice(0, 6).map((line) => (
            <li key={line} className="text-[10px] leading-snug text-slate-800 line-clamp-2">{line}</li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-emerald-100 pt-2" data-testid={`mri-cerv-level-editor-${region.key}`}>
          <ChipRow
            label="Disc"
            options={CERVICAL_DISC_MORPHOLOGY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.morphology}
            onChange={(id) => setSel((s) => ({ ...s, morphology: id as CervicalLevelSelection["morphology"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Canal"
            options={CERVICAL_CANAL_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.canal}
            onChange={(id) => setSel((s) => ({ ...s, canal: id as CervicalLevelSelection["canal"] }))}
            disabled={disabled}
          />
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase text-slate-500">Foram</span>
            {CERVICAL_FORAMINAL_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminal: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminal === o.id
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
            {CERVICAL_FORAMINAL_SEVERITY.map((o) => (
              <button
                key={`sev-${o.id}`}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminalSeverity: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminalSeverity === o.id
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
          {exitingRootHint && sel.foraminal && sel.foraminal !== "none" ? (
            <p className="text-[8px] text-emerald-700 italic" data-testid={`mri-cerv-exiting-root-hint-${region.key}`}>
              Corresponding exiting nerve root: {exitingRootHint}
            </p>
          ) : null}
          <ChipRow
            label="Cord"
            options={CERVICAL_CORD_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.cord}
            onChange={(id) => setSel((s) => ({ ...s, cord: id as CervicalLevelSelection["cord"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Facet"
            options={CERVICAL_FACET_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.facet}
            onChange={(id) => setSel((s) => ({ ...s, facet: id as CervicalLevelSelection["facet"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Ligmt"
            options={CERVICAL_LIGAMENT_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.ligament}
            onChange={(id) => setSel((s) => ({ ...s, ligament: id as CervicalLevelSelection["ligament"] }))}
            disabled={disabled}
          />
          <label className="flex items-center gap-1.5 text-[10px] text-slate-700">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase text-slate-500">AP mm</span>
            <input
              type="number"
              step="0.1"
              className="h-6 w-20 rounded border border-slate-200 px-1 text-[10px]"
              value={sel.canalApMm ?? ""}
              disabled={disabled}
              placeholder={canalApMm != null ? String(canalApMm) : "—"}
              onChange={(e) => {
                const v = e.target.value;
                setSel((s) => ({ ...s, canalApMm: v === "" ? null : Number(v) }));
              }}
              data-testid={`mri-cerv-level-ap-${region.key}`}
            />
            {canalApMm != null && sel.canalApMm == null ? (
              <button
                type="button"
                className="text-[9px] text-sky-700 underline"
                onClick={() => setSel((s) => ({ ...s, canalApMm }))}
              >
                Use {canalApMm} mm
              </button>
            ) : null}
          </label>
          <button
            type="button"
            disabled={disabled || !cervicalLevelApplyHasContent(sel)}
            className="h-7 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
            onClick={() => onApply(sel)}
            data-testid={`mri-cerv-level-apply-${region.key}`}
          >
            Apply to report
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Inline the AppliedPathologyPatch type import to avoid circular deps
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";

function regionQuickPhrases(key: string): Array<{ id: string; label: string; phrase: string; concept: string }> {
  switch (key) {
    case "alignment":
      return [
        { id: "lordosis", label: "↓ Lordosis", phrase: "Loss of cervical lordosis is noted.", concept: "alignment" },
        { id: "normal-align", label: "Normal alignment", phrase: "Cervical alignment is normal.", concept: "alignment" },
      ];
    case "vertebral-marrow":
      return [
        { id: "normal-marrow", label: "Normal marrow", phrase: "Cervical vertebral body heights and marrow signal are preserved.", concept: "endplate" },
      ];
    case "cord":
      return [
        { id: "normal-cord", label: "Normal cord", phrase: "Cervical cord shows normal signal with no compression.", concept: "cord_signal" },
      ];
    case "posterior-elements":
      return [
        { id: "facet", label: "Facet OA", phrase: "Facet arthropathy is noted.", concept: "facet_joint" },
      ];
    case "paraspinal":
      return [
        { id: "normal-ps", label: "Unremarkable", phrase: "Prevertebral and paraspinal soft tissues are unremarkable.", concept: "paraspinal" },
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
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
