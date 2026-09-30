/**
 * MriBrainVascularForms.tsx — the structured vascular objects (§6 aneurysm, §7/§11
 * stenosis and dissection, §8 moyamoya, §9 AVM, §12/§13 venous thrombosis).
 *
 * Every form is the same shape: local React state for the FIELDS ONLY, a call into the
 * matching library builder, and one `applyMacroBundle` of the atoms it returns. The form
 * never holds an observation, never assembles Findings or Impression text, and never
 * re-implements a gate — §3 and §25 forbid a parallel vascular state, and §22 asks for the
 * measurement fields to sit beside the lesion they describe.
 *
 * Three things are deliberately absent, because the library refuses them and the UI must
 * not be more generous than the model: a dome-to-neck ratio is shown as calculated and is
 * never an input (§6); a stenosis percentage is shown as calculated and only the radiologist
 * can override it (§7, §11); and Moyamoya disease / thrombosis / dissection as a conclusion
 * are checkboxes the radiologist selects, never consequences of what was typed (§8, §11,
 * §13).
 */

import { useMemo, useState } from "react";
import { useWorkspace, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { brainAtomsToPatches } from "@/lib/mriBrainAtoms";
import { VASCULAR_TREE_NORMALS, type VascularTreeModule } from "@/lib/mriBrainVascularSubMasters";
import {
  VESSEL_DEFINITIONS,
  isAneurysmCapableVessel,
  type VesselDefinition,
} from "@/lib/mriBrainVessels";
import type { VascularLesionResult } from "@/lib/mriBrainVascularLesions";
import {
  ANEURYSM_MORPHOLOGIES,
  ANEURYSM_RUPTURE_STATUSES,
  AVM_DRAINAGE_PATTERNS,
  AVM_GRADING_NOTICE,
  AVM_SPETZLER_MARTIN_GRADES,
  MOYAMOYA_SIDES,
  aneurysmAtoms,
  aneurysmDomeNeckRatio,
  avmAtoms,
  moyamoyaAtoms,
  type AneurysmRecord,
  type AvmDrainagePattern,
  type AvmRecord,
  type MoyamoyaPatternRecord,
  type MoyamoyaSide,
  type SpetzlerMartinGrade,
} from "@/lib/mriBrainVascularLesions";
import {
  DISSECTION_CORRELATIONS,
  DISSECTION_STAGES,
  STENOSIS_DESCRIPTORS,
  STENOSIS_FORMULAS,
  STENOSIS_PROVENANCE_SOURCES,
  carotidDissectionAtoms,
  measuredStenosisAtoms,
  nascetPercent,
  type CarotidDissectionRecord,
  type DissectionCorrelation,
  type DissectionStage,
  type MeasuredStenosisRecord,
  type StenosisDescriptor,
  type StenosisFormula,
  type StenosisProvenanceSource,
} from "@/lib/mriBrainVascularStenosis";
import {
  THROMBOSIS_OCCLUSION,
  THROMBOSIS_STAGES,
  venousThrombosisAtoms,
  type CvstRecord,
  type ThrombosisOcclusion,
  type ThrombosisStage,
} from "@/lib/mriBrainVascularThrombosis";
import type { Assessable, VascularLesionContext } from "@/lib/mriBrainVascularLesions";

const FIELD = "h-6 w-full rounded border border-slate-300 bg-white px-1 text-[10px]";
const SMALL = "h-6 rounded border border-slate-300 bg-white px-1 text-[9px]";

/**
 * §5/§17: a named abnormality cannot sit under a sentence that denies one. This reports the
 * all-normal baseline the LEDGER currently carries for a module, so a form supersedes that
 * sentence instead of contradicting it — and says nothing about a normal the report never
 * asserted. The decision stays with the report, not the form, which is why nothing here is
 * derived from the booking or the technique (§2).
 */
function useVascularNormalSupersession() {
  const patches = useWorkspace((s: WorkspaceStore) => s.appliedPathologyPatches);
  return useMemo(() => {
    const carried = new Set(
      patches
        .filter((p) => p.observation && !p.stale)
        .map((p) => `${p.observation?.concept}\u0000${(p.lastRendered.findings ?? "").trim()}`),
    );
    return (module: VascularTreeModule) => {
      const spec = VASCULAR_TREE_NORMALS[module];
      // The sentence, not just the slot: once an abnormality has superseded the baseline,
      // the remainder normal occupies the same family concept and must not be superseded
      // a second time.
      return carried.has(`${spec.concept}\u0000${spec.sentence.trim()}`)
        ? { replaceTreeNormal: spec.sentence, remainderNormal: spec.remainder }
        : {};
    };
  }, [patches]);
}

// ─── shared field primitives ─────────────────────────────────────────────

function Txt({
  label,
  value,
  onChange,
  disabled,
  testid,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testid: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[8px] uppercase tracking-wide text-slate-500">
      {label}
      <input
        className={FIELD}
        data-testid={testid}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  disabled,
  testid,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testid: string;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[8px] uppercase tracking-wide text-slate-500">
      {label}
      <span className="flex items-center gap-1">
        <input
          className={FIELD}
          data-testid={testid}
          disabled={disabled}
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix ? <span className="text-[8px] text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Pick<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  testid,
}: {
  label: string;
  value: string;
  options: Array<{ value: T; label: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[8px] uppercase tracking-wide text-slate-500">
      {label}
      <select
        className={FIELD}
        data-testid={testid}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A yes / no statement the radiologist answers, or leaves unanswered. */
function Flag({
  label,
  checked,
  onChange,
  disabled,
  testid,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <label
      className="flex items-center gap-1 text-[9px] text-slate-800"
      data-testid={testid}
      title={label}
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

const ASSESSABLE_OPTIONS = [
  { value: "present", label: "present" },
  { value: "absent", label: "absent" },
];

/** The three-state answer §6/§12/§13 need: stated, excluded, or not assessed. */
function Assess({
  label,
  value,
  onChange,
  disabled,
  testid,
}: {
  label: string;
  value: Assessable;
  onChange: (v: Assessable) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[8px] text-slate-600">{label}</span>
      {ASSESSABLE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          data-testid={`${testid}-${o.value}`}
          onClick={() => onChange(value === o.value ? "" : (o.value as Assessable))}
          className={[
            "rounded border px-1 py-0.5 text-[8px]",
            value === o.value
              ? "border-sky-600 bg-sky-600 text-white"
              : "border-slate-300 bg-white text-slate-700",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

// ─── shared apply / remove bar ───────────────────────────────────────────

function ApplyBar({
  region,
  result,
  disabled,
  testid,
  notice,
}: {
  region: string;
  result: VascularLesionResult;
  disabled?: boolean;
  testid: string;
  notice?: string;
}) {
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const active =
    !!result.bundleId && patches.some((p) => !p.stale && p.observation?.bundleId === result.bundleId);

  const apply = () => {
    if (disabled || !result.atoms.length || result.errors?.length) return;
    useWorkspace.getState().applyMacroBundle({
      bundleId: result.bundleId,
      observations: brainAtomsToPatches(region, result.bundleId, result.atoms),
    });
  };

  return (
    <div className="space-y-1" data-testid={testid}>
      {result.errors?.length ? (
        <p className="text-[8px] text-rose-700" data-testid={`${testid}-error`}>
          {result.errors.join(" ")}
        </p>
      ) : null}
      {result.blocked ? (
        <p className="text-[8px] text-amber-700" data-testid={`${testid}-blocked`}>
          {result.blocked.notice}
        </p>
      ) : null}
      {result.warnings?.length ? (
        <ul className="text-[8px] text-amber-700" data-testid={`${testid}-warnings`}>
          {result.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="text-[8px] text-slate-500">{notice}</p> : null}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || !result.atoms.length || Boolean(result.errors?.length)}
          onClick={apply}
          data-testid={`${testid}-apply`}
          className="h-6 rounded bg-sky-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
        >
          {active ? "Update in report" : "Add to report"}
        </button>
        {active ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => useWorkspace.getState().removeMacroBundle(result.bundleId)}
            data-testid={`${testid}-remove`}
            className="h-6 rounded border border-slate-300 bg-white px-2 text-[9px] text-slate-700"
          >
            Remove from report
          </button>
        ) : null}
        <span className="text-[8px] text-slate-500">
          {result.atoms.length} editable observation(s) — the form holds nothing the ledger
          does not.
        </span>
      </div>
    </div>
  );
}

/** Vessel selects come from the registry, so a row cannot name an invented structure. */
function vesselChoices(keep: (v: VesselDefinition) => boolean) {
  return VESSEL_DEFINITIONS.filter(keep).map((v) => ({ value: v.key, label: v.label }));
}

/**
 * The side and arterial territory a chosen registry key carries, so the record names one
 * structure unambiguously instead of relying on the builder to guess from words.
 */
function sidesOf(key: string): {
  side: "right" | "left" | "";
  territory?: "intracranialArterial" | "neckArterial";
} {
  const vessel = VESSEL_DEFINITIONS.find((v) => v.key === key);
  return {
    side: vessel && vessel.side !== "unpaired" ? vessel.side : "",
    territory:
      vessel && vessel.territory !== "venous" ? vessel.territory : undefined,
  };
}

function asNumber(value: string): number | "" {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return "";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : "";
}

function listFrom(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── §6 aneurysm ─────────────────────────────────────────────────────────

const emptyAneurysm = (): AneurysmRecord => ({ parentVessel: "", side: "" });

export function VascularAneurysmForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [records, setRecords] = useState<AneurysmRecord[]>([emptyAneurysm()]);

  const patch = (index: number, over: Partial<AneurysmRecord>) =>
    setRecords((prev) => prev.map((r, i) => (i === index ? { ...r, ...over } : r)));

  // §6: one or multiple aneurysms, each on its own parent vessel's slot.
  const result = useMemo(
    () => aneurysmAtoms(records.filter((r) => r.parentVessel.trim()), ctx),
    [records, ctx],
  );

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1.5"
      data-testid="vascular-aneurysm-form"
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-sky-900">
          Aneurysm — §6 structured record
        </span>
        <button
          type="button"
          disabled={disabled}
          data-testid="vascular-aneurysm-add"
          onClick={() => setRecords((prev) => [...prev, emptyAneurysm()])}
          className={SMALL}
        >
          + another aneurysm
        </button>
      </div>

      {records.map((record, index) => {
        const ratio = aneurysmDomeNeckRatio(record);
        return (
          <div key={index} className="space-y-1 border-t border-sky-100 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-bold uppercase text-slate-500">
                Aneurysm {index + 1}
              </span>
              {records.length > 1 ? (
                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`vascular-aneurysm-drop-${index}`}
                  onClick={() => setRecords((prev) => prev.filter((_, i) => i !== index))}
                  className="text-[8px] text-rose-700 underline"
                >
                  clear this record
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-1">
              <Pick
                label="Parent vessel"
                testid={`vascular-aneurysm-vessel-${index}`}
                disabled={disabled}
                value={record.parentVessel}
                options={vesselChoices(isAneurysmCapableVessel)}
                onChange={(v) => patch(index, { parentVessel: v, ...sidesOf(v) })}
              />
              <Txt
                label="Segment / junction"
                testid={`vascular-aneurysm-segment-${index}`}
                disabled={disabled}
                value={record.segment ?? ""}
                onChange={(v) => patch(index, { segment: v })}
              />
              <Pick
                label="Morphology"
                testid={`vascular-aneurysm-morphology-${index}`}
                disabled={disabled}
                value={record.morphology ?? ""}
                options={ANEURYSM_MORPHOLOGIES.map((m) => ({ value: m, label: m }))}
                onChange={(v) => patch(index, { morphology: v as AneurysmRecord["morphology"] })}
              />
              <Num
                label="Dome height"
                suffix="mm"
                testid={`vascular-aneurysm-dome-${index}`}
                disabled={disabled}
                value={String(record.domeHeightMm ?? "")}
                onChange={(v) => patch(index, { domeHeightMm: asNumber(v) })}
              />
              <Num
                label="Max width"
                suffix="mm"
                testid={`vascular-aneurysm-width-${index}`}
                disabled={disabled}
                value={String(record.maxWidthMm ?? "")}
                onChange={(v) => patch(index, { maxWidthMm: asNumber(v) })}
              />
              <Num
                label="Neck width"
                suffix="mm"
                testid={`vascular-aneurysm-neck-${index}`}
                disabled={disabled}
                value={String(record.neckWidthMm ?? "")}
                onChange={(v) => patch(index, { neckWidthMm: asNumber(v) })}
              />
              <Pick
                label="Rupture (selected, never inferred)"
                testid={`vascular-aneurysm-rupture-${index}`}
                disabled={disabled}
                value={record.ruptureStatus ?? ""}
                options={ANEURYSM_RUPTURE_STATUSES.map((s) => ({ value: s, label: s }))}
                onChange={(v) =>
                  patch(index, { ruptureStatus: v as AneurysmRecord["ruptureStatus"] })
                }
              />
              <Txt
                label="Orientation"
                testid={`vascular-aneurysm-orientation-${index}`}
                disabled={disabled}
                value={record.orientation ?? ""}
                onChange={(v) => patch(index, { orientation: v })}
              />
              <span className="flex flex-col justify-end text-[8px] text-slate-600">
                Dome-to-neck ratio
                <span className="font-semibold" data-testid={`vascular-aneurysm-ratio-${index}`}>
                  {ratio ?? "needs dome and neck"}
                </span>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Assess
                label="Branch at neck"
                testid={`vascular-aneurysm-branch-${index}`}
                disabled={disabled}
                value={record.branchIncorporation ?? ""}
                onChange={(v) => patch(index, { branchIncorporation: v })}
              />
              <Flag
                label="Daughter sac"
                testid={`vascular-aneurysm-daughter-${index}`}
                disabled={disabled}
                checked={Boolean(record.daughterSac)}
                onChange={(v) => patch(index, { daughterSac: v })}
              />
              <Assess
                label="Intrinsic thrombus"
                testid={`vascular-aneurysm-thrombus-${index}`}
                disabled={disabled}
                value={record.thrombus ?? ""}
                onChange={(v) => patch(index, { thrombus: v })}
              />
              <Assess
                label="Mass effect"
                testid={`vascular-aneurysm-mass-${index}`}
                disabled={disabled}
                value={record.massEffect ?? ""}
                onChange={(v) => patch(index, { massEffect: v })}
              />
              <Assess
                label="Associated haemorrhage"
                testid={`vascular-aneurysm-hemorrhage-${index}`}
                disabled={disabled}
                value={record.associatedHemorrhage ?? ""}
                onChange={(v) => patch(index, { associatedHemorrhage: v })}
              />
            </div>
            <Txt
              label="Additional note"
              testid={`vascular-aneurysm-note-${index}`}
              disabled={disabled}
              value={record.manualNote ?? ""}
              onChange={(v) => patch(index, { manualNote: v })}
            />
          </div>
        );
      })}

      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-aneurysm-bar"
        notice="The ratio is calculated from the dome and neck that were entered; it is not a field (§6)."
      />
    </div>
  );
}

// ─── §7 / §11 measured stenosis ──────────────────────────────────────────

export function VascularStenosisForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [record, setRecord] = useState<MeasuredStenosisRecord>({
    vessel: "",
    side: "",
    territory: "neckArterial",
    formula: "nascet",
  });
  const [provenanceSource, setProvenanceSource] = useState("");
  const [annotationIds, setAnnotationIds] = useState("");
  const [provenanceDetail, setProvenanceDetail] = useState("");
  const patch = (over: Partial<MeasuredStenosisRecord>) => setRecord((r) => ({ ...r, ...over }));

  const calculated = nascetPercent(record.minResidualLumenMm, record.referenceLumenMm);
  const result = useMemo(
    () =>
      measuredStenosisAtoms(
        {
          ...record,
          provenance: provenanceSource
            ? {
                source: provenanceSource as StenosisProvenanceSource,
                annotationIds: listFrom(annotationIds),
                detail: provenanceDetail,
              }
            : undefined,
        },
        ctx,
      ),
    [record, provenanceSource, annotationIds, provenanceDetail, ctx],
  );

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1"
      data-testid="vascular-stenosis-form"
    >
      <span className="text-[9px] font-bold uppercase text-sky-900">
        Stenosis — §7 / §11 measured record
      </span>
      <div className="grid grid-cols-3 gap-1">
        <Pick
          label="Vessel"
          testid="vascular-stenosis-vessel"
          disabled={disabled}
          value={record.vessel}
          options={vesselChoices((v) => v.territory !== "venous")}
          onChange={(v) => patch({ vessel: v, ...sidesOf(v) })}
        />
        <Pick
          label="Formula"
          testid="vascular-stenosis-formula"
          disabled={disabled}
          value={record.formula}
          options={STENOSIS_FORMULAS.map((f) => ({ value: f, label: f }))}
          onChange={(v) => patch({ formula: v as StenosisFormula })}
        />
        <Pick
          label="Descriptor (your word, not a translation)"
          testid="vascular-stenosis-descriptor"
          disabled={disabled}
          value={record.descriptor ?? ""}
          options={STENOSIS_DESCRIPTORS.map((d) => ({ value: d, label: d }))}
          onChange={(v) => patch({ descriptor: v as StenosisDescriptor })}
        />
        <Num
          label="Minimum residual lumen"
          suffix="mm"
          testid="vascular-stenosis-residual"
          disabled={disabled}
          value={String(record.minResidualLumenMm ?? "")}
          onChange={(v) => patch({ minResidualLumenMm: asNumber(v) })}
        />
        <Num
          label="Distal normal reference"
          suffix="mm"
          testid="vascular-stenosis-reference"
          disabled={disabled}
          value={String(record.referenceLumenMm ?? "")}
          onChange={(v) => patch({ referenceLumenMm: asNumber(v) })}
        />
        <span className="flex flex-col justify-end text-[8px] text-slate-600">
          NASCET from those two
          <span className="font-semibold" data-testid="vascular-stenosis-calculated">
            {calculated == null ? "needs both diameters" : `${calculated}%`}
          </span>
        </span>
        <Num
          label="Stated percentage (override)"
          suffix="%"
          testid="vascular-stenosis-percent"
          disabled={disabled}
          value={String(record.percent ?? "")}
          onChange={(v) => patch({ percent: asNumber(v), manualOverride: Boolean(String(v)) })}
        />
        <Txt
          label="Override reason"
          testid="vascular-stenosis-override-reason"
          disabled={disabled}
          value={record.overrideReason ?? ""}
          onChange={(v) => patch({ overrideReason: v })}
        />
        <Pick
          label="Measurement source (provenance)"
          testid="vascular-stenosis-provenance"
          disabled={disabled}
          value={provenanceSource}
          options={STENOSIS_PROVENANCE_SOURCES.map((s) => ({ value: s, label: s }))}
          onChange={setProvenanceSource}
        />
        <Txt
          label="Viewer annotation ids"
          testid="vascular-stenosis-annotations"
          disabled={disabled}
          value={annotationIds}
          onChange={setAnnotationIds}
        />
        <Txt
          label="Series / external study"
          testid="vascular-stenosis-provenance-detail"
          disabled={disabled}
          value={provenanceDetail}
          onChange={setProvenanceDetail}
        />
        <Assess
          label="Ulceration"
          testid="vascular-stenosis-ulceration"
          disabled={disabled}
          value={record.ulceration ?? ""}
          onChange={(v) => patch({ ulceration: v })}
        />
      </div>
      <Txt
        label="Plaque description"
        testid="vascular-stenosis-plaque"
        disabled={disabled}
        value={record.plaqueDescription ?? ""}
        onChange={(v) => patch({ plaqueDescription: v })}
      />
      <Txt
        label="Additional note"
        testid="vascular-stenosis-note"
        disabled={disabled}
        value={record.manualNote ?? ""}
        onChange={(v) => patch({ manualNote: v })}
      />
      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-stenosis-bar"
        notice="A percentage needs a lumen-bearing acquisition and a stated source; an override needs its reason (§7, §11)."
      />
    </div>
  );
}

// ─── §11 carotid / vertebral dissection ──────────────────────────────────

export function VascularDissectionForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [record, setRecord] = useState<CarotidDissectionRecord>({
    vessel: "",
    side: "",
    territory: "neckArterial",
  });
  const patch = (over: Partial<CarotidDissectionRecord>) => setRecord((r) => ({ ...r, ...over }));
  const result = useMemo(() => carotidDissectionAtoms(record, ctx), [record, ctx]);

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1"
      data-testid="vascular-dissection-form"
    >
      <span className="text-[9px] font-bold uppercase text-sky-900">
        Dissection — §11 appearance and conclusion kept apart
      </span>
      <div className="grid grid-cols-3 gap-1">
        <Pick
          label="Vessel"
          testid="vascular-dissection-vessel"
          disabled={disabled}
          value={record.vessel}
          options={vesselChoices((v) => v.territory !== "venous")}
          onChange={(v) => patch({ vessel: v, ...sidesOf(v) })}
        />
        <Assess
          label="Intramural haematoma"
          testid="vascular-dissection-hematoma"
          disabled={disabled}
          value={record.intramuralHematoma ?? ""}
          onChange={(v) => patch({ intramuralHematoma: v })}
        />
        <Assess
          label="Intimal flap"
          testid="vascular-dissection-flap"
          disabled={disabled}
          value={record.intimalFlap ?? ""}
          onChange={(v) => patch({ intimalFlap: v })}
        />
        <Txt
          label="Haematoma extent"
          testid="vascular-dissection-extent"
          disabled={disabled}
          value={record.hematomaExtent ?? ""}
          onChange={(v) => patch({ hematomaExtent: v })}
        />
        <Txt
          label="Luminal change"
          testid="vascular-dissection-luminal"
          disabled={disabled}
          value={record.luminalChange ?? ""}
          onChange={(v) => patch({ luminalChange: v })}
        />
        <Pick
          label="Stage (selected)"
          testid="vascular-dissection-stage"
          disabled={disabled}
          value={record.stage ?? ""}
          options={DISSECTION_STAGES.map((s) => ({ value: s, label: s }))}
          onChange={(v) => patch({ stage: v as DissectionStage })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Flag
          label="Diagnosed as dissection by the radiologist"
          testid="vascular-dissection-selected"
          disabled={disabled}
          checked={Boolean(record.dissectionSelected)}
          onChange={(v) => patch({ dissectionSelected: v })}
        />
        <Flag
          label="Pseudoaneurysm"
          testid="vascular-dissection-pseudoaneurysm"
          disabled={disabled}
          checked={Boolean(record.pseudoaneurysm)}
          onChange={(v) => patch({ pseudoaneurysm: v })}
        />
      </div>
      <Pick
        label="Correlation recommended"
        testid="vascular-dissection-correlation"
        disabled={disabled}
        value={record.correlationRecommendation ?? ""}
        options={DISSECTION_CORRELATIONS.map((c) => ({ value: c, label: c }))}
        onChange={(v) => patch({ correlationRecommendation: v as DissectionCorrelation })}
      />
      <Txt
        label="Additional note"
        testid="vascular-dissection-note"
        disabled={disabled}
        value={record.manualNote ?? ""}
        onChange={(v) => patch({ manualNote: v })}
      />
      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-dissection-bar"
        notice="A T1 crescent is described; the word dissection, and its acuity, arrive only when you select them (§11)."
      />
    </div>
  );
}

// ─── §8 moyamoya pattern / disease ───────────────────────────────────────

export function VascularMoyamoyaForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [record, setRecord] = useState<MoyamoyaPatternRecord>({});
  const patch = (over: Partial<MoyamoyaPatternRecord>) => setRecord((r) => ({ ...r, ...over }));
  const result = useMemo(() => moyamoyaAtoms(record, ctx), [record, ctx]);
  const sideOptions = MOYAMOYA_SIDES.map((s) => ({ value: s, label: s }));

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1"
      data-testid="vascular-moyamoya-form"
    >
      <span className="text-[9px] font-bold uppercase text-sky-900">
        Moyamoya pattern — §8
      </span>
      <div className="grid grid-cols-3 gap-1">
        <Pick
          label="Terminal ICA narrowing"
          testid="vascular-moyamoya-ica"
          disabled={disabled}
          value={record.terminalIcaNarrowing ?? ""}
          options={sideOptions}
          onChange={(v) => patch({ terminalIcaNarrowing: v as MoyamoyaSide })}
        />
        <Pick
          label="Proximal ACA involvement"
          testid="vascular-moyamoya-aca"
          disabled={disabled}
          value={record.proximalAcaInvolvement ?? ""}
          options={sideOptions}
          onChange={(v) => patch({ proximalAcaInvolvement: v as MoyamoyaSide })}
        />
        <Pick
          label="Proximal MCA involvement"
          testid="vascular-moyamoya-mca"
          disabled={disabled}
          value={record.proximalMcaInvolvement ?? ""}
          options={sideOptions}
          onChange={(v) => patch({ proximalMcaInvolvement: v as MoyamoyaSide })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Flag
          label="Basal / lenticulostriate collateral network"
          testid="vascular-moyamoya-collaterals"
          disabled={disabled}
          checked={Boolean(record.basalCollateralNetwork)}
          onChange={(v) => patch({ basalCollateralNetwork: v })}
        />
        <Flag
          label="Asymmetric"
          testid="vascular-moyamoya-asymmetric"
          disabled={disabled}
          checked={Boolean(record.asymmetric)}
          onChange={(v) => patch({ asymmetric: v })}
        />
        <Flag
          label="Ischaemic findings"
          testid="vascular-moyamoya-ischemic"
          disabled={disabled}
          checked={Boolean(record.ischemicFindings)}
          onChange={(v) => patch({ ischemicFindings: v })}
        />
        <Flag
          label="Haemorrhagic findings"
          testid="vascular-moyamoya-hemorrhagic"
          disabled={disabled}
          checked={Boolean(record.hemorrhagicFindings)}
          onChange={(v) => patch({ hemorrhagicFindings: v })}
        />
        <Flag
          label="Classified as Moyamoya DISEASE by the radiologist"
          testid="vascular-moyamoya-disease"
          disabled={disabled}
          checked={Boolean(record.diseaseClassification)}
          onChange={(v) => patch({ diseaseClassification: v })}
        />
      </div>
      <Txt
        label="Additional note"
        testid="vascular-moyamoya-note"
        disabled={disabled}
        value={record.manualNote ?? ""}
        onChange={(v) => patch({ manualNote: v })}
      />
      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-moyamoya-bar"
        notice="The pattern and the disease are different observations. Selecting the pattern never produces the diagnosis (§8)."
      />
    </div>
  );
}

// ─── §9 AVM ──────────────────────────────────────────────────────────────

export function VascularAvmForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [record, setRecord] = useState<AvmRecord>({ location: "" });
  const [feeders, setFeeders] = useState("");
  const patch = (over: Partial<AvmRecord>) => setRecord((r) => ({ ...r, ...over }));
  const result = useMemo(
    () => avmAtoms({ ...record, arterialFeeders: listFrom(feeders) }, ctx),
    [record, feeders, ctx],
  );

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1"
      data-testid="vascular-avm-form"
    >
      <span className="text-[9px] font-bold uppercase text-sky-900">
        Arteriovenous malformation — §9
      </span>
      <div className="grid grid-cols-3 gap-1">
        <Txt
          label="Location / lobe"
          testid="vascular-avm-location"
          disabled={disabled}
          value={record.location}
          onChange={(v) => patch({ location: v })}
        />
        <Pick
          label="Drainage pattern"
          testid="vascular-avm-drainage-pattern"
          disabled={disabled}
          value={record.drainagePattern ?? ""}
          options={AVM_DRAINAGE_PATTERNS.map((p) => ({ value: p, label: p }))}
          onChange={(v) => patch({ drainagePattern: v as AvmDrainagePattern })}
        />
        <Txt
          label="Venous drainage (words)"
          testid="vascular-avm-drainage"
          disabled={disabled}
          value={record.venousDrainage ?? ""}
          onChange={(v) => patch({ venousDrainage: v })}
        />
        <Num
          label="Nidus A-P"
          suffix="cm"
          testid="vascular-avm-ap"
          disabled={disabled}
          value={String(record.nidusApCm ?? "")}
          onChange={(v) => patch({ nidusApCm: asNumber(v) })}
        />
        <Num
          label="Nidus transverse"
          suffix="cm"
          testid="vascular-avm-transverse"
          disabled={disabled}
          value={String(record.nidusTransverseCm ?? "")}
          onChange={(v) => patch({ nidusTransverseCm: asNumber(v) })}
        />
        <Num
          label="Nidus CC"
          suffix="cm"
          testid="vascular-avm-cc"
          disabled={disabled}
          value={String(record.nidusCcCm ?? "")}
          onChange={(v) => patch({ nidusCcCm: asNumber(v) })}
        />
        <Txt
          label="Arterial feeders (registry names, separated by commas)"
          testid="vascular-avm-feeders"
          disabled={disabled}
          value={feeders}
          onChange={setFeeders}
        />
        <Pick
          label="Spetzler–Martin grade (entered only)"
          testid="vascular-avm-grade"
          disabled={disabled}
          value={String(record.spetzlerMartinGrade ?? "")}
          options={AVM_SPETZLER_MARTIN_GRADES.map((g) => ({ value: g, label: `grade ${g}` }))}
          onChange={(v) => patch({ spetzlerMartinGrade: (v ? Number(v) : "") as SpetzlerMartinGrade })}
        />
        <Flag
          label="Nidus present"
          testid="vascular-avm-nidus"
          disabled={disabled}
          checked={Boolean(record.nidusPresent)}
          onChange={(v) => patch({ nidusPresent: v })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Flag
          label="Early venous drainage"
          testid="vascular-avm-early-drainage"
          disabled={disabled}
          checked={Boolean(record.earlyVenousDrainage)}
          onChange={(v) => patch({ earlyVenousDrainage: v })}
        />
        <Flag
          label="Deep drainage assessable"
          testid="vascular-avm-deep-assessable"
          disabled={disabled}
          checked={Boolean(record.deepDrainageAssessable)}
          onChange={(v) => patch({ deepDrainageAssessable: v })}
        />
        <Flag
          label="Associated aneurysm"
          testid="vascular-avm-aneurysm"
          disabled={disabled}
          checked={Boolean(record.associatedAneurysm)}
          onChange={(v) => patch({ associatedAneurysm: v })}
        />
        <Flag
          label="Associated haemorrhage"
          testid="vascular-avm-hemorrhage"
          disabled={disabled}
          checked={Boolean(record.associatedHemorrhage)}
          onChange={(v) => patch({ associatedHemorrhage: v })}
        />
        <Flag
          label="Gliosis / oedema"
          testid="vascular-avm-gliosis"
          disabled={disabled}
          checked={Boolean(record.gliosisOrEdema)}
          onChange={(v) => patch({ gliosisOrEdema: v })}
        />
        <Flag
          label="Mass effect"
          testid="vascular-avm-mass"
          disabled={disabled}
          checked={Boolean(record.massEffect)}
          onChange={(v) => patch({ massEffect: v })}
        />
      </div>
      <Txt
        label="Additional note"
        testid="vascular-avm-note"
        disabled={disabled}
        value={record.manualNote ?? ""}
        onChange={(v) => patch({ manualNote: v })}
      />
      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-avm-bar"
        notice={AVM_GRADING_NOTICE}
      />
    </div>
  );
}

// ─── §12 / §13 venous thrombosis ─────────────────────────────────────────

export function VascularThrombosisForm({
  region = "Brain",
  ctx,
  disabled,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
}) {
  const [record, setRecord] = useState<CvstRecord>({ vein: "", side: "" });
  const [extension, setExtension] = useState("");
  const patch = (over: Partial<CvstRecord>) => setRecord((r) => ({ ...r, ...over }));
  const brain = record.brainFindings ?? {};
  const patchBrain = (over: Partial<typeof brain>) =>
    setRecord((r) => ({ ...r, brainFindings: { ...brain, ...over } }));

  const result = useMemo(
    () => venousThrombosisAtoms({ ...record, extension: listFrom(extension) }, ctx),
    [record, extension, ctx],
  );

  return (
    <div
      className="rounded border border-sky-200 bg-white/80 px-1.5 py-1 space-y-1"
      data-testid="vascular-thrombosis-form"
    >
      <span className="text-[9px] font-bold uppercase text-sky-900">
        Venous thrombosis — §12 / §13
      </span>
      <div className="grid grid-cols-3 gap-1">
        <Pick
          label="Sinus / vein"
          testid="vascular-thrombosis-vein"
          disabled={disabled}
          value={record.vein}
          options={vesselChoices((v) => v.territory === "venous")}
          onChange={(v) => patch({ vein: v, side: sidesOf(v).side })}
        />
        <Pick
          label="Occlusion"
          testid="vascular-thrombosis-occlusion"
          disabled={disabled}
          value={record.occlusion ?? ""}
          options={THROMBOSIS_OCCLUSION.map((o) => ({ value: o, label: o }))}
          onChange={(v) => patch({ occlusion: v as ThrombosisOcclusion })}
        />
        <Pick
          label="Stage (selected)"
          testid="vascular-thrombosis-stage"
          disabled={disabled}
          value={record.stage ?? ""}
          options={THROMBOSIS_STAGES.map((s) => ({ value: s, label: s }))}
          onChange={(v) => patch({ stage: v as ThrombosisStage })}
        />
        <Txt
          label="Extent"
          testid="vascular-thrombosis-extent"
          disabled={disabled}
          value={record.extent ?? ""}
          onChange={(v) => patch({ extent: v })}
        />
        <Txt
          label="Thrombus signal (against the sequences that show it)"
          testid="vascular-thrombosis-signal"
          disabled={disabled}
          value={record.thrombusSignal ?? ""}
          onChange={(v) => patch({ thrombusSignal: v })}
        />
        <Txt
          label="Extension into further venous structures"
          testid="vascular-thrombosis-extension"
          disabled={disabled}
          value={extension}
          onChange={setExtension}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Assess
          label="Filling defect"
          testid="vascular-thrombosis-filling"
          disabled={disabled}
          value={record.fillingDefect ?? ""}
          onChange={(v) => patch({ fillingDefect: v })}
        />
        <Assess
          label="Recanalization"
          testid="vascular-thrombosis-recanalization"
          disabled={disabled}
          value={record.recanalization ?? ""}
          onChange={(v) => patch({ recanalization: v })}
        />
        <Assess
          label="Collateralization"
          testid="vascular-thrombosis-collateral"
          disabled={disabled}
          value={record.collateralization ?? ""}
          onChange={(v) => patch({ collateralization: v })}
        />
        <Flag
          label="Thrombosis diagnosed by the radiologist"
          testid="vascular-thrombosis-selected"
          disabled={disabled}
          checked={Boolean(record.thrombosisSelected)}
          onChange={(v) => patch({ thrombosisSelected: v })}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-sky-100 pt-1">
        <Txt
          label="Parenchymal location"
          testid="vascular-thrombosis-brain-location"
          disabled={disabled}
          value={brain.location ?? ""}
          onChange={(v) => patchBrain({ location: v })}
        />
        <Num
          label="Midline shift"
          suffix="mm"
          testid="vascular-thrombosis-shift"
          disabled={disabled}
          value={String(brain.midlineShiftMm ?? "")}
          onChange={(v) => patchBrain({ midlineShiftMm: asNumber(v) })}
        />
        <Txt
          label="Shift towards"
          testid="vascular-thrombosis-shift-side"
          disabled={disabled}
          value={brain.midlineShiftSide ?? ""}
          onChange={(v) => patchBrain({ midlineShiftSide: v as typeof brain.midlineShiftSide })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Flag
          label="Oedema"
          testid="vascular-thrombosis-edema"
          disabled={disabled}
          checked={Boolean(brain.edema)}
          onChange={(v) => patchBrain({ edema: v })}
        />
        <Flag
          label="Venous infarction"
          testid="vascular-thrombosis-infarction"
          disabled={disabled}
          checked={Boolean(brain.venousInfarction)}
          onChange={(v) => patchBrain({ venousInfarction: v })}
        />
        <Flag
          label="Haemorrhagic venous infarction"
          testid="vascular-thrombosis-hemorrhagic"
          disabled={disabled}
          checked={Boolean(brain.hemorrhagicVenousInfarction)}
          onChange={(v) => patchBrain({ hemorrhagicVenousInfarction: v })}
        />
        <Flag
          label="Petechial haemorrhage"
          testid="vascular-thrombosis-petechial"
          disabled={disabled}
          checked={Boolean(brain.petechialHemorrhage)}
          onChange={(v) => patchBrain({ petechialHemorrhage: v })}
        />
        <Flag
          label="Mass effect"
          testid="vascular-thrombosis-mass"
          disabled={disabled}
          checked={Boolean(brain.massEffect)}
          onChange={(v) => patchBrain({ massEffect: v })}
        />
        <Flag
          label="Diffusion restriction"
          testid="vascular-thrombosis-diffusion"
          disabled={disabled}
          checked={Boolean(brain.diffusionRestriction)}
          onChange={(v) => patchBrain({ diffusionRestriction: v })}
        />
        <Flag
          label="Bilateral thalamic oedema (deep system)"
          testid="vascular-thrombosis-thalamic"
          disabled={disabled}
          checked={Boolean(brain.bilateralThalamicEdema)}
          onChange={(v) => patchBrain({ bilateralThalamicEdema: v })}
        />
      </div>
      <Txt
        label="Additional note"
        testid="vascular-thrombosis-note"
        disabled={disabled}
        value={record.manualNote ?? ""}
        onChange={(v) => patch({ manualNote: v })}
      />
      <ApplyBar
        region={region}
        result={result}
        disabled={disabled}
        testid="vascular-thrombosis-bar"
        notice="A flow gap, a filling defect or a clot signal is described; thrombosis as a conclusion is yours to select (§12, §13)."
      />
    </div>
  );
}

// ─── the panel that hosts them ───────────────────────────────────────────

export type VascularFormModule = "mra" | "mraNeck" | "mrv";

/**
 * Which structured object belongs to which dedicated module. A neck study does not get the
 * moyamoya / AVM forms and an MRV does not get a NASCET calculator — the palettes already
 * keep their prose apart, and the forms keep the workflows apart too (§22).
 */
const FORMS_BY_MODULE: Record<VascularFormModule, ReadonlyArray<readonly [string, string]>> = {
  mra: [
    ["aneurysm", "Aneurysm (§6)"],
    ["moyamoya", "Moyamoya pattern (§8)"],
    ["avm", "Arteriovenous malformation (§9)"],
    ["stenosis", "Measured stenosis (§7)"],
  ],
  mraNeck: [
    ["stenosis", "Measured stenosis / NASCET (§7, §11)"],
    ["dissection", "Dissection (§11)"],
    ["aneurysm", "Aneurysm (§6)"],
  ],
  mrv: [["thrombosis", "Venous thrombosis (§12, §13)"]],
};

/**
 * §22's expandable advanced details: one entry point per structured object, each openable
 * on its own so a dense study does not pay for the forms it is not using.
 */
export function MriBrainVascularForms({
  region = "Brain",
  ctx,
  disabled,
  open,
  onToggle,
  module,
}: {
  region?: string;
  ctx: VascularLesionContext;
  disabled?: boolean;
  open: Record<string, boolean>;
  onToggle: (formId: string) => void;
  module: VascularFormModule;
}) {
  const supersede = useVascularNormalSupersession();
  const lesionCtx = useMemo(
    () => ({ ...ctx, ...supersede(module) }),
    [ctx, module, supersede],
  );

  return (
    <div className="space-y-1" data-testid={`vascular-forms-${module}`}>
      <div className="flex flex-wrap gap-1">
        {FORMS_BY_MODULE[module].map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            data-testid={`vascular-form-open-${module}-${id}`}
            onClick={() => onToggle(id)}
            className={[
              SMALL,
              open[id] ? "border-sky-600 bg-sky-100 text-sky-900" : "bg-white text-slate-700",
            ].join(" ")}
          >
            {open[id] ? "▾ " : "▸ "}
            {label}
          </button>
        ))}
      </div>
      {open.aneurysm ? <VascularAneurysmForm region={region} ctx={lesionCtx} disabled={disabled} /> : null}
      {open.stenosis ? <VascularStenosisForm region={region} ctx={lesionCtx} disabled={disabled} /> : null}
      {open.dissection ? (
        <VascularDissectionForm region={region} ctx={lesionCtx} disabled={disabled} />
      ) : null}
      {open.moyamoya ? <VascularMoyamoyaForm region={region} ctx={lesionCtx} disabled={disabled} /> : null}
      {open.avm ? <VascularAvmForm region={region} ctx={lesionCtx} disabled={disabled} /> : null}
      {open.thrombosis ? (
        <VascularThrombosisForm region={region} ctx={lesionCtx} disabled={disabled} />
      ) : null}
    </div>
  );
}
