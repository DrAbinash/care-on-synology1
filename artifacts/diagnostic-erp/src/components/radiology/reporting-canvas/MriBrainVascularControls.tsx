/**
 * MriBrainVascularControls.tsx — the two surfaces §22 asks for alongside the palettes:
 * the visible technique state, and the compact Basic Intracranial MRA Screening module.
 *
 * Both write through the ONE brain ledger. The technique panel edits `vascularTechnique`
 * (what was acquired); the screening module compiles a `ScreeningRecord` into ledger atoms
 * through `applyMacroBundle`. Neither keeps a copy of an observation, and neither touches
 * Findings or Impression directly (§3, §25).
 *
 * The technique panel is the authority every vascular tile is gated against, so it states
 * two things the spec is emphatic about: the booking never performs a sequence (§2), and a
 * manual answer is never overwritten by a later re-derivation from the Technique field (§4).
 */

import { useEffect, useMemo, useState } from "react";
import { useWorkspace, type WorkspaceStore } from "@/lib/zai-workspace/store";
import { BRAIN_NORMAL_SENTENCES } from "@/lib/mriBrainNormalAtoms";
import { parseBrainSequences } from "@/lib/mriBrainSequences";
import { brainAtomsToPatches, brainBundleId } from "@/lib/mriBrainAtoms";
import {
  VASCULAR_TECHNIQUE_KEYS,
  VASCULAR_TECHNIQUE_LABELS,
  deriveVascularTechniqueAcquired,
  resolveVascularTechnique,
  withDerivedVascularTechnique,
  type VascularTechniqueKey,
} from "@/lib/mriBrainVascularTechnique";
import {
  hasVascularContent,
  resolveVascularComposition,
  vascularCompositionSummary,
} from "@/lib/mriBrainVascularCatalog";
import {
  SCREENING_OBSERVATIONS,
  SCREENING_OBSERVATION_LABELS,
  screeningAtoms,
  screeningChecklistRows,
  type ScreeningObservation,
  type ScreeningRecord,
  type ScreeningRowKey,
} from "@/lib/mriBrainVascularScreening";

const FIELD = "h-6 rounded border border-slate-300 bg-white px-1 text-[10px]";

/**
 * Fold the recorded Technique field into the acquisition state without ever overwriting a
 * manual answer. This is the same fold the draft-restore path applies, so a reopened study
 * and a freshly typed technique line agree; it writes only when something actually changed,
 * so it cannot mark the draft dirty on every keystroke elsewhere.
 *
 * The brain canvas owns the single call: the acquisition state is what every vascular tile
 * and vascular form is gated against, so it has to be right whether or not a vascular panel
 * happens to be open (mra/mrv spec §2, §4).
 */
export function useVascularTechniqueFold(
  techniqueText: string,
  slice: Pick<WorkspaceStore, "reportingContext" | "vascularTechnique" | "setVascularTechnique">,
) {
  const { reportingContext, vascularTechnique, setVascularTechnique } = slice;
  useEffect(() => {
    const derived = deriveVascularTechniqueAcquired({
      techniqueText,
      studyDescription: reportingContext.studyDescription,
      reportTitle: reportingContext.region,
    });
    const next = withDerivedVascularTechnique(vascularTechnique, derived);
    if (JSON.stringify(next) !== JSON.stringify(vascularTechnique)) {
      setVascularTechnique(next);
    }
  }, [techniqueText, reportingContext, vascularTechnique, setVascularTechnique]);
}

/**
 * The visible acquisition state (§22). The chips are shown whenever MRI Brain is being
 * reported, because they are the reason a vascular tile is or is not clickable; the fuller
 * panel — composition, the designation note, the billing caveat — appears only when a
 * vascular surface is actually open, so routine reporting stays compact.
 */
