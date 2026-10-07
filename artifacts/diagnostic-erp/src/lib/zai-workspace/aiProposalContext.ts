/**
 * aiProposalContext.ts — what clinical state an AI proposal was generated FROM,
 * and whether that state still exists.
 *
 * C1 answers "which provider and model produced these words?". This answers the
 * other half: "from which report state were they produced?". Both are required
 * before a draft can be shown as current, because a proposal that is honestly
 * attributed to a model can still be yesterday's reasoning presented as though
 * it had been generated from the text in front of the radiologist now.
 *
 * A proposal therefore carries a binding: the study it belongs to, the field it
 * was generated from, the field it is destined for, and a digest of that context
 * taken at the moment of generation. Acceptance recomputes the digest from the
 * state that exists now and refuses when they differ. Nothing here decides
 * whether the proposal is CLINICALLY right — that is the radiologist's, and the
 * merge layer's (`reportFieldMerge`) and #880's (`copilotAcceptanceContract`)
 * rules apply to a fresh proposal exactly as they did before.
 *
 * The axes are the ones a model was actually given, and no others:
 *   study identity   — #874's `activeStudyId` / `activeStudyInstanceUID`, compared
 *                      with #874's own async-correlation rule `shouldApplyAsyncStudyKey`
 *                      (a request that named no identity is not treated as a switch);
 *   source field     — the narrative field whose text the task was built from;
 *   source text      — normalised with the Composer's own `normalizeForHash`;
 *   target field     — the producer's declared destination, never inferred from
 *                      the proposal text (that is #880's rule, reused here).
 * Provider, model, locality, timeout and UI state are deliberately NOT in the
 * digest: they are not clinical freshness, and including them would stale every
 * open proposal whenever a settings page is saved. Space runs, padding and
 * line-ending STYLE are normalised away with that same rule, so re-typing a space
 * cannot fake staleness; a newline remains a difference, because a line break in
 * Findings changes the printed report. There is no fuzzy or semantic matching,
 * because "these two sentences mean the same" is exactly the judgement #878
 * removed from the merge layer for being unsafe.
 *
 * The digest is a small domain-tagged FNV-1a hex string — the same construction
 * already used for `reportFormatRevision` and `printBill.fnv1a32Hex` — and not a
 * security hash. It is computed synchronously because acceptance is synchronous,
 * and it stores no PHI: the preimage exists only during the call, and the
 * binding keeps the digest plus the field names, never the text.
 */
import { normalizeForHash } from "../reportComposer/types";
import { shouldApplyAsyncStudyKey } from "../radiologyWorkspaceSafety";
import { COPILOT_TARGET_FIELDS, type CopilotTargetField } from "./copilotAcceptanceContract";

/** The narrative field a proposal was generated FROM. */
export type ProposalSourceField = CopilotTargetField;

/** The context a proposal was made from, and the same shape recomputed now. */
export interface AiProposalContext {
  studyId: string | null;
  studyInstanceUID: string | null;
  sourceField: ProposalSourceField;
  /** Raw text; normalised inside the digest, never stored on the binding. */
  sourceText: string;
  targetField: CopilotTargetField;
}

/** What a proposal carries with it. No clinical text, only identities + digest. */
export interface AiProposalBinding {
  studyId: string | null;
  studyInstanceUID: string | null;
  sourceField: ProposalSourceField;
  targetField: CopilotTargetField;
  /** `ai-ctx-fnv1a-<hex>` over the context at generation time. */
  contextRevision: string;
  /** Ordering only: a response from an older request must not overwrite a newer one. */
  requestSeq?: number;
}

/**
 * The state to compare a binding against. Field texts are carried rather than a
 * single digest so one snapshot serves every binding, and so the store never has
 * to store a second truth about what changed.
 */
export interface CurrentProposalContext {
  studyId: string | null;
  studyInstanceUID: string | null;
  sourceTexts: Record<ProposalSourceField, string>;
}

export type AiProposalStaleReason =
  | "unbound"
  | "invalid-target"
  | "study-changed"
  | "source-changed";

export interface AiProposalVerdict {
  fresh: boolean;
  reason: AiProposalStaleReason | null;
  /** A one-line, radiologist-readable account of the refusal. */
  detail: string;
}

/** The store slice the two state readers need — structural, so tests can pass the real store. */
export interface AiProposalStateSlice {
  activeStudyId: string | null;
  activeStudyInstanceUID?: string | null;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
}

/** Unit separator (0x1F) — a control character report prose cannot contain, so
 *  no edit can forge a field boundary inside the preimage. Built by code point
 *  rather than a literal escape for the same reason the Composer joins its
 *  multi-field `inputHash` preimage on 0x1E. */
const UNIT = String.fromCharCode(31);

/** Domain tag: keeps a context digest from ever colliding with another FNV-1a
 *  value in the app (formats, bills) and makes a stored revision self-describing. */
const REVISION_PREFIX = "ai-ctx-fnv1a-";

/** 32-bit FNV-1a over UTF-16 code units, the same construction as
 *  `printBill.fnv1a32Hex` and the full-report baseline revision: cheap, pure,
 *  synchronous and dependency-free. Not a security hash — it detects a changed
 *  context, it does not prove one. */
