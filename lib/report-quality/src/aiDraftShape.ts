/**
 * Is this AI text fit to be added to a report at all?
 *
 * A model answering as a CHAT is a success at the HTTP level and a hazard at the report
 * level. The interactive AI path used to copy whatever the saved draft held straight into
 * a clinician's Findings on one press, and measured here: a local model's preamble and
 * its Markdown bullet list went in as written, and the report then carried
 * "This is a draft. A radiologist would likely add more context…" as a finding. The
 * quality engine scores prose that IS prose; nothing checked whether the text was prose
 * in the first place.
 *
 * So this is a shape check only. It never rewrites, trims or reinterprets a sentence —
 * deleting the model's chatter would be its own clinical edit, and the rules for that
 * belong to a human. It answers one question, and the caller refuses the send when the
 * answer is not empty: does this text read as report writing, or as the model talking
 * about the report?
 *
 * Deliberately conservative, because a false refusal costs a radiologist their own text:
 * numbered conclusions ("1. Normal MRI of the brain."), an em-dash, "No acute infarct.",
 * a sentence beginning "Note the…" all pass. Only structural evidence of chat or
 * machine-formatting is flagged.
 */

export type AiReportTextDefectKind = "markdown" | "conversational" | "structured";

export type AiReportTextDefect = {
  kind: AiReportTextDefectKind;
  /** The offending line, trimmed and cut to a length safe to show in a toast. */
  line: string;
};

/**
 * Lines that begin with Markdown machinery. A report body is plain text end to end — it
 * is printed, converted to PDF and read by a clinician, and `**` and `-` are not part of
 * that vocabulary. Numbered lines are NOT a defect: an Impression is legitimately written
 * "1. …" "2. …", so the digit form is absent from this pattern on purpose.
 */
const MARKDOWN_LINE = /^[ \t]*(?:[-*+•]\s|#{1,6}\s|>\s|```)/;
const MARKDOWN_INLINE = /(\*\*|__|~~|`{1,3}|\[[^\]\n]{2,}\]\([^)\n]{1,}\))/;

/**
 * The model speaking to the user rather than to the record: a promise of what follows
 * ("Here's the report wording…"), a hedge about its own status ("As an AI…", "I cannot
 * provide…"), or advice about the report instead of the report ("Important
 * Considerations", "Please note", "You should verify…"). Anchored to a line start so an
 * ordinary clinical sentence that merely contains one of these words is not caught.
 */
const CONVERSATIONAL_LINE =
  /^[ \t]*(?:here(?:'|’)?s\b|here is\b|here are\b|below (?:is|are)\b|the following (?:is|are)\b|i(?:'|’)?ve (?:written|prepared|drafted|created)\b|i (?:cannot|can’t|can't|am unable to|’m unable to)\b|as an ai\b|as a (?:large )?(?:language )?model\b|please note\b|note that (?:the|this) (?:findings?|report)\b|important (?:considerations?|points?|notes?)\b|disclaimer\b|caveat\b|reminder\b|in summary\b|to summarize\b|to summarise\b|let me\b|would you (?:like|prefer)\b|you (?:should|ought to|may wish to|might want to)\b|this (?:draft|response|answer) (?:is|was|should)\b|draft (?:for|response) (?:your|the) (?:review|edit)?)/i;

/**
 * Machine output that was never prose: a JSON/YAML body, quoted `"key": value` lines, or
 * XML tags. A quoted key is required — English findings open with a word and a colon
 * ("Findings: no acute abnormality.") and that is a formatting habit of the model, not a
 * structured payload, so it is left to the clinician rather than refused.
 */
const STRUCTURED_START = /^[ \t]*[{[]/;
const KEY_VALUE_LINE = /^[ \t]*"[A-Za-z][A-Za-z0-9 _-]{1,40}"\s*:\s*\S/;
const XML_TAG = /<\/?[a-z][a-z0-9_-]*>/i;

const shown = (line: string) => (line.trim().length > 120 ? `${line.trim().slice(0, 117)}…` : line.trim());

/**
 * Every reason this text is not fit to enter a report, in the order it was found.
 * An empty array means the shape is acceptable; it says nothing about whether the
 * content is clinically correct, which is the radiologist's decision and the reason
 * accepted text still arrives as an `ai-draft` proposal rather than a conclusion.
 */
export function findAiReportTextDefects(text: string): AiReportTextDefect[] {
  const defects: AiReportTextDefect[] = [];
  const lines = String(text ?? "").split(/\r?\n/);
  const seen = new Set<AiReportTextDefectKind>();
  const push = (kind: AiReportTextDefectKind, line: string) => {
    if (seen.has(kind)) return;
    seen.add(kind);
    defects.push({ kind, line: shown(line) });
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    if (MARKDOWN_LINE.test(line)) push("markdown", line);
    else if (MARKDOWN_INLINE.test(line)) push("markdown", line);
    else if (CONVERSATIONAL_LINE.test(line)) push("conversational", line);
    else if (STRUCTURED_START.test(line)) push("structured", line);
    else if (KEY_VALUE_LINE.test(line)) push("structured", line);
    else if (XML_TAG.test(line)) push("structured", line);
  }
  return defects;
}

const LABELS: Record<AiReportTextDefectKind, string> = {
  markdown: "Markdown formatting (bullets, bold or code)",
  conversational: "a conversational introduction or commentary rather than report text",
  structured: "structured output (JSON or key-value lines) instead of prose",
};

/**
 * What the clinician is told. Names what was seen, says nothing was written, and names
 * the recovery — the draft is still theirs to edit in the AI assistant. It never claims
 * the finding is wrong, because it is not this check's place to say so.
 */
export function describeAiReportTextRefusal(defects: AiReportTextDefect[]): string {
  const parts = defects.map((d) => LABELS[d.kind]);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return (
    `This draft carries ${list}, so it was not added to the report — nothing was changed. ` +
    `Open Saved Drafts in the AI assistant, keep only the sentences you want as findings, and send it again.`
  );
}