export function MriBrainVascularTechniquePanel({
  disabled,
  edit,
}: {
  disabled?: boolean;
  edit?: boolean;
}) {
  const vascularTechnique = useWorkspace((s: WorkspaceStore) => s.vascularTechnique);
  const context = useWorkspace((s: WorkspaceStore) => s.reportingContext);

  const acquired = resolveVascularTechnique(vascularTechnique);
  const composition = useMemo(
    () =>
      resolveVascularComposition({
        name: context.region,
        studyDescription: context.studyDescription,
        modality: context.modality,
        region: context.region,
      }),
    [context],
  );

  return (
    <div
      className="rounded border border-sky-200 bg-sky-50/70 px-1.5 py-1 space-y-1"
      data-testid="vascular-technique-panel"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase tracking-wide text-sky-900">
          Vascular technique — what was acquired
        </span>
        {VASCULAR_TECHNIQUE_KEYS.map((key: VascularTechniqueKey) => {
          const statedByHand = vascularTechnique.manual[key] !== undefined;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              data-testid={`vascular-technique-${key}`}
              onClick={() =>
                useWorkspace.getState().setVascularTechniqueManual(key, !acquired[key])
              }
              title={
                statedByHand
                  ? "Stated by the radiologist — the Technique field no longer changes this. Click to change it."
                  : "Derived from the recorded Technique field. Click to state it by hand."
              }
              className={[
                "rounded border px-1 py-0.5 text-[8px] font-semibold",
                acquired[key]
                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                  : "border-slate-300 bg-white text-slate-400 line-through",
                statedByHand ? "ring-1 ring-sky-500" : "",
              ].join(" ")}
            >
              {VASCULAR_TECHNIQUE_LABELS[key]}
            </button>
          );
        })}
      </div>

      {edit ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[8px] text-slate-500" data-testid="vascular-composition-note">
              {vascularCompositionSummary(composition)}
            </span>
            <span className="text-[8px] text-slate-500">
              Ringed = stated by hand; the Technique field cannot change it (§4).
            </span>
          </div>

          <label className="flex items-center gap-1 text-[9px] text-slate-700">
            Other technique stated by the radiologist
            <input
              className={FIELD}
              data-testid="vascular-designation-note"
              disabled={disabled || !acquired.otherManual}
              value={vascularTechnique.designationNote ?? ""}
              onChange={(e) =>
                useWorkspace.getState().setVascularTechniqueDesignation(e.target.value)
              }
            />
          </label>

          <p className="text-[8px] text-slate-500" data-testid="vascular-technique-billing-note">
            {hasVascularContent(composition.roles)
              ? "Booked as a vascular study. The booking proposes a module; what was acquired is what carries the wording (§2)."
              : "No dedicated vascular module is booked for this study. Stating an acquisition here is what enables the dedicated wording — the billing label never does (§2)."}
          </p>
        </>
      ) : null}
    </div>
  );
}

// ─── §14 Basic intracranial MRA screening ────────────────────────────────

const SCREENING_BUNDLE = brainBundleId("mra-screening", "module");
const NO_OBSERVATION = "" as const;

/**
 * The compact arterial checklist: one finding per arterial family and side, the canonical
 * normal seed, and the limitation statement. Deliberately narrower than the dedicated
 * palettes — no aneurysm morphology, no dome/neck ratio, no NASCET, no angioarchitecture,
 * no vessel-wall or segment-by-segment grading (§14).
 */