function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const id = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * The digest of a proposal context. Reads named properties only, so extra fields
 * on the object — C1's provider/model/locality/timeout execution identity, or
 * anything a producer might later attach — cannot change it. Provider metadata
 * is not clinical freshness, and a fingerprint that mixed the two would stale
 * every open proposal on a settings change.
 */
export function fingerprintAiProposalContext(ctx: AiProposalContext): string {
  const preimage = [
    id(ctx.studyId),
    id(ctx.studyInstanceUID),
    ctx.sourceField,
    normalizeForHash(ctx.sourceText ?? ""),
    ctx.targetField,
  ].join(UNIT);
  return `${REVISION_PREFIX}${fnv1a32(preimage)}`;
}

/**
 * Bind a proposal to an arbitrary (source → target) pair, for a producer whose
 * input is not the Findings. The pair still comes from the producer's own task
 * contract — this does not look at the text to decide what generated it.
 */
export function aiProposalBindingForField(
  state: AiProposalStateSlice,
  sourceField: ProposalSourceField,
  targetField: CopilotTargetField,
): AiProposalBinding {
  const now = currentAiProposalContext(state);
  return {
    studyId: now.studyId,
    studyInstanceUID: now.studyInstanceUID,
    sourceField,
    targetField,
    contextRevision: fingerprintAiProposalContext({
      studyId: now.studyId,
      studyInstanceUID: now.studyInstanceUID,
      sourceField,
      sourceText: now.sourceTexts[sourceField] ?? "",
      targetField,
    }),
  };
}

/**
 * Build the binding for the live Ctrl+I task: a narrative target generated from
 * the FINDINGS the caller has in hand. The source field is part of the producer's
 * task contract — `/draft` is called with `field: "impression"` and its report
 * body is `findingsText` — not something inferred from the returned sentence,
 * whatever that sentence happens to say about itself.
 */
export function aiProposalBindingForImpression(
  state: AiProposalStateSlice,
  targetField: CopilotTargetField = "impression",
): AiProposalBinding {
  return aiProposalBindingForField(state, "findings", targetField);
}

const isNarrativeField = (v: unknown): v is CopilotTargetField =>
  typeof v === "string" && (COPILOT_TARGET_FIELDS as readonly string[]).includes(v);

/**
 * The state to compare a binding against, read straight from the live store.
 * Field texts are carried rather than a single digest so one snapshot serves any
 * binding, and so the store never has to hold a stored second truth about what
 * changed — staleness is always recomputed from the text that exists now.
 */
export function currentAiProposalContext(state: AiProposalStateSlice): CurrentProposalContext {
  return {
    studyId: id(state?.activeStudyId) || null,
    studyInstanceUID: id(state?.activeStudyInstanceUID) || null,
    sourceTexts: {
      findings: state?.findingsText ?? "",
      impression: state?.impressionText ?? "",
      recommendation: state?.recommendationText ?? "",
    },
  };
}

/**
 * Is this proposal still about the report that exists now?
 *
 * Ordered by what the answer means: a proposal with no context at all cannot be
 * shown to be current; a context aimed at a field that is not a narrative target
 * could never be honoured (#880 makes the declared target authoritative and
 * refuses to re-derive it, so an unusable target stays unusable rather than being
 * talked into Findings); a proposal from another study is another patient's
 * reasoning; and only then does the source text get compared by digest.
 *
 * `detail` names fields and reasons, never content, so it can be shown to a
 * radiologist and logged without carrying PHI.
 */
export function evaluateAiProposal(
  binding: AiProposalBinding | null | undefined,
  now: CurrentProposalContext,
): AiProposalVerdict {
  if (!binding) {
    return {
      fresh: false,
      reason: "unbound",
      detail: "this suggestion carries no record of the report state it was generated from, so it "
        + "cannot be shown to be current — regenerate it",
    };
  }
  if (!isNarrativeField(binding.targetField) || !isNarrativeField(binding.sourceField)) {
    return {
      fresh: false,
      reason: "invalid-target",
      detail: `this suggestion was generated from "${binding.sourceField}" for "${binding.targetField}", `
        + "which is not a report field Copilot can write to — nothing was inserted",
    };
  }
  if (
    !shouldApplyAsyncStudyKey(binding.studyId, now.studyId)
    || !shouldApplyAsyncStudyKey(binding.studyInstanceUID, now.studyInstanceUID)
  ) {
    return {
      fresh: false,
      reason: "study-changed",
      detail: "this suggestion was generated for a different study and is being shown on another one "
        + "— nothing was inserted",
    };
  }
  const current = fingerprintAiProposalContext({
    studyId: now.studyId,
    studyInstanceUID: now.studyInstanceUID,
    sourceField: binding.sourceField,
    sourceText: now.sourceTexts[binding.sourceField] ?? "",
    targetField: binding.targetField,
  });
  if (current !== binding.contextRevision) {
    return {
      fresh: false,
      reason: "source-changed",
      detail: `the ${binding.sourceField} this suggestion was generated from has changed since it was `
        + "written, so it may describe text that is no longer in the report — regenerate it",
    };
  }
  return { fresh: true, reason: null, detail: "" };
}

