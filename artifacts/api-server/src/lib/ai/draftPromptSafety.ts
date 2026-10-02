/**
 * Grounding and preservation clauses shared by every interactive AI draft
 * prompt.
 *
 * One module, two importers: POST /api/ai-reporting/draft and the pipeline
 * self-test, whose prompt is documented as production-shaped. Keeping the
 * clauses in a leaf both can import is what stops them drifting apart — the
 * self-test previously carried a hand-copied paraphrase of the instruction
 * block, so a hardening clause added to production was never exercised.
 *
 * Stating these is the cheap half of draft safety. The half that checks is
 * `validateDraftGrounding` in routes/aiReporting.ts, which calls the background
 * composer's own `validateComposerOutput` rather than re-implementing it.
 */
export const DRAFT_SAFETY_CLAUSES = [
  "Report ONLY what the supplied context and images actually support.",
  "Do NOT invent an abnormality, diagnosis, measurement, spinal level or side that is absent from the supplied context.",
  "Reproduce every supplied measurement EXACTLY, to the same precision, attached to the same level and the same side — 8.7 mm stays 8.7 mm, it is never rounded to 8 mm or 9 mm.",
  "Never move a finding to a different side or to a different spinal level.",
  "Never escalate a supplied severity: mild stays mild, moderate stays moderate.",
  "If the supplied context is not enough to conclude, say so instead of concluding.",
].join("\n");
