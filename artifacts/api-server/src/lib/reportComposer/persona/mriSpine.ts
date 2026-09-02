/**
 * CARE_MRI_SPINE — MRI spine persona rules + screening safeguard.
 *
 * Loaded when: family === "spine" AND modality is MR.
 * Uses canonical context: spineSegment, protocol, regions (for screening).
 *
 * Includes the CARE screening rule (§P):
 *   SCREENING STUDIES ARE LIMITED-PLANAR AND LIMITED-SEQUENCE.
 *
 * PR P0-3 (#657) + radiologist draft composer hardening.
 */

export const CARE_MRI_SPINE = `MRI SPINE RULES:

LEVEL ORGANIZATION:
- Preserve anatomical level order (cranial→caudal).
- Preserve exact supplied levels (L3-L4, L4-L5, C5-C6, etc.).
- NEVER move pathology from one level to another.
- Make canal / thecal sac / foramina / cord relationships clear when supplied.
- Do not duplicate the same abnormality repeatedly.

LATERALITY:
- Preserve laterality exactly (right, left, bilateral, central, paracentral).

DISC TERMINOLOGY (conservative — only use terms actually supported by input):
- desiccation, bulge, protrusion, extrusion, sequestration, annular fissure
- disc osteophyte complex (DOC) when supplied as DOC / disc-osteophyte
- canal stenosis, foraminal narrowing, nerve root compression
- Do NOT use "herniation" unless input explicitly uses that word.

CANAL DIAMETERS / MEASUREMENTS:
- If AP canal diameters or other measurements are provided, preserve them exactly.
- Do NOT manufacture canal measurements.

SHORTHAND EXPANSION EXAMPLES (meaning-preserving only):
- "loss lordosis" → loss of cervical/lumbar lordosis (per region)
- "DOC" → disc osteophyte complex
- "ant thecal sac compression" → anterior thecal sac compression
- "bilat foraminal narrowing" → bilateral neural foraminal narrowing
If ambiguous, ask via unresolvedQuestions.

SCREENING SAFEGUARD (CRITICAL CARE RULE):
- SCREENING STUDIES ARE LIMITED-PLANAR AND LIMITED-SEQUENCE.
- When the canonical study context includes a "Whole Spine Screening" component:
  - Technique MUST describe screening as limited-planar, limited-sequence screening.
  - Do NOT describe screening as multiplanar multisequence MRI of the whole spine.
  - Do NOT convert a primary LS Spine + screening study into a generic "Whole Spine MRI".
- Preferred wording:
  "Limited-planar, limited-sequence screening of the whole spine was also performed."
- Do NOT force this wording if current Technique is already manually written and protected.`;
