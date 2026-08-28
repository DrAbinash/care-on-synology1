import { useEffect, useMemo, useState } from "react";
import {
  CANAL_STENOSIS_OPTIONS,
  DISC_MORPHOLOGY_OPTIONS,
  FORAMINAL_LATERALITY_OPTIONS,
  FORAMINAL_SEVERITY_OPTIONS,
  LATERALITY_OPTIONS,
  MODIC_OPTIONS,
  ROOT_LEVEL_SUGGESTIONS,
  ROOT_RELATION_OPTIONS,
  composeLumbarLevelNarrative,
  inferExitingRoot,
  inferTraversingRoot,
  type LumbarLevelSelection,
  type MriLumbarRegionDef,
} from "@/lib/mriLumbarRegions";
import {
  deriveLevelBlockDisplay,
  deriveLumbarLevelSelection,
} from "@/lib/mriLumbarLevelState";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { formatAnchorChip } from "@/lib/observationAnchor";

export function MriLumbarLevelBlock({
  region,
  patches,
  findingsText,
  disabled,
  highlighted,
  onApply,
  onFocus,
  onInsertRegionPhrase,
  canalApMm,
}: {
  region: MriLumbarRegionDef;
  patches: AppliedPathologyPatch[];
  findingsText?: string;
  disabled?: boolean;
  highlighted?: boolean;
  onApply: (sel: LumbarLevelSelection, composed: ReturnType<typeof composeLumbarLevelNarrative>) => void;
  onFocus?: () => void;
  /** Non-disc regions: insert a short owned phrase via parent. */
  onInsertRegionPhrase?: (regionKey: string, phrase: string, concept: string) => void;
  /** Canal AP from existing measurement store / viewer for this level. */
  canalApMm?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const display = useMemo(
    () => deriveLevelBlockDisplay(patches, region.label, findingsText ?? "", []),
    [patches, region.label, findingsText],
  );
  const ledgerSel = useMemo(
    () => deriveLumbarLevelSelection(patches, region.label),
    [patches, region.label],
  );
  const [sel, setSel] = useState<LumbarLevelSelection>({});

  // INITIAL STATE = ledger-derived; re-sync when reopening or ledger changes while closed.
  useEffect(() => {
    if (!open) {
      setSel({
        ...ledgerSel,
        canalApMm: ledgerSel.canalApMm ?? canalApMm ?? null,
        rootLevel: ledgerSel.rootLevel || inferTraversingRoot(region.label),
      });
    }
  }, [ledgerSel, open, canalApMm, region.label]);

  useEffect(() => {
    if (open && canalApMm != null && sel.canalApMm == null) {
      setSel((s) => ({ ...s, canalApMm }));
    }
  }, [open, canalApMm, sel.canalApMm]);

  const preview = useMemo(() => composeLumbarLevelNarrative(region.label, sel), [region.label, sel]);

  if (region.kind !== "disc-level") {
    const phrases = regionQuickPhrases(region.key);
    return (
      <div
        className={[
          "rounded-md border border-slate-200 bg-white px-2 py-1.5",
          highlighted ? "ring-1 ring-sky-400" : "",
        ].join(" ")}
        data-testid={`mri-region-${region.key}`}
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
                data-testid={`mri-region-phrase-${region.key}-${p.id}`}
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
            ? "border-amber-200/80 from-amber-50/40"
            : "border-slate-200 from-slate-50/40";

  return (
    <div
      className={[
        "rounded-md border bg-gradient-to-br to-white px-2 py-1.5",
        statusClass,
        highlighted ? "ring-1 ring-sky-400" : "",
      ].join(" ")}
      data-testid={`mri-level-${region.key}`}
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
        <span className="text-[11px] font-bold text-amber-950">{region.label}</span>
        <span className="text-[9px] text-amber-800/80" data-testid={`mri-level-status-${region.key}`}>
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
        <ul className="mt-1 space-y-0.5" data-testid={`mri-level-summary-${region.key}`}>
          {display.summaryLines.slice(0, 6).map((line) => (
            <li key={line} className="text-[10px] leading-snug text-slate-800 line-clamp-2">{line}</li>
          ))}
        </ul>
      ) : display.kind === "template-narrative" ? (
        <p className="mt-1 text-[10px] text-indigo-800">
          Narrative references this level — not yet structured in ledger
        </p>
      ) : null}
      {display.patches[0]?.observation?.anchor ? (
        <div className="mt-0.5 text-[8px] font-mono text-sky-800">
          {formatAnchorChip(display.patches[0].observation.anchor)}
        </div>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-amber-100 pt-2" data-testid={`mri-level-editor-${region.key}`}>
          <ChipRow
            label="Disc"
            options={DISC_MORPHOLOGY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.morphology}
            onChange={(id) => setSel((s) => ({ ...s, morphology: id as LumbarLevelSelection["morphology"] }))}
            disabled={disabled}
          />
          <div className="flex flex-wrap gap-2 pl-10">
            <label className="flex items-center gap-1 text-[9px] text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(sel.desiccation)}
                disabled={disabled}
                onChange={(e) => setSel((s) => ({ ...s, desiccation: e.target.checked }))}
              />
              Desiccation
            </label>
            <label className="flex items-center gap-1 text-[9px] text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(sel.reducedHeight)}
                disabled={disabled}
                onChange={(e) => setSel((s) => ({ ...s, reducedHeight: e.target.checked }))}
              />
              ↓ Height
            </label>
          </div>
          <ChipRow
            label="Side"
            options={LATERALITY_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.laterality}
            onChange={(id) => setSel((s) => ({ ...s, laterality: id as LumbarLevelSelection["laterality"] }))}
            disabled={disabled}
          />
          <ChipRow
            label="Canal"
            options={CANAL_STENOSIS_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.canal}
            onChange={(id) => setSel((s) => ({ ...s, canal: id as LumbarLevelSelection["canal"] }))}
            disabled={disabled}
          />
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase text-slate-500">Foram</span>
            {FORAMINAL_LATERALITY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminalLaterality: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminalLaterality === o.id
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
            {FORAMINAL_SEVERITY_OPTIONS.map((o) => (
              <button
                key={`sev-${o.id}`}
                type="button"
                disabled={disabled}
                onClick={() => setSel((s) => ({ ...s, foraminalSeverity: o.id }))}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  sel.foraminalSeverity === o.id
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <ChipRow
            label="Modic"
            options={MODIC_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={sel.modic}
            onChange={(id) => setSel((s) => ({ ...s, modic: id as LumbarLevelSelection["modic"] }))}
            disabled={disabled}
          />
          <label className="flex items-center gap-1.5 text-[10px] text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(sel.rootContact)}
              disabled={disabled}
              onChange={(e) => setSel((s) => ({
                ...s,
                rootContact: e.target.checked,
                rootLevel: s.rootLevel || inferTraversingRoot(region.label),
              }))}
            />
            Root involvement
          </label>
          {sel.rootContact ? (
            <div className="ml-4 space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[8px] font-bold uppercase text-slate-500">Root</span>
                {ROOT_LEVEL_SUGGESTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSel((s) => ({ ...s, rootLevel: r }))}
                    className={[
                      "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                      sel.rootLevel === r
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-slate-200 bg-white text-slate-800",
                    ].join(" ")}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="text-[8px] text-muted-foreground">
                Suggested traversing {inferTraversingRoot(region.label)} · exiting {inferExitingRoot(region.label)} — choose explicitly
              </p>
              <ChipRow
                label="Rel"
                options={ROOT_RELATION_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                value={sel.rootRelation ?? "contact"}
                onChange={(id) => setSel((s) => ({ ...s, rootRelation: id as LumbarLevelSelection["rootRelation"] }))}
                disabled={disabled}
              />
            </div>
          ) : null}
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
                setSel((s) => ({
                  ...s,
                  canalApMm: v === "" ? null : Number(v),
                }));
              }}
              data-testid={`mri-level-ap-${region.key}`}
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
          <div className="rounded border border-dashed border-amber-200 bg-white/80 p-1.5">
            <div className="text-[8px] font-bold uppercase text-amber-800">Composed preview</div>
            <p className="text-[10px] text-slate-800" data-testid={`mri-level-preview-${region.key}`}>
              {preview.findings}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || (!sel.morphology && !sel.desiccation && !sel.reducedHeight && !sel.canal && !sel.modic && !sel.rootContact)}
            className="h-7 rounded-md bg-amber-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
            onClick={() => {
              onApply(sel, preview);
              // After Apply, local state reconciles from ledger on next close/open;
              // keep current sel until ledger updates.
            }}
            data-testid={`mri-level-apply-${region.key}`}
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
        { id: "lordosis", label: "↓ Lordosis", phrase: "Lumbar lordosis is mildly reduced.", concept: "alignment" },
        { id: "listhesis", label: "Listhesis", phrase: "No spondylolisthesis.", concept: "spondylolisthesis" },
        { id: "scoliosis", label: "Scoliosis", phrase: "Mild lumbar scoliosis is noted.", concept: "alignment" },
      ];
    case "vertebral-marrow":
      return [
        { id: "normal-marrow", label: "Normal marrow", phrase: "Vertebral body heights and marrow signal are preserved.", concept: "endplate" },
        { id: "hemangioma", label: "Hemangioma", phrase: "Incidental vertebral hemangioma is noted.", concept: "endplate" },
      ];
    case "conus":
      return [
        { id: "normal-conus", label: "Normal conus", phrase: "Conus medullaris terminates at L1 with normal appearance.", concept: "conus" },
      ];
    case "posterior-elements":
      return [
        { id: "facet", label: "Facet OA", phrase: "Facet arthropathy is noted.", concept: "facet_joint" },
        { id: "lfh", label: "LF hypertrophy", phrase: "Ligamentum flavum hypertrophy is noted.", concept: "facet_joint" },
      ];
    case "paraspinal":
      return [
        { id: "normal-ps", label: "Unremarkable", phrase: "Paraspinal soft tissues are unremarkable.", concept: "paraspinal" },
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
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-slate-200 bg-white text-slate-800 hover:border-amber-300",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
