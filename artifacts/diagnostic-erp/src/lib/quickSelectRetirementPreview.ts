/**
 * Which live normal sentences one Quick Select click will retire — answered
 * BEFORE the click, and answered by the same oracles the click itself uses.
 *
 * Owner brief (Composer 99.9 Phase 3, item C): "clearly indicate which normal
 * statement is replaced by the selected abnormality." The apply path already
 * knows — `applyPathologyOverlay` retires a contradicting normal through the
 * `falsifies` oracle (`clinicalSelection/normalSuppression`) and replaces an
 * in-slot sibling through the same-slot plan (`observationSlot`) — but the
 * answer only ever appears AFTER the click, as prose that silently changed.
 * A radiologist clicking "Facet arthropathy L4-L5" over a complete normal
 * report had no way to know the page was about to lose "Lumbar facet joints
 * are unremarkable."
 *
 * This module is the read-only half of that click: the same two oracles, run
 * against the live ledger and the live Findings/Impression text, with nothing
 * written. Two kinds of retirement are reported, because the strip does two
 * different things and a preview that conflates them lies about both:
 *
 *   1. **Falsified normals** — baseline sentences the incoming observation
 *      declares false (`falsifies`). Computed as a DIFFERENCE: sentences the
 *      already-selected observations suppress are not newly retired by this
 *      click, so a second abnormality sharing a baseline (facet + LF) never
 *      double-claims it.
 *   2. **Vacated sibling wording** — the same-slot row being replaced
 *      (Mild canal stenosis → Severe), whose prose leaves the page for the
 *      incoming prose, and whose normal is NOT restored (C3 lineage).
 *
 * Pure by construction: no store import, no React, no writes. The store action
 * `previewPathologyOverlay` is a thin read-only wrapper that guarantees the
 * preview is computed from exactly the observation a real click builds.
 */
import { activeSuppressors, suppressedKeys } from "./clinicalSelection/normalSuppression";
import { findSameSlotSiblings, planSameSlotReplacement, type CanonicalObservation } from "./observationSlot";
import { incomingStatesAbnormalImpression, isSystemNormalPatch } from "./conceptCanon/normalImpression";
import type { AppliedPathologyPatch } from "./zai-workspace/store";
import { splitToSentences, normalizeForDedupe } from "./reportFieldMerge";

/** A ledger row in the shape the oracles read — the live patch shape. */
export type PreviewLedgerRow = {
  id: string;
  observation?: CanonicalObservation | null;
  /** What this row last wrote into the report body. */
  lastRendered?: { findings?: string | null; impression?: string | null } | null;
  stale?: boolean;
  protected?: boolean;
  source?: string;
};

export type QuickSelectRetirementPreview = {
  /** Live Findings normal sentences THIS click retires. */
  retiredFindings: string[];
  /** Live Impression sentences THIS click retires (e.g. the normal-study conclusion). */
  retiredImpression: string[];
  /** The in-slot sibling's findings wording being replaced (severity chain), if any. */
  vacatedFindings: string[];
  /** The in-slot sibling's impression wording being replaced, if any. */
  vacatedImpression: string[];
  /** True when nothing on the page changes ownership or wording. */
  readonly nothingRetires: boolean;
};

/** Only rows the oracles themselves count — mirrors `suppressorHolders`'s filter. */
function holders(rows: readonly PreviewLedgerRow[]): PreviewLedgerRow[] {
  return rows.filter((p) => !p.stale && p.observation && p.observation.role !== "baseline");
}

function sentencesOf(text: string | null | undefined): string[] {
  return splitToSentences((text ?? "").trim()).filter((s) => s.trim().length > 0);
}

/**
 * The retirement difference one incoming observation causes over the live
 * ledger. `livePatches` is the ledger as it stands; the incoming observation is
 * added on top. `incoming` (the substituted prose the click would write) is
 * used only by the same-slot plan, exactly as the apply path uses it.
 */
