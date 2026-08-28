import { useMemo, useState } from "react";
import {
  CANAL_STENOSIS_OPTIONS,
  DISC_MORPHOLOGY_OPTIONS,
  LATERALITY_OPTIONS,
  MODIC_OPTIONS,
  composeLumbarLevelNarrative,
  type LumbarLevelSelection,
  type MriLumbarRegionDef,
} from "@/lib/mriLumbarRegions";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { formatAnchorChip } from "@/lib/observationAnchor";

function patchesForLevel(patches: AppliedPathologyPatch[], level: string): AppliedPathologyPatch[] {
  const want = level.toUpperCase();
  return patches.filter((p) => {
    const lvl = (p.observation?.level ?? p.ownership.anatomicalSection ?? "").toUpperCase();
    return lvl === want || lvl.includes(want) || (p.lastRendered.findings ?? "").toUpperCase().includes(want);
  });
}

export function MriLumbarLevelBlock({
  region,
  patches,
  disabled,
  onApply,
  onFocus,
}: {
  region: MriLumbarRegionDef;
  patches: AppliedPathologyPatch[];
  disabled?: boolean;
  onApply: (sel: LumbarLevelSelection, composed: ReturnType<typeof composeLumbarLevelNarrative>) => void;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<LumbarLevelSelection>({});
  const levelPatches = useMemo(() => patchesForLevel(patches, region.label), [patches, region.label]);
  const preview = useMemo(() => composeLumbarLevelNarrative(region.label, sel), [region.label, sel]);
  const summary = levelPatches[0];

  if (region.kind !== "disc-level") {
    return (
      <div
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5"
        data-testid={`mri-region-${region.key}`}
        onFocus={onFocus}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-slate-800">{region.label}</span>
          <span className="text-[9px] text-muted-foreground">
            {levelPatches.length > 0 ? `${levelPatches.length} obs` : "Open — free text / QS"}
          </span>
        </div>
        {summary?.lastRendered.findings ? (
          <p className="mt-1 text-[10px] text-slate-700 line-clamp-2">{summary.lastRendered.findings}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-amber-200/80 bg-gradient-to-br from-amber-50/40 to-white px-2 py-1.5"
      data-testid={`mri-level-${region.key}`}
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
        <span className="text-[9px] text-amber-800/80">
          {summary
            ? [
                summary.observation?.concept,
                summary.observation?.laterality,
                summary.observation?.severity,
              ].filter(Boolean).join(" · ") || "Active"
            : "Empty"}
        </span>
      </button>
      {summary?.lastRendered.findings ? (
        <p className="mt-1 text-[10px] leading-snug text-slate-800 line-clamp-3">
          {summary.lastRendered.findings}
        </p>
      ) : null}
      {summary?.observation?.anchor ? (
        <div className="mt-0.5 text-[8px] font-mono text-sky-800">
          {formatAnchorChip(summary.observation.anchor)}
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
              onChange={(e) => setSel((s) => ({ ...s, rootContact: e.target.checked }))}
            />
            Root contact
          </label>
          <div className="rounded border border-dashed border-amber-200 bg-white/80 p-1.5">
            <div className="text-[8px] font-bold uppercase text-amber-800">Composed</div>
            <p className="text-[10px] text-slate-800" data-testid={`mri-level-preview-${region.key}`}>
              {preview.findings}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || !sel.morphology}
            className="h-7 rounded-md bg-amber-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
            onClick={() => onApply(sel, preview)}
            data-testid={`mri-level-apply-${region.key}`}
          >
            Apply to report
          </button>
        </div>
      ) : null}
    </div>
  );
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
