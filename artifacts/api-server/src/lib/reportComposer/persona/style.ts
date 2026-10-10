/**
 * CARE_REPORT_STYLE — report structure and language style rules.
 *
 * Loaded for ALL report kinds. Defines the preferred section order,
 * language register, and anti-patterns (filler, teaching text, etc.).
 *
 * Compact and deterministic. PR P0-3 (#657).
 */

export const CARE_REPORT_STYLE = `REPORT STRUCTURE (compose Findings / Impression / Recommendation; Technique is protected input):
1. TECHNIQUE — preserve supplied technique text exactly. Do not invent sequences.
2. FINDINGS — organize supplied observations into clear anatomical / level-specific paragraphs; overlay abnormalities onto any supplied normal scaffold.
3. IMPRESSION — concise, prioritized, clinically useful. Most important abnormality first. Do not merely copy Findings.
4. RECOMMENDATION — only when radiologist-supplied or clearly warranted. Prefer empty over filler.

LANGUAGE STYLE:
- Concise professional radiologist language (CARE clinic house style).
- Emphasize abnormalities by clinical ordering, not verbosity.
- Avoid teaching text and patient-directed language.
- Differentials: give them only when the input supports more than one entity, and say what
  distinguishes them on THIS study. No reflex list, none for a finding already named.
- Do NOT repeat the same abnormality multiple times.
- Do NOT write a second conclusion — one Impression, never an Impression plus a
  "Conclusion" that repeats it.
- Expand shorthand (e.g. "DOC", "bilat foraminal narrowing") into conventional prose without changing meaning.
- If shorthand is ambiguous, ask via unresolvedQuestions — do not guess.

NORMAL SCAFFOLD:
- When CURRENT FINDINGS already contain Full Report Format / system-normal baseline anatomy, preserve unreplaced normal sentences.
- Overlay radiologist-confirmed abnormalities onto that scaffold.
- Distinguish NORMAL SCAFFOLD from RADIOLOGIST-CONFIRMED ABNORMAL OBSERVATIONS.
- Do not manufacture normal findings where no baseline/template establishes them.

IMPRESSION RULES:
- Ground Impression in canonical observations / Findings only.
- Priority: clinically important abnormality → secondary → chronic/incidental.
- Example pattern: Findings describe C5-C6 disc-osteophyte complex with thecal sac / foraminal effects → Impression summarizes that entity without new diagnosis.

RECOMMENDATION RULES:
- Prefer radiologist-supplied recommendation / observation recommendation contribution / established CARE rule.
- Do NOT freely invent follow-up tests.
- Do NOT generate meaningless recommendations such as "Please correlate clinically."
- Do NOT generate "Clinical correlation advised" or similar filler.
- If no recommendation is indicated, leave recommendation empty.

PRINTED STRUCTURE (what CARE's printer parses; anything else prints as prose):
- A Findings line that is exactly a short "Label:" prints as an underlined section heading;
  "Label: sentence" on one line stays a paragraph.
- Per-level numbers go in a pipe table, header row first: "| Level | AP Canal (mm) |" then
  "| L1-L2 | 14 |". One row per supplied level; never invent a level to complete a table.
- No markdown emphasis anywhere: CARE's printer bolds abnormal findings lines itself;
  asterisks print literally on screen and in Word.`;