export function previewQuickSelectRetirement(input: {
  observation: CanonicalObservation;
  /** The substituted sentences this click would write, if known at preview time. */
  incoming?: { findings?: string | null; impression?: string | null };
  livePatches: readonly PreviewLedgerRow[];
  findingsText: string;
  impressionText: string;
}): QuickSelectRetirementPreview {
  const live = holders(input.livePatches);
  const findingsSentences = sentencesOf(input.findingsText);
  const impressionSentences = sentencesOf(input.impressionText);

  // 1 — falsified normals, as a difference against what is already suppressed.
  const beforeFindings = suppressedKeys(activeSuppressors(live), findingsSentences);
  const beforeImpression = suppressedKeys(activeSuppressors(live), impressionSentences);
  const withIncoming = [...live, { id: "__preview_incoming__", observation: input.observation }];
  const afterFindings = suppressedKeys(activeSuppressors(withIncoming), findingsSentences);
  const afterImpression = suppressedKeys(activeSuppressors(withIncoming), impressionSentences);
  const retiredFindings = findingsSentences.filter(
    (s) => afterFindings.has(normalizeForDedupe(s)) && !beforeFindings.has(normalizeForDedupe(s)),
  );
  const retiredImpression = impressionSentences.filter(
    (s) => afterImpression.has(normalizeForDedupe(s)) && !beforeImpression.has(normalizeForDedupe(s)),
  );

  // 2 — the same-slot sibling whose wording the incoming prose replaces.
  // The live rows ARE the shape the plan reads (the store passes the same
  // array to the same oracle at apply time); the cast only narrows the
  // preview-side type down to it.
  type SiblingRows = Parameters<typeof findSameSlotSiblings>[0];
  const candidateRows = input.livePatches.filter((p) => !p.stale && p.observation != null) as unknown as SiblingRows;
  const siblings = findSameSlotSiblings(candidateRows, input.observation);
  const plan = planSameSlotReplacement({
    incoming: input.observation,
    incomingFindings: input.incoming?.findings ?? "",
    incomingImpression: input.incoming?.impression ?? "",
    siblings,
  });
  let vacatedFindings: string[] = [];
  let vacatedImpression: string[] = [];
  if (plan.action === "update") {
    const vacated = input.livePatches.find((p) => p.id === plan.existingId);
    vacatedFindings = sentencesOf(vacated?.lastRendered?.findings ?? "");
    vacatedImpression = sentencesOf(vacated?.lastRendered?.impression ?? "");
  }

  // 3 — the system-owned normal conclusion yields to an impression-worthy
  // abnormal (PR #662 §2 semantics), so the preview says the same thing the
  // click does: "Normal MRI of the lumbosacral spine." leaves with the first
  // abnormality. Read from the system patch's live `lastRendered.impression` —
  // once an abnormality holds, the apply path suspends it to "", and a preview
  // over that state correctly claims nothing. The yield removes the system
  // patch's contribution WHOLESALE (`removeLedgerObservation`), so every
  // sentence it holds is claimed; the falsifies keys above are deliberately
  // NOT consulted — the live system patch's own concept tokens loosely match
  // its own conclusion, which would silently drop the first sentence from
  // the promise while the click still removes it.
  if (
    (input.incoming?.impression ?? "").trim()
    && incomingStatesAbnormalImpression(input.observation.concept, input.observation.role, input.incoming?.impression)
  ) {
    const systemNormal = input.livePatches.find((p) => isSystemNormalPatch(p as unknown as AppliedPathologyPatch));
    for (const s of sentencesOf(systemNormal?.lastRendered?.impression ?? "")) {
      if (!retiredImpression.some((r) => normalizeForDedupe(r) === normalizeForDedupe(s))) {
        retiredImpression.push(s);
      }
    }
  }

  return {
    retiredFindings,
    retiredImpression,
    vacatedFindings,
    vacatedImpression,
    nothingRetires: retiredFindings.length === 0
      && retiredImpression.length === 0
      && vacatedFindings.length === 0
      && vacatedImpression.length === 0,
  };
}

/**
 * One readable line for a tooltip or the strip's title attribute — the thing
 * the owner actually asked for: name the sentence, do not gesture at it.
 *
 * Rendered from the PREVIEW, never from prose hunting: the sentences quoted
 * are the exact keys the oracle keyed, so the promise on hover is the promise
 * the click keeps.
 */
export function describeRetirementPreviewLine(preview: QuickSelectRetirementPreview): string {
  const parts: string[] = [];
  if (preview.retiredFindings.length > 0) {
    parts.push(`Replaces: ${preview.retiredFindings.map((s) => `"${s}"`).join(" ")}`);
  }
  if (preview.retiredImpression.length > 0) {
    parts.push(`Removes from Impression: ${preview.retiredImpression.map((s) => `"${s}"`).join(" ")}`);
  }
  if (preview.vacatedFindings.length > 0) {
    parts.push(`Upgrades: ${preview.vacatedFindings.map((s) => `"${s}"`).join(" ")}`);
  }
  return parts.join(" · ");
}
