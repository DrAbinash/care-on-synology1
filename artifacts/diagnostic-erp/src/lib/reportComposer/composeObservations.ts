/**
 * Adapter: derive `ComposeObservation[]` for the Background AI Report Composer
 * from the canonical workspace observation ledger.
 *
 * Canonical ledger = `appliedPathologyPatches` (the only authoritative runtime
 * observation store in CARE). Every producer of clinical observations —
 * Quick Select, Finding Composer, structured macros / Chocolate bundles,
 * MRI lumbar level canvas, pathology overlay, and committed Voice Composer
 * plans — writes into this ledger through `applyPathologyOverlay` /
 * `applyMacroBundle` / `applyComposerFinding` / `applyVoiceComposerPlan`.
 *
 * This module is a PURE adapter — it does NOT maintain a second observation
 * store. It only filters + projects the ledger into the smaller shape that
 * the composer API contract (`ComposeObservation`) expects.
 *
 * Reuse rules (no new semantics):
 *  - Stale patches (set by `reconcilePatchAgainstNarrative` on hydrate or by
 *    whole-report-format replacement) are excluded — they are no longer active.
 *  - Removed observations are already gone from the ledger by the time the
 *    composer runs (`applyPathologyOverlay` drops same-slot siblings when the
 *    survivor id is the incoming id; `removeMacroBundle` / `removeObservation`
 *    strip explicit rows). We do not re-implement that here.
 *  - Clinical-identity dedupe uses `canonicalObservationKey(obs)` defined in
 *    `reportComposer/types.ts` (region|concept|level|laterality) — the SAME
 *    canonical identity the client + server hash use. We do NOT maintain a
 *    parallel identity algorithm here. Legacy / unstructured rows fall back to
 *    normalized findings text so duplicate voice commits collapse, but two
 *    clinically distinct observations never collapse just because their text
 *    or concept matches.
 *  - `baselineReplaces` is NEVER used as the active findings text. It is
 *    baseline text that is being REPLACED by the active pathology — surfacing
 *    it as findingsText would feed Ollama the prior normal anatomy as the
 *    current pathology. See `patchToComposeObservation` for the safe lookup.
 *  - Voice observations are already members of `appliedPathologyPatches`
 *    (id `voice-*`, source `radiologist-voice`). The adapter renders them
 *    with `source: "voice"`. No separate voiceComposerObservations pass is
 *    needed in `useReportComposer`.
 */
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { CanonicalObservation } from "@/lib/observationSlot";
import type { InsertSource } from "@/lib/reportFieldMerge";
import type { ComposeObservation } from "./types";
import { canonicalObservationKey } from "./types";

/**
 * Map CARE's broad `InsertSource` union down to the smaller enum the composer
 * API contract allows. Anything that is not explicitly Quick Select / Quick
 * Findings / macro / voice / manual becomes `"structured"` so the contract
 * stays stable.
 */
export function mapInsertSourceToComposeSource(
  source: InsertSource | undefined,
): NonNullable<ComposeObservation["source"]> {
  switch (source) {
    case "quick-select":
      return "quick-select";
    case "quick-findings":
      return "quick-findings";
    case "macro":
      return "macro";
    case "manual":
      return "manual";
    case "radiologist-voice":
      return "voice";
    // protocol / template / template-a / template-b / structured-template /
    // structured-template-candidate / companion / ai-draft all map to
    // "structured" — they originate from a structured catalog or template
    // engine, not a free-text source.
    default:
      return "structured";
  }
}

/**
 * Build a single ComposeObservation from a canonical ledger patch.
 *
 * Returns null when the patch has no usable ACTIVE findings contribution.
 *
 * Findings text lookup order (strict):
 *   1. `patch.lastRendered.findings` — the active Findings sentence this
 *      observation contributed to the current narrative. This is the only
 *      safe source of active findings text.
 *   2. `patch.templates.findings` — the original template the radiologist
 *      committed. Safe because templates are the radiologist-authored
 *      contribution that was merged into Findings (or would be if the field
 *      were empty). Used when lastRendered is absent (e.g. a patch that was
 *      committed but never re-rendered against the live narrative, such as
 *      a freshly-hydrated draft where lastRendered is empty for a still-
 *      pending observation).
 *
 * NEVER used as findingsText:
 *   - `observation.baselineReplaces` — this is the prior BASELINE text being
 *     REPLACED by the active pathology. Surfacing it would tell the AI that
 *     the active disc_contour finding is "No significant disc bulge." — i.e.
 *     it would treat the replaced normal as the current abnormal.
 *
 * If neither lastRendered.findings nor templates.findings is present, the
 * patch is omitted from ComposeObservation — it still contributes to the
 * composer via the Findings/Impression narrative snapshot.
 */
