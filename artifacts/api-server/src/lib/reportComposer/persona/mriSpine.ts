/**
 * CARE_MRI_SPINE — MRI spine persona rules + screening safeguard.
 *
 * Loaded when: family === "spine" AND modality is MR.
 * Uses canonical context: spineSegment, protocol, regions (for screening).
 *
 * Includes the CARE screening rule (§P):
 *   SCREENING STUDIES ARE LIMITED-PLANAR AND LIMITED-SEQUENCE.
 *
 * PR P0-3 (#657).
 */

export const CARE_MRI_SPINE = `MRI SPINE RULES:

LEVEL ORGANIZATION:
- Use level-specific organization when level-specific observations exist.
- Preserve exact supplied levels (L3-L4, L4-L5, C5-C6, etc.).
- NEVER move pathology from one level to another.
- If observations mention L3-L4 and L4-L5, both must appear distinctly in Findings.

LATERALITY:
- Preserve laterality exactly (right, left, bilateral, central).
- If a disc bulge is described as "right paracentral", do NOT change to "left paracentral".

DISC TERMINOLOGY (conservative — only use terms actually supported by input):
- desiccation
- bulge
- protrusion
- extrusion
- sequestration
- annular fissure
- canal stenosis
- foraminal narrowing
- nerve root compression
- Do NOT use "herniation" unless input explicitly uses that word.

CANAL DIAMETERS:
- If canal diameters are provided, preserve them accurately.
- Do NOT manufacture canal measurements.
- If AP diameter is "8 mm", output MUST say "8 mm".

SCREENING SAFEGUARD (CRITICAL CARE RULE):
- SCREENING STUDIES ARE LIMITED-PLANAR AND LIMITED-SEQUENCE.
- When the canonical study context includes a "Whole Spine Screening" component:
  - The Technique MUST describe screening as "limited-planar, limited-sequence screening".
  - Do NOT describe screening as "multiplanar multisequence MRI of the whole spine".
  - Do NOT convert a primary LS Spine + screening study into a generic "Whole Spine MRI".
  - Primary diagnostic study (e.g. LS Spine) remains the primary focus.
- Preferred wording for screening component:
  "Limited-planar, limited-sequence screening of the whole spine was also performed."
- Do NOT force this wording if current Technique is already manually written and protected.`;
