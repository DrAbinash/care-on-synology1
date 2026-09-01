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
 *  - Same-slot dedupe uses `CanonicalObservation.slotKey`
 *    (region|concept|level|laterality). When two patches share a slotKey the
 *    survivor is the one still present in the ledger — i.e. by the time
 *    `deriveComposeObservations` is called there is exactly one row per slot
 *    for structured observations. Legacy unstructured patches (no slotKey or
 *    wildcard slotKey) are deduped by normalized findings text to avoid
 *    double-counting voice rows.
 *  - Voice observations are already members of `appliedPathologyPatches`
 *    (id `voice-*`, source `radiologist-voice`). The adapter renders them
 *    with `source: "voice"`. No separate voiceComposerObservations pass is
 *    needed in `useReportComposer`.
 */
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { CanonicalObservation } from "@/lib/observationSlot";
import type { InsertSource } from "@/lib/reportFieldMerge";
import type { ComposeObservation } from "./types";

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
 * Returns null when the patch has no usable findings text (e.g. legacy rows
 * with only impression templates) — those rows still contribute to narrative
 * via the Findings/Impression snapshot, but cannot ground the composer as a
 * standalone observation.
 */
function patchToComposeObservation(patch: AppliedPathologyPatch): ComposeObservation | null {
  const observation: CanonicalObservation | undefined = patch.observation;
  const findingsText = (patch.lastRendered?.findings ?? observation?.baselineReplaces ?? "").trim();
  if (!findingsText) return null;

  const source = mapInsertSourceToComposeSource(patch.source);
  const impressionText = patch.lastRendered?.impression?.trim() || undefined;
  const recommendationText = patch.lastRendered?.recommendation?.trim() || undefined;

  const obs: ComposeObservation = {
    concept: observation?.concept ?? patch.ownership?.conflictGroup ?? patch.id,
    source,
    findingsText,
  };

  // Optional fields — only carried when meaningful so we don't bloat the
  // composer API contract.
  if (observation?.id) obs.id = observation.id;
  if (observation?.level) obs.level = observation.level;
  if (observation?.laterality) obs.laterality = observation.laterality;
  if (observation?.severity) obs.severity = observation.severity;
  if (observation?.anatomicalSection) obs.anatomicalSection = observation.anatomicalSection;
  if (observation?.conflictGroup) obs.conflictGroup = observation.conflictGroup;
  if (observation?.baselineReplaces) obs.baselineReplaces = observation.baselineReplaces;
  if (impressionText) obs.impressionText = impressionText;
  // `recommendationText` is intentionally NOT added to `ComposeObservation`
  // (the schema does not currently expose it). Recommendation narrative is
  // still grounded via `snapshot.recommendation`. Carrying recommendationText
  // here would be safe but contract-expanding — P0-1 keeps the contract stable.
  // The text is preserved on `patch.lastRendered.recommendation` if a future
  // PR chooses to extend `ComposeObservation`.

  // Defensive: ensure `concept` is never empty (zod schema requires min(1)).
  if (!obs.concept) obs.concept = patch.id;
  return obs;
}

/**
 * Stable lowercase key used for clinical-identity dedupe.
 *
 * Uses `slotKey` (region|concept|level|laterality) when the observation has
 * one — that is CARE's canonical slot identity, already honored by
 * `applyPathologyOverlay` for same-sibling replacement. Falls back to
 * normalized findings text for legacy / unstructured patches (no concept).
 *
 * Severity, measurement, and findings wording are intentionally NOT part of
 * the key — the ledger already guarantees at most one active row per slotKey.
 * For unstructured rows, identical findings text means duplicate voice commits.
 */
function dedupeKey(obs: ComposeObservation): string {
  const slot = [
    (obs.conflictGroup || obs.concept || "").toLowerCase(),
    (obs.level || "").toLowerCase(),
    (obs.laterality || "").toLowerCase(),
  ].join("|");
  // If we have a real (non-wildcard) clinical slot, use it.
  if (slot.replace(/\|/g, "").length > 0) {
    return `slot::${slot}`;
  }
  // Legacy / unstructured — dedupe by normalized findings text only.
  const norm = (obs.findingsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .toLowerCase();
  return `text::${norm}`;
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

    const key = dedupeKey(obs);
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
 *   [source] Region | Level | Concept | Laterality
 *   Findings text.
 *
 * Intentionally omits internal metadata (slotKey, conflictGroup, bundleId,
 * sectionsOwned) — those are ownership details, not clinical content. The
 * composer only needs the clinical identity + the radiologist's findings
 * wording.
 */
export function renderComposeObservationLine(obs: ComposeObservation): string {
  const parts: string[] = [];
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