export function MriBrainVascularScreening({
  region = "Brain",
  disabled,
}: {
  region?: string;
  disabled?: boolean;
}) {
  const techniqueText = useWorkspace((s: WorkspaceStore) => s.techniqueText);
  const findingsText = useWorkspace((s: WorkspaceStore) => s.findingsText);
  const vascularTechnique = useWorkspace((s: WorkspaceStore) => s.vascularTechnique);
  const patches = useWorkspace((s: WorkspaceStore) => s.appliedPathologyPatches);

  const seq = useMemo(() => parseBrainSequences(techniqueText), [techniqueText]);
  const rows = screeningChecklistRows();
  const [performed, setPerformed] = useState(seq.performed.mra);
  const [normalSeed, setNormalSeed] = useState(true);
  const [selected, setSelected] = useState<Record<string, ScreeningObservation>>({});
  const [otherNote, setOtherNote] = useState("");
  const [recommend, setRecommend] = useState(false);
  const [recommendationDetail, setRecommendationDetail] = useState("");
  const [manualNote, setManualNote] = useState("");

  const applied = patches.some((p) => !p.stale && p.observation?.bundleId === SCREENING_BUNDLE);

  const record: ScreeningRecord = useMemo(
    () => ({
      performed,
      normalSeedSelected: normalSeed,
      rows: Object.entries(selected).map(([key, observation]) => ({
        key: key as ScreeningRowKey,
        observation,
        note: observation === "otherSignificantAbnormality" ? otherNote : undefined,
      })),
      recommendDedicatedVascularEvaluation: recommend,
      recommendationDetail,
      manualNote,
    }),
    [performed, normalSeed, selected, otherNote, recommend, recommendationDetail, manualNote],
  );

  // §15: whichever arterial normal the report carries is the one the seed replaces. The
  // routine MRI Brain protocol normal and the dedicated §5 normal share the arterial
  // family slot, so a report carries one of the two wordings, never both.
  const carriedArterialNormal = useMemo(
    () => (findingsText.includes(BRAIN_NORMAL_SENTENCES.mra) ? BRAIN_NORMAL_SENTENCES.mra : undefined),
    [findingsText],
  );

  const built = useMemo(
    () =>
      screeningAtoms(record, {
        technique: vascularTechnique,
        brain: seq,
        replaceTreeNormal: carriedArterialNormal,
      }),
    [record, vascularTechnique, seq, carriedArterialNormal],
  );

  const choose = (rowKey: string, observation: ScreeningObservation | typeof NO_OBSERVATION) => {
    if (disabled || !performed) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (!observation) delete next[rowKey];
      else next[rowKey] = observation;
      return next;
    });
    // Any selected finding means the all-normal seed no longer describes the study; the
    // radiologist can still put it back, which is the point of an editable observation.
    if (observation && observation !== "grosslyPatent") setNormalSeed(false);
  };

  const apply = () => {
    if (disabled || !built.atoms.length) return;
    useWorkspace.getState().applyMacroBundle({
      bundleId: SCREENING_BUNDLE,
      observations: brainAtomsToPatches(region, SCREENING_BUNDLE, built.atoms),
    });
  };

  return (
    <div
      className="rounded border border-sky-200 bg-white/70 px-1.5 py-1 space-y-1"
      data-testid="mra-screening-section"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wide text-sky-900">
          Basic intracranial MRA screening
        </span>
        <label className="flex items-center gap-1 text-[9px] text-slate-700">
          <input
            type="checkbox"
            disabled={disabled}
            data-testid="mra-screening-performed"
            checked={performed}
            onChange={(e) => setPerformed(e.target.checked)}
          />
          limited angiographic acquisition performed
        </label>
      </div>

      {!performed ? (
        <p className="text-[8px] text-amber-700" data-testid="mra-screening-not-performed">
          Tick this only when the limited acquisition was actually performed. A booked
          screening protocol does not perform it (§2, §14).
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {rows.map((row) => (
          <label
            key={row.key}
            className="flex items-center gap-1 text-[9px] text-slate-800"
            data-testid={`mra-screening-row-${row.key}`}
          >
            <span className="w-[86px] shrink-0">{row.label}</span>
            <select
              className="h-5 flex-1 rounded border border-slate-300 bg-white text-[9px]"
              disabled={disabled || !performed}
              data-testid={`mra-screening-select-${row.key}`}
              value={selected[row.key] ?? NO_OBSERVATION}
              onChange={(e) =>
                choose(row.key, e.target.value as ScreeningObservation | typeof NO_OBSERVATION)
              }
            >
              <option value="">not assessed</option>
              {SCREENING_OBSERVATIONS.map((observation) => (
                <option key={observation} value={observation}>
                  {SCREENING_OBSERVATION_LABELS[observation]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {Object.values(selected).includes("otherSignificantAbnormality") ? (
        <label className="flex items-center gap-1 text-[9px] text-slate-700">
          What was seen
          <input
            className={FIELD}
            data-testid="mra-screening-other-note"
            disabled={disabled}
            value={otherNote}
            onChange={(e) => setOtherNote(e.target.value)}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[9px] text-slate-700">
          <input
            type="checkbox"
            disabled={disabled || !performed}
            data-testid="mra-screening-normal-seed"
            checked={normalSeed}
            onChange={(e) => setNormalSeed(e.target.checked)}
          />
          major intracranial arteries grossly patent (normal screening seed)
        </label>
        <label className="flex items-center gap-1 text-[9px] text-slate-700">
          <input
            type="checkbox"
            disabled={disabled}
            data-testid="mra-screening-recommend-dedicated"
            checked={recommend}
            onChange={(e) => setRecommend(e.target.checked)}
          />
          recommend dedicated vascular evaluation
        </label>
        {recommend ? (
          <input
            className={FIELD}
            data-testid="mra-screening-recommendation-detail"
            disabled={disabled}
            placeholder="for complete assessment of the suspected finding"
            value={recommendationDetail}
            onChange={(e) => setRecommendationDetail(e.target.value)}
          />
        ) : null}
      </div>

      <label className="flex items-center gap-1 text-[9px] text-slate-700">
        Additional screening note
        <input
          className={FIELD}
          data-testid="mra-screening-manual-note"
          disabled={disabled}
          value={manualNote}
          onChange={(e) => setManualNote(e.target.value)}
        />
      </label>

      {built.errors?.length ? (
        <p className="text-[8px] text-rose-700" data-testid="mra-screening-error">
          {built.errors.join(" ")}
        </p>
      ) : null}
      {built.blocked ? (
        <p className="text-[8px] text-amber-700" data-testid="mra-screening-blocked">
          {built.blocked.notice}
        </p>
      ) : null}

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || !built.atoms.length}
          onClick={apply}
          data-testid="mra-screening-apply"
          className="h-6 rounded bg-sky-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
        >
          {applied ? "Update screening" : "Add screening to report"}
        </button>
        {applied ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => useWorkspace.getState().removeMacroBundle(SCREENING_BUNDLE)}
            data-testid="mra-screening-remove"
            className="h-6 rounded border border-slate-300 bg-white px-2 text-[9px] text-slate-700"
          >
            Remove screening
          </button>
        ) : null}
        <span className="text-[8px] text-slate-500" data-testid="mra-screening-limitation-note">
          The limitation statement is written once, on its own slot, while screening
          contributes.
        </span>
      </div>
    </div>
  );
}
