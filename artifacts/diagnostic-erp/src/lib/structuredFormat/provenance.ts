/**
 * Provenance precedence — written BEFORE reportFieldMerge.ts source additions.
 *
 * Clinical text stays plain. Provenance is a parallel map. Never colour the
 * signed/preview report; editor-only chips.
 *
 * New sources:
 *   structured-template            — committed generated Findings/Technique/Recommendation
 *   structured-template-candidate  — Impression sentences inserted only on Accept
 *
 * Precedence (how two sources interact on the SAME sentence after normalizeForDedupe):
 *
 * 1. Manual
 *    After the radiologist types, reconcileProvenanceAfterManualEdit keeps
 *    provenance only for unchanged sentence keys; edited/new sentences → manual.
 *    Structured generate MUST replace only verbatim previous labeled lines,
 *    never rewrite manual sentences or in-place edits.
 *
 * 2. structured-template vs protocol / template (narrative format)
 *    Protocol/template fill-empty on study open (existing). Structured generate
 *    then mergeField(..., "structured-template"). Dedupe unions sources.
 *    Explicit "replace format" remains a user action (replaceField).
 *
 * 3. structured-template vs quick-findings / quick-select / macro / companion
 *    Same mergeSentencesWithProvenance rules (exact → Jaccard/subsequence with
 *    clinical guards for laterality, levels, severity, measurements).
 *    Union sources on kept sentence. Structured does not delete unmatched
 *    Quick Findings sentences.
 *
 * 4. structured-template vs ai-draft
 *    AI overnight/ghost uses setFieldIfEmpty / mergeField("ai-draft").
 *    If structured findings already occupy the field, AI does not overwrite
 *    (fill-empty). If AI landed first, later structured merge DEDUPES overlapping
 *    wording and unions sources; AI-only sentences stay.
 *    P1 does NOT change the AI prompt to "see" structured selections — avoidance
 *    of duplicate lordosis is merge/canonicalKey, not an AI rewrite.
 *
 * 5. Impression candidates (structured-template-candidate)
 *    Stay in the Structured panel as true candidates (Accept / Edit / Ignore).
 *    Never auto-inserted into the canonical Impression editor.
 *    Accept → mergeField("impression", text, "structured-template-candidate").
 *    Edit → inline edit; Accept merges the edited text with the same source.
 *    Ignore → dismiss locally; never writes the editor.
 *    No implicit accept on finalize.
 *
 * 6. Finalize
 *    Unaccepted candidates are not in the signed body. Accepted sentences are
 *    kept as normal impression text. Provenance may still record
 *    structured-template-candidate for audit; the PDF is not styled.
 */

export const STRUCTURED_TEMPLATE_SOURCE = "structured-template" as const;
export const STRUCTURED_TEMPLATE_CANDIDATE_SOURCE = "structured-template-candidate" as const;
