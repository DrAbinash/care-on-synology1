/**
 * Compact neuro-spine grading chip rows for MRI level editors.
 * Placed next to Canal AP — selection flows into level Apply bundles.
 */

import {
  CORD_SIGNAL_GRADES,
  MEYERDING_GRADES,
  MODIC_GRADES,
  PFIRRMANN_GRADES,
  type CordSignalGradeId,
  type MeyerdingGradeId,
  type ModicGradeId,
  type PfirrmannGradeId,
} from "@/lib/mriSpineGrading";

export type SpineNeuroGradingValue = {
  pfirrmann?: PfirrmannGradeId | null;
  modicGrade?: ModicGradeId | null;
  meyerding?: MeyerdingGradeId | null;
  cordSignal?: CordSignalGradeId | null;
};

export function SpineNeuroGradingControls({
  value,
  onChange,
  disabled,
  showCordSignal = true,
  testIdPrefix = "spine-grade",
}: {
  value: SpineNeuroGradingValue;
  onChange: (next: SpineNeuroGradingValue) => void;
  disabled?: boolean;
  /** Lumbar often omits cord; cervical/dorsal show it. */
  showCordSignal?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <div
      className="space-y-1 rounded border border-sky-100 bg-sky-50/40 px-1.5 py-1"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="text-[8px] font-bold uppercase tracking-wide text-sky-900">
        Neuro grades
      </div>
      <GradeChipRow
        label="Pfirr"
        options={PFIRRMANN_GRADES.map((o) => ({ id: o.id, label: o.label }))}
        value={value.pfirrmann ?? undefined}
        disabled={disabled}
        testId={`${testIdPrefix}-pfirrmann`}
        onChange={(id) =>
          onChange({
            ...value,
            pfirrmann: id === value.pfirrmann ? null : (id as PfirrmannGradeId),
          })
        }
      />
      <GradeChipRow
        label="Modic"
        options={MODIC_GRADES.map((o) => ({ id: o.id, label: o.label }))}
        value={value.modicGrade ?? undefined}
        disabled={disabled}
        testId={`${testIdPrefix}-modic`}
        onChange={(id) =>
          onChange({
            ...value,
            modicGrade: id === value.modicGrade ? null : (id as ModicGradeId),
          })
        }
      />
      <GradeChipRow
        label="Meyer"
        options={MEYERDING_GRADES.map((o) => ({ id: o.id, label: o.label }))}
        value={value.meyerding ?? undefined}
        disabled={disabled}
        testId={`${testIdPrefix}-meyerding`}
        onChange={(id) =>
          onChange({
            ...value,
            meyerding: id === value.meyerding ? null : (id as MeyerdingGradeId),
          })
        }
      />
      {showCordSignal ? (
        <GradeChipRow
          label="Cord"
          options={CORD_SIGNAL_GRADES.map((o) => ({
            id: o.id,
            label: o.id === "0" ? "0" : o.id === "1" ? "1 faint" : "2 bright",
          }))}
          value={value.cordSignal ?? undefined}
          disabled={disabled}
          testId={`${testIdPrefix}-cord`}
          onChange={(id) =>
            onChange({
              ...value,
              cordSignal: id === value.cordSignal ? null : (id as CordSignalGradeId),
            })
          }
        />
      ) : null}
    </div>
  );
}

function GradeChipRow({
  label,
  options,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={testId}>
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
              ? "border-sky-600 bg-sky-600 text-white"
              : "border-slate-200 bg-white text-slate-800 hover:border-sky-300",
          ].join(" ")}
          data-testid={testId ? `${testId}-${o.id}` : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
