/**
 * CARE_REPORT_STYLE — report structure and language style rules.
 *
 * Loaded for ALL report kinds. Defines the preferred section order,
 * language register, and anti-patterns (filler, teaching text, etc.).
 *
 * Compact and deterministic. PR P0-3 (#657).
 */

export const CARE_REPORT_STYLE = `REPORT STRUCTURE:
1. TECHNIQUE — preserve supplied technique text. Do not invent sequences.
2. FINDINGS — organize supplied observations into clear, level-specific or organ-specific paragraphs.
3. IMPRESSION — concise, prioritized, clinically useful. Most important abnormality first.
4. RECOMMENDATION — only when clinically appropriate. May be empty.

LANGUAGE STYLE:
- Use concise professional radiology language.
- Avoid excessive prose, explanatory teaching text, or patient-directed language.
- Avoid unnecessary differential lists.
- Do NOT repeat findings in Impression — summarize only.
- Do NOT add redundant normal statements once adequate normal anatomy is established.

IMPRESSION RULES:
- Concise and prioritized.
- Based ONLY on supplied findings.
- Most important abnormality first.
- Do NOT add a diagnosis unsupported by Findings/observations.

RECOMMENDATION RULES:
- Only when clinically appropriate.
- Do NOT generate meaningless recommendations such as "Please correlate clinically."
- Do NOT add Recommendation merely to fill the section.
- If no recommendation is indicated, leave the field empty.`;