function patchToComposeObservation(patch: AppliedPathologyPatch): ComposeObservation | null {
  const observation: CanonicalObservation | undefined = patch.observation;

  // STRICT active-findings lookup. baselineReplaces is intentionally
  // excluded — see function docstring.
  const lastRenderedFindings = (patch.lastRendered?.findings ?? "").trim();
  const templateFindings = (patch.templates?.findings ?? "").trim();
  const findingsText = lastRenderedFindings || templateFindings;
  if (!findingsText) return null;

  const source = mapInsertSourceToComposeSource(patch.source);
  const impressionText = patch.lastRendered?.impression?.trim()
    || patch.templates?.impression?.trim()
    || undefined;
  const recommendationText = patch.lastRendered?.recommendation?.trim()
    || patch.templates?.recommendation?.trim()
    || undefined;

  const obs: ComposeObservation = {
    concept: observation?.concept ?? patch.ownership?.conflictGroup ?? patch.id,
    source,
    findingsText,
  };

  // Optional fields — only carried when meaningful so we don't bloat the
  // composer API contract.
  if (observation?.id) obs.id = observation.id;
  if (observation?.region) obs.region = observation.region;
  if (observation?.level) obs.level = observation.level;
  if (observation?.laterality) obs.laterality = observation.laterality;
  if (observation?.severity) obs.severity = observation.severity;
  if (observation?.anatomicalSection) obs.anatomicalSection = observation.anatomicalSection;
  if (observation?.conflictGroup) obs.conflictGroup = observation.conflictGroup;
  if (observation?.baselineReplaces) obs.baselineReplaces = observation.baselineReplaces;
  if (impressionText) obs.impressionText = impressionText;
  if (recommendationText) obs.recommendationText = recommendationText;

  // Defensive: ensure `concept` is never empty (zod schema requires min(1)).
  if (!obs.concept) obs.concept = patch.id;
  return obs;
}

/**
 * Derive the active, deduplicated composer observation list from the canonical
 * workspace observation ledger.
 *
 * Reuses existing ledger semantics. Does NOT introduce a second store, does
 * NOT re-parse Findings prose, does NOT invent clinical identity.
 *
 * @param patches  Live `appliedPathologyPatches` from the workspace store.
 * @returns        Deduplicated, active-only `ComposeObservation[]`.
 */
export function deriveComposeObservations(
  patches: AppliedPathologyPatch[] | null | undefined,
): ComposeObservation[] {
  if (!patches || patches.length === 0) return [];

  const seen = new Set<string>();
  const out: ComposeObservation[] = [];

  // Patches are stored in insertion order; same-slot replacement drops the
  // prior sibling before pushing the survivor, so iteration order matches
  // clinical chronology. We preserve that order in the composer payload.
  for (const patch of patches) {
    // Stale patches were superseded by whole-report-format replacement or
    // flagged on hydrate because the saved narrative no longer matches their
    // lastRendered contribution. They MUST NOT be sent to the AI as if
    // active — that would re-introduce pathology the radiologist already
    // removed.
    if (patch.stale) continue;

    const obs = patchToComposeObservation(patch);
    if (!obs) continue;

    const key = canonicalObservationKey(obs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(obs);
  }

  return out;
}

/**
 * Compact one-line rendering of an observation for the composer prompt.
 *
 * Format:
 *   [source] Region | Anatomical Section | Level | Concept | Laterality
 *   Findings text.
 *   (Impression text.)
 *
 * Empty pieces are omitted. Internal metadata (slotKey, conflictGroup,
 * bundleId, sectionsOwned) is intentionally NOT rendered — those are
 * ownership bookkeeping, not clinical content. The composer only needs the
 * clinical identity + the radiologist's findings wording.
 */
export function renderComposeObservationLine(obs: ComposeObservation): string {
  const parts: string[] = [];
  if (obs.region) parts.push(obs.region);
  if (obs.anatomicalSection) parts.push(obs.anatomicalSection);
  if (obs.level) parts.push(obs.level);
  parts.push(obs.concept);
  if (obs.laterality) parts.push(obs.laterality);
  const head = `- [${obs.source ?? "obs"}] ${parts.join(" | ")}`;
  const tail = obs.findingsText.trim();
  const impression = obs.impressionText?.trim();
  if (impression) {
    return `${head}\n  Findings: ${tail}\n  Impression: ${impression}`;
  }
  return `${head}\n  ${tail}`;
}
